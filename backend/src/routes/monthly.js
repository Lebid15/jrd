import { Router } from 'express';
import db from '../database.js';
import { tid } from '../tenantHelpers.js';

const router = Router();
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ─── GET /api/monthly — قائمة الجرود الشهرية ─────────────────────────────────
router.get('/', (req, res) => {
  const t = tid(req);
  const { limit = 50, offset = 0, from, to, profit_sign, q } = req.query;

  const where = ['tenant_id = ?'];
  const params = [t];

  if (from)      { where.push("date(date) >= date(?)"); params.push(from); }
  if (to)        { where.push("date(date) <= date(?)"); params.push(to); }
  if (profit_sign === 'positive')      where.push('COALESCE(period_profit, 0) >= 0');
  else if (profit_sign === 'negative') where.push('COALESCE(period_profit, 0) < 0');
  if (q && String(q).trim()) {
    where.push('notes LIKE ?');
    params.push(`%${String(q).trim()}%`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const inventories = db.prepare(`
    SELECT * FROM monthly_inventories
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), parseInt(offset));

  const total = db.prepare(
    `SELECT COUNT(*) as cnt FROM monthly_inventories ${whereSql}`
  ).get(...params).cnt;

  res.json({ inventories, total });
});

router.get('/:id', (req, res) => {
  const t = tid(req);
  const inv = db.prepare('SELECT * FROM monthly_inventories WHERE id = ? AND tenant_id = ?').get(req.params.id, t);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare(`
    SELECT * FROM monthly_inventory_items
    WHERE monthly_inventory_id = ? AND tenant_id = ?
    ORDER BY id ASC
  `).all(req.params.id, t);
  res.json({ ...inv, items });
});

router.get('/last/one', (req, res) => {
  const t = tid(req);
  const inv = db.prepare('SELECT * FROM monthly_inventories WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1').get(t);
  if (!inv) return res.json(null);
  const items = db.prepare(`
    SELECT * FROM monthly_inventory_items WHERE monthly_inventory_id = ? AND tenant_id = ? ORDER BY id ASC
  `).all(inv.id, t);
  res.json({ ...inv, items });
});

router.get('/preview/next', (req, res) => {
  const t = tid(req);
  res.json(computePreview(t));
});

router.post('/', (req, res) => {
  try {
    const t = tid(req);
    const { notes } = req.body || {};
    const result = saveMonthly(t, notes);
    res.json(result);
  } catch (e) {
    console.error('[monthly create]', e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const t = tid(req);
  const info = db.prepare('DELETE FROM monthly_inventories WHERE id = ? AND tenant_id = ?').run(req.params.id, t);
  res.json({ ok: true, deleted: info.changes });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function getCurrentSnapshot(tenantId) {
  const rateRow = db.prepare('SELECT value FROM settings WHERE tenant_id = ? AND key = ?').get(tenantId, 'exchange_rate');
  const exchangeRate = parseFloat(rateRow?.value || '1') || 1;

  const items = db.prepare(`
    SELECT i.id, i.name, cv.try_amount, cv.usd_amount, cv.notes
    FROM items i
    LEFT JOIN current_values cv ON cv.item_id = i.id AND cv.tenant_id = i.tenant_id
    WHERE i.is_active = 1 AND i.tenant_id = ?
    ORDER BY i.sort_order ASC, i.id ASC
  `).all(tenantId);

  let totalTry = 0, totalUsd = 0;
  for (const it of items) {
    totalTry += it.try_amount || 0;
    totalUsd += it.usd_amount || 0;
  }
  const tryToUsd = exchangeRate > 0 ? totalTry / exchangeRate : 0;
  const totalConvertedUsd = r2(totalUsd + tryToUsd);

  return { exchangeRate, items, totalTry: r2(totalTry), totalUsd: r2(totalUsd), totalConvertedUsd };
}

function computePeriodProfit(tenantId) {
  const lastMonthly = db.prepare(
    'SELECT id, created_at, total_converted_usd FROM monthly_inventories WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(tenantId);

  if (!lastMonthly) {
    return { previousMonthlyId: null, previousTotalUsd: 0, periodFrom: '', periodProfit: 0, dailyCount: 0 };
  }

  const row = db.prepare(`
    SELECT COALESCE(SUM(profit), 0) as total_profit, COUNT(*) as cnt
    FROM inventories
    WHERE tenant_id = ? AND created_at > ?
  `).get(tenantId, lastMonthly.created_at);

  return {
    previousMonthlyId: lastMonthly.id,
    previousTotalUsd: r2(lastMonthly.total_converted_usd || 0),
    periodFrom: lastMonthly.created_at,
    periodProfit: r2(row?.total_profit || 0),
    dailyCount: row?.cnt || 0,
  };
}

function computePreview(tenantId) {
  const snap = getCurrentSnapshot(tenantId);
  const period = computePeriodProfit(tenantId);
  return {
    is_first: !period.previousMonthlyId,
    exchange_rate: snap.exchangeRate,
    total_try: snap.totalTry,
    total_usd: snap.totalUsd,
    total_converted_usd: snap.totalConvertedUsd,
    previous_total_usd: period.previousTotalUsd,
    period_from: period.periodFrom,
    period_to: null,
    period_profit: period.periodProfit,
    daily_count: period.dailyCount,
    items_count: snap.items.length,
  };
}

function saveMonthly(tenantId, notes = '') {
  const snap = getCurrentSnapshot(tenantId);
  const period = computePeriodProfit(tenantId);
  const date = new Date().toISOString().split('T')[0];

  const tx = db.transaction(() => {
    const ins = db.prepare(`
      INSERT INTO monthly_inventories (
        tenant_id, date, exchange_rate, total_try, total_usd, total_converted_usd,
        previous_monthly_id, previous_total_usd,
        period_from, period_to, period_profit, daily_count, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
    `).run(
      tenantId, date, snap.exchangeRate, snap.totalTry, snap.totalUsd, snap.totalConvertedUsd,
      period.previousMonthlyId, period.previousTotalUsd,
      period.periodFrom, period.periodProfit, period.dailyCount, notes || ''
    );

    const monthlyId = ins.lastInsertRowid;
    const insItem = db.prepare(`
      INSERT INTO monthly_inventory_items
        (tenant_id, monthly_inventory_id, item_id, item_name, try_amount, usd_amount, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of snap.items) {
      insItem.run(tenantId, monthlyId, it.id, it.name, it.try_amount || 0, it.usd_amount || 0, it.notes || '');
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
