import { Router } from 'express';
import db from '../database.js';

const router = Router();
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ─── GET /api/monthly — قائمة الجرود الشهرية ─────────────────────────────────
router.get('/', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const inventories = db.prepare(`
    SELECT * FROM monthly_inventories
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(parseInt(limit), parseInt(offset));
  const total = db.prepare('SELECT COUNT(*) as cnt FROM monthly_inventories').get().cnt;
  res.json({ inventories, total });
});

// ─── GET /api/monthly/:id — جرد شهري واحد مع البنود ─────────────────────────
router.get('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM monthly_inventories WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare(`
    SELECT * FROM monthly_inventory_items
    WHERE monthly_inventory_id = ?
    ORDER BY id ASC
  `).all(req.params.id);
  res.json({ ...inv, items });
});

// ─── GET /api/monthly/last/one ───────────────────────────────────────────────
router.get('/last/one', (req, res) => {
  const inv = db.prepare('SELECT * FROM monthly_inventories ORDER BY created_at DESC LIMIT 1').get();
  if (!inv) return res.json(null);
  const items = db.prepare(`
    SELECT * FROM monthly_inventory_items WHERE monthly_inventory_id = ? ORDER BY id ASC
  `).all(inv.id);
  res.json({ ...inv, items });
});

// ─── GET /api/monthly/preview/next — معاينة الجرد الشهري التالي بدون حفظ ───
// مفيد لعرض القيم المحتملة في الواجهة قبل الضغط على زرّ الحفظ.
router.get('/preview/next', (req, res) => {
  res.json(computePreview());
});

// ─── POST /api/monthly — إنشاء جرد شهري جديد (snapshot) ─────────────────────
router.post('/', (req, res) => {
  try {
    const { notes } = req.body || {};
    const result = saveMonthly(notes);
    res.json(result);
  } catch (e) {
    console.error('[monthly create]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/monthly/:id ─────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM monthly_inventories WHERE id = ?').run(req.params.id);
  res.json({ ok: true, deleted: info.changes });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getCurrentSnapshot() {
  const rateRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('exchange_rate');
  const exchangeRate = parseFloat(rateRow?.value || '1') || 1;

  const items = db.prepare(`
    SELECT i.id, i.name, cv.try_amount, cv.usd_amount, cv.notes
    FROM items i
    LEFT JOIN current_values cv ON cv.item_id = i.id
    WHERE i.is_active = 1
    ORDER BY i.sort_order ASC, i.id ASC
  `).all();

  let totalTry = 0, totalUsd = 0;
  for (const it of items) {
    totalTry += it.try_amount || 0;
    totalUsd += it.usd_amount || 0;
  }
  const tryToUsd = exchangeRate > 0 ? totalTry / exchangeRate : 0;
  const totalConvertedUsd = r2(totalUsd + tryToUsd);

  return {
    exchangeRate,
    items,
    totalTry: r2(totalTry),
    totalUsd: r2(totalUsd),
    totalConvertedUsd,
  };
}

/**
 * يحسب الفترة (created_at للجرد الشهري السابق) ومجموع أرباح الجرود اليومية فيها.
 * - أوّل مرّة (لا يوجد جرد شهري سابق) → period_profit = 0، daily_count = 0.
 * - بعد ذلك: المجموع للجرود اليومية التي تمّت في (after lastMonthly.created_at, now].
 */
function computePeriodProfit() {
  const lastMonthly = db.prepare(
    'SELECT id, created_at, total_converted_usd FROM monthly_inventories ORDER BY created_at DESC LIMIT 1'
  ).get();

  if (!lastMonthly) {
    return {
      previousMonthlyId: null,
      previousTotalUsd: 0,
      periodFrom: '',
      periodProfit: 0,
      dailyCount: 0,
    };
  }

  const row = db.prepare(`
    SELECT COALESCE(SUM(profit), 0) as total_profit, COUNT(*) as cnt
    FROM inventories
    WHERE created_at > ?
  `).get(lastMonthly.created_at);

  return {
    previousMonthlyId: lastMonthly.id,
    previousTotalUsd: r2(lastMonthly.total_converted_usd || 0),
    periodFrom: lastMonthly.created_at,
    periodProfit: r2(row?.total_profit || 0),
    dailyCount: row?.cnt || 0,
  };
}

function computePreview() {
  const snap = getCurrentSnapshot();
  const period = computePeriodProfit();
  return {
    is_first: !period.previousMonthlyId,
    exchange_rate: snap.exchangeRate,
    total_try: snap.totalTry,
    total_usd: snap.totalUsd,
    total_converted_usd: snap.totalConvertedUsd,
    previous_total_usd: period.previousTotalUsd,
    period_from: period.periodFrom,
    period_to: null,                         // سيُملأ وقت الحفظ
    period_profit: period.periodProfit,
    daily_count: period.dailyCount,
    items_count: snap.items.length,
  };
}

function saveMonthly(notes = '') {
  const snap = getCurrentSnapshot();
  const period = computePeriodProfit();
  const date = new Date().toISOString().split('T')[0];

  const tx = db.transaction(() => {
    const ins = db.prepare(`
      INSERT INTO monthly_inventories (
        date, exchange_rate, total_try, total_usd, total_converted_usd,
        previous_monthly_id, previous_total_usd,
        period_from, period_to, period_profit, daily_count, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
    `).run(
      date, snap.exchangeRate, snap.totalTry, snap.totalUsd, snap.totalConvertedUsd,
      period.previousMonthlyId, period.previousTotalUsd,
      period.periodFrom, period.periodProfit, period.dailyCount, notes || ''
    );

    const monthlyId = ins.lastInsertRowid;
    const insItem = db.prepare(`
      INSERT INTO monthly_inventory_items
        (monthly_inventory_id, item_id, item_name, try_amount, usd_amount, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const it of snap.items) {
      insItem.run(monthlyId, it.id, it.name, it.try_amount || 0, it.usd_amount || 0, it.notes || '');
    }
    return monthlyId;
  });

  const id = tx();
  return {
    id,
    date,
    is_first: !period.previousMonthlyId,
    exchange_rate: snap.exchangeRate,
    total_try: snap.totalTry,
    total_usd: snap.totalUsd,
    total_converted_usd: snap.totalConvertedUsd,
    previous_total_usd: period.previousTotalUsd,
    period_profit: period.periodProfit,
    daily_count: period.dailyCount,
  };
}

export default router;
