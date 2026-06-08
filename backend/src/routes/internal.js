import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import os from 'os';
import db from '../database.js';
import { parseMessage, computeDelta, isAdminName } from '../whatsappParser.js';
import { parseSms } from './bank.js';

const router = Router();

// ─── Auth middleware (X-Internal-Api-Key) — للبوت فقط ───────────────────────
function internalAuth(req, res, next) {
  const key = process.env.INTERNAL_API_KEY || '';
  if (!key) return next();
  const provided = req.headers['x-internal-api-key'] || '';
  try {
    const a = Buffer.from(provided.padEnd(64));
    const b = Buffer.from(key.padEnd(64));
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Unauthorized' });
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Helpers: قائمة المجموعات المسموحة (settings table) ────────────────────
const ALLOWED_GROUPS_KEY = 'whatsapp_allowed_groups';

function normalizeName(s) {
  return String(s || '').trim().toLowerCase();
}

function getAllowedGroups() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(ALLOWED_GROUPS_KEY);
  if (!row) return [];
  try {
    const arr = JSON.parse(row.value);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function isGroupAllowed(groupName) {
  const list = getAllowedGroups();
  if (list.length === 0) return false; // قائمة فارغة = لا شيء مسموح (افتراضي آمن)
  const n = normalizeName(groupName);
  if (!n) return false;
  return list.some(g => normalizeName(g) === n);
}

// ─── Helpers: قراءة الكلمات المفتاحية من جدول settings ──────────────────────
const KW_KEYS = {
  us: 'whatsapp_kw_us',
  them: 'whatsapp_kw_them',
  try: 'whatsapp_kw_try',
  usd: 'whatsapp_kw_usd',
  ignore: 'whatsapp_kw_ignore',
};

function getKeywords() {
  const out = { us: [], them: [], try: [], usd: [], ignore: [] };
  for (const [k, key] of Object.entries(KW_KEYS)) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) {
      try {
        const arr = JSON.parse(row.value);
        if (Array.isArray(arr)) out[k] = arr;
      } catch {}
    }
  }
  return out;
}

function getAdminToken() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('whatsapp_admin_token');
  return row?.value || 'admin';
}

// ─── يبحث عن أوّل بند مربوط بمجموعة (بالاسم) ─────────────────────────────────
function findItemByGroupName(groupName) {
  const n = normalizeName(groupName);
  if (!n) return null;
  const rows = db.prepare(`
    SELECT ac.item_id, ac.whatsapp_group_name, i.name as item_name
    FROM api_configs ac
    JOIN items i ON i.id = ac.item_id
    WHERE ac.provider_type = 'whatsapp_group' AND i.is_active = 1
  `).all();
  for (const r of rows) {
    if (normalizeName(r.whatsapp_group_name) === n) return r;
  }
  return null;
}

// ingest فقط يحتاج auth (يُستدعى من البوت)
router.post('/ingest', internalAuth, (req, res) => {
  const { tenant_id, group_id, group_name, sender, sender_name, message_id, text, is_group } = req.body;
  if (!text || !group_id) return res.status(400).json({ error: 'text and group_id required' });

  const log = (decision, extra = {}) => {
    console.log('[ingest]', JSON.stringify({
      group_name, sender_name, text: text.slice(0, 80), decision, ...extra,
    }));
  };

  // فلترة: نقبل فقط رسائل المجموعات من القائمة المعتمدة
  if (!is_group) {
    log('skipped_not_group');
    return res.json({ ok: true, filtered: true, reason: 'not_group' });
  }
  if (!isGroupAllowed(group_name)) {
    log('skipped_group_not_allowed', { allowed_list: getAllowedGroups() });
    return res.json({ ok: true, filtered: true, reason: 'group_not_in_allowed_list' });
  }

  // 1) حفظ الرسالة الخام (للأرشيف والمراجعة)
  const info = db.prepare(`
    INSERT OR IGNORE INTO whatsapp_messages
      (tenant_id, group_id, group_name, sender, sender_name, message_id, text, is_group)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tenant_id || '1',
    group_id,
    group_name || null,
    sender || null,
    sender_name || null,
    message_id || null,
    text,
    is_group ? 1 : 0
  );

  // لو الرسالة مكرّرة (INSERT OR IGNORE لم يُدخِل)، اخرج
  if (!info.changes) return res.json({ ok: true, duplicate: true });
  const dbMessageId = info.lastInsertRowid;

  // 2) محاولة ربط المجموعة ببند (whatsapp_group provider)
  const link = findItemByGroupName(group_name);
  if (!link) {
    log('no_item_linked');
    return res.json({ ok: true, no_item_linked: true });
  }

  // 3) تحليل النصّ
  const parsed = parseMessage(text, getKeywords());
  if (!parsed) {
    log('parse_failed_no_match');
    return res.json({ ok: true, parsed: null, applied: false });
  }
  if (parsed.ignored) {
    log('parse_ignored', { reason: parsed.reason });
    return res.json({ ok: true, parsed, applied: false });
  }

  // 4) تحديد المصدر (us / them) من اسم المرسل
  const adminToken = getAdminToken();
  const source = isAdminName(sender_name, adminToken) ? 'us' : 'them';

  // 5) حساب الـ delta وتطبيقه على current_values
  const delta = computeDelta({ ...parsed, source });
  const field = parsed.currency === 'USD' ? 'usd_amount' : 'try_amount';

  const cv = db.prepare('SELECT id, try_amount, usd_amount FROM current_values WHERE item_id = ?').get(link.item_id);
  let balanceAfter;
  if (cv) {
    const current = parsed.currency === 'USD' ? (cv.usd_amount || 0) : (cv.try_amount || 0);
    balanceAfter = current + delta;
    db.prepare(`UPDATE current_values SET ${field} = ? WHERE item_id = ?`)
      .run(balanceAfter, link.item_id);
  } else {
    balanceAfter = delta;
    db.prepare(`INSERT INTO current_values (item_id, ${field}) VALUES (?, ?)`)
      .run(link.item_id, balanceAfter);
  }

  // 6) حفظ سجل العملية
  db.prepare(`
    INSERT INTO whatsapp_transactions
      (item_id, message_id, source, direction, currency, amount, delta, balance_after, raw_text, sender_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    link.item_id,
    dbMessageId,
    source,
    parsed.direction,
    parsed.currency,
    parsed.amount,
    delta,
    balanceAfter,
    text,
    sender_name || ''
  );

  log('applied', { item: link.item_name, source, ...parsed, delta, balance_after: balanceAfter });

  res.json({
    ok: true,
    applied: true,
    item_id: link.item_id,
    source,
    direction: parsed.direction,
    currency: parsed.currency,
    amount: parsed.amount,
    delta,
    balance_after: balanceAfter,
  });
});

/**
 * POST /api/internal/whatsapp/preview-parse
 * اختبار محلّل الرسائل بدون حفظ. body: { text, sender_name?, group_name? }
 */
router.post('/whatsapp/preview-parse', (req, res) => {
  const { text, sender_name, group_name } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const keywords = getKeywords();
  const parsed = parseMessage(text, keywords);
  const source = isAdminName(sender_name, getAdminToken()) ? 'us' : 'them';
  const delta = parsed && !parsed.ignored ? computeDelta({ ...parsed, source }) : null;
  const link = group_name ? findItemByGroupName(group_name) : null;
  res.json({
    text,
    sender_name: sender_name || null,
    group_name: group_name || null,
    keywords,
    admin_token: getAdminToken(),
    parsed,
    source,
    delta,
    linked_item: link || null,
    group_allowed: group_name ? isGroupAllowed(group_name) : null,
    allowed_groups: getAllowedGroups(),
  });
});

/**
 * GET /api/internal/whatsapp/allowed-groups
 * قائمة أسماء المجموعات المعتمدة
 */
router.get('/whatsapp/allowed-groups', (req, res) => {
  res.json({ groups: getAllowedGroups() });
});

/**
 * PUT /api/internal/whatsapp/allowed-groups
 * body: { groups: ["اسم المجموعة 1", "اسم المجموعة 2"] }
 */
router.put('/whatsapp/allowed-groups', (req, res) => {
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : null;
  if (!groups) return res.status(400).json({ error: 'groups array required' });
  const clean = groups.map(g => String(g || '').trim()).filter(Boolean);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(ALLOWED_GROUPS_KEY, JSON.stringify(clean));
  res.json({ groups: clean });
});

/**
 * GET /api/internal/whatsapp/health
 * فحص قابلية الوصول للبوت (مستقل عن وجود جلسة)
 *  - reachable=true → البوت يعمل
 *  - reachable=false → البوت متوقف أو BOT_URL خاطئ
 */
router.get('/whatsapp/health', async (req, res) => {
  const botUrl = process.env.BOT_URL || 'http://localhost:3100';
  try {
    const r = await fetch(`${botUrl}/healthz`);
    if (!r.ok) return res.json({ reachable: false, error: `bot_status_${r.status}` });
    const data = await r.json();
    res.json({ reachable: true, ...data });
  } catch (e) {
    res.json({ reachable: false, error: e.code || 'bot_unreachable' });
  }
});

/**
 * GET /api/internal/whatsapp/status
 * الواجهة تستعلم عن حالة جلسة الواتساب من البوت
 *  - 404 من البوت = البوت يعمل لكن لا توجد جلسة بعد ("idle")
 *  - فشل الاتصال أو 5xx = البوت غير متاح ("offline")
 *  - 401 = مشكلة في INTERNAL_API_KEY
 */
router.get('/whatsapp/status', async (req, res) => {
  const botUrl = process.env.BOT_URL || 'http://localhost:3100';
  const key = process.env.INTERNAL_API_KEY || '';
  try {
    const r = await fetch(`${botUrl}/sessions/1`, {
      headers: { 'X-Internal-Api-Key': key },
    });
    if (r.status === 404) return res.json({ state: 'idle' });
    if (r.status === 401) return res.json({ state: 'offline', error: 'auth_mismatch' });
    if (!r.ok) return res.json({ state: 'offline', error: `bot_status_${r.status}` });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.json({ state: 'offline', error: e.code || 'bot_unreachable' });
  }
});

/**
 * POST /api/internal/whatsapp/start
 * الواجهة تطلب بدء/إعادة ربط الجلسة
 */
router.post('/whatsapp/start', async (req, res) => {
  const botUrl = process.env.BOT_URL || 'http://localhost:3100';
  const key = process.env.INTERNAL_API_KEY || '';
  try {
    const force = req.query.force === '1';
    const r = await fetch(`${botUrl}/sessions/1/start${force ? '?force=1' : ''}`, {
      method: 'POST',
      headers: { 'X-Internal-Api-Key': key, 'Content-Type': 'application/json' },
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/internal/whatsapp/reset
 * مسح كامل لمجلد auth للجلسة + بدء جلسة جديدة (للجلسات العالقة)
 */
router.post('/whatsapp/reset', async (req, res) => {
  const botUrl = process.env.BOT_URL || 'http://localhost:3100';
  const key = process.env.INTERNAL_API_KEY || '';
  try {
    const r = await fetch(`${botUrl}/sessions/1/reset`, {
      method: 'POST',
      headers: { 'X-Internal-Api-Key': key, 'Content-Type': 'application/json' },
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/internal/whatsapp/logout
 */
router.post('/whatsapp/logout', async (req, res) => {
  const botUrl = process.env.BOT_URL || 'http://localhost:3100';
  const key = process.env.INTERNAL_API_KEY || '';
  try {
    await fetch(`${botUrl}/sessions/1/logout`, {
      method: 'POST',
      headers: { 'X-Internal-Api-Key': key },
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/internal/whatsapp/messages
 * Query params:
 *   - page (default 1)
 *   - pageSize (default 20, max 100)
 *   - financial_only (1 = الرسائل المالية فقط — التي حُلِّلت كحركة لنا/لكم)
 *   - q (بحث في النص أو اسم المرسل أو المجموعة)
 *   - limit (توافق رجعي: لو مُمرَّر، يُتجاهل page/pageSize)
 * Returns: { items, total, page, pageSize, totalPages }
 *  - عند تمرير `limit` فقط: يُرجع المصفوفة المسطّحة (للحفاظ على التوافق).
 */
router.get('/whatsapp/messages', (req, res) => {
  // التوافق الرجعي: لو `limit` مُمرَّر، يرجع المصفوفة كما كان
  if (req.query.limit && !req.query.page && !req.query.pageSize) {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const rows = db.prepare(`
      SELECT * FROM whatsapp_messages ORDER BY id DESC LIMIT ?
    `).all(limit);
    return res.json(rows);
  }

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const financialOnly = req.query.financial_only === '1' || req.query.financial_only === 'true';
  const q = String(req.query.q || '').trim();

  const where = [];
  const params = [];

  if (financialOnly) {
    // الرسائل المالية = التي لها سجلّ في whatsapp_transactions
    where.push(`EXISTS (SELECT 1 FROM whatsapp_transactions t WHERE t.message_id = m.id)`);
  }

  if (q) {
    where.push(`(m.text LIKE ? OR m.sender_name LIKE ? OR m.group_name LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM whatsapp_messages m ${whereSql}
  `).get(...params);
  const total = totalRow?.cnt || 0;

  const items = db.prepare(`
    SELECT
      m.*,
      t.id        as tx_id,
      t.source    as tx_source,
      t.direction as tx_direction,
      t.currency  as tx_currency,
      t.amount    as tx_amount,
      t.delta     as tx_delta,
      t.balance_after as tx_balance_after,
      i.name      as tx_item_name
    FROM whatsapp_messages m
    LEFT JOIN whatsapp_transactions t ON t.message_id = m.id
    LEFT JOIN items i ON i.id = t.item_id
    ${whereSql}
    ORDER BY m.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

/**
 * DELETE /api/internal/whatsapp/messages/:id
 * حذف رسالة واحدة (وحركتها المرتبطة عبر FK ON DELETE SET NULL — تبقى الحركة).
 */
router.delete('/whatsapp/messages/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const info = db.prepare('DELETE FROM whatsapp_messages WHERE id = ?').run(id);
  res.json({ ok: true, deleted: info.changes });
});

/**
 * POST /api/internal/whatsapp/messages/delete-bulk
 * body: { ids: [1,2,3] }
 */
router.post('/whatsapp/messages/delete-bulk', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(n => parseInt(n)).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'ids array required' });
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM whatsapp_messages WHERE id IN (${placeholders})`).run(...ids);
  res.json({ ok: true, deleted: info.changes });
});

/**
 * GET /api/internal/whatsapp/groups
 * كل المجموعات التي وصلت منها رسائل (لاكتشاف الأسماء الصحيحة)
 */
router.get('/whatsapp/groups', (req, res) => {
  const rows = db.prepare(`
    SELECT group_name, group_id, COUNT(*) as msg_count, MAX(created_at) as last_at
    FROM whatsapp_messages
    WHERE is_group = 1 AND group_name IS NOT NULL AND group_name != ''
    GROUP BY group_name
    ORDER BY last_at DESC
  `).all();
  res.json(rows);
});

/**
 * GET /api/internal/whatsapp/all-groups
 * كل مجموعات الحساب على واتساب مباشرةً (من البوت)
 */
router.get('/whatsapp/all-groups', async (req, res) => {
  const botUrl = process.env.BOT_URL || 'http://localhost:3100';
  const key = process.env.INTERNAL_API_KEY || '';
  try {
    const r = await fetch(`${botUrl}/sessions/1/groups`, {
      headers: { 'X-Internal-Api-Key': key },
    });
    if (!r.ok) return res.json([]);
    const data = await r.json();
    res.json(data);
  } catch {
    res.json([]);
  }
});

/**
 * GET /api/internal/whatsapp/keywords
 * كل قوائم الكلمات + الرمز الإداري (admin token)
 */
router.get('/whatsapp/keywords', (req, res) => {
  res.json({
    us: getKeywords().us,
    them: getKeywords().them,
    try: getKeywords().try,
    usd: getKeywords().usd,
    ignore: getKeywords().ignore,
    admin_token: getAdminToken(),
  });
});

/**
 * PUT /api/internal/whatsapp/keywords
 * body: { us:[], them:[], try:[], usd:[], ignore:[], admin_token:'admin' }
 */
router.put('/whatsapp/keywords', (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const cleanArr = (a) => Array.isArray(a) ? a.map(s => String(s || '').trim()).filter(Boolean) : null;

  const fields = { us: KW_KEYS.us, them: KW_KEYS.them, try: KW_KEYS.try, usd: KW_KEYS.usd, ignore: KW_KEYS.ignore };
  for (const [k, settingKey] of Object.entries(fields)) {
    const arr = cleanArr(req.body?.[k]);
    if (arr) upsert.run(settingKey, JSON.stringify(arr));
  }
  if (req.body?.admin_token && typeof req.body.admin_token === 'string') {
    upsert.run('whatsapp_admin_token', req.body.admin_token.trim() || 'admin');
  }
  res.json({ ok: true });
});

/**
 * GET /api/internal/whatsapp/transactions?item_id=...&limit=50
 * سجلّ العمليات المُحلَّلة لبند معيّن
 */
router.get('/whatsapp/transactions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const itemId = req.query.item_id;
  let rows;
  if (itemId) {
    rows = db.prepare(`
      SELECT * FROM whatsapp_transactions WHERE item_id = ?
      ORDER BY id DESC LIMIT ?
    `).all(itemId, limit);
  } else {
    rows = db.prepare(`
      SELECT t.*, i.name as item_name FROM whatsapp_transactions t
      LEFT JOIN items i ON i.id = t.item_id
      ORDER BY t.id DESC LIMIT ?
    `).all(limit);
  }
  res.json(rows);
});

// ─── Bank message ingest (Google Messages Web scraper) ──────────────────────
/**
 * POST /api/internal/bank-message/ingest
 * يُستدعى من خدمة messages-scraper (port 3101) لكل رسالة جديدة من KUVEYT TURK.
 *
 * Body: {
 *   source: 'gmsg',
 *   contact_name: 'KUVEYT TURK',
 *   text: '<full message text>',
 *   occurred_at: '...'           // اختياري
 *   external_id: '<hash 24 hex>' // ضروري لمنع التكرار
 * }
 *
 * يُعيد استخدام نفس parseSms من routes/bank.js (= صفر مخاطرة على المنطق الحالي).
 * يُخزّن في bank_transactions مع source='gmsg' و external_id (UNIQUE).
 */
router.post('/bank-message/ingest', internalAuth, (req, res) => {
  const { source, text, external_id, occurred_at, contact_name } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }
  if (!external_id) {
    return res.status(400).json({ error: 'external_id required' });
  }
  const effSource = source === 'gmsg' ? 'gmsg' : 'gmsg'; // حالياً نقبل gmsg فقط من هذا الـ endpoint

  // dedup: لو سبق ودخلت هذه الرسالة بنفس external_id، نُرجع duplicate دون تعديل أي شيء
  const existing = db.prepare(
    'SELECT id FROM bank_transactions WHERE external_id = ?'
  ).get(external_id);
  if (existing) {
    return res.json({ ok: true, duplicate: true, transaction_id: existing.id });
  }

  // parse — نفس parser SMS الحالي
  const parsed = parseSms(text);
  if (!parsed) {
    // نسجّل المحاولة في bank_sms_log كي تظهر في لوحة التشخيص
    db.prepare(`
      INSERT INTO bank_sms_log
        (ip, secret_ok, parse_status, error_message, sender, raw_body, item_id, direction, amount, transaction_id)
      VALUES (?, 1, 'no_pattern', ?, ?, ?, NULL, '', NULL, NULL)
    `).run('gmsg-scraper', 'gmsg: pattern not matched', contact_name || '', text);
    return res.status(422).json({ ok: false, error: 'no_pattern' });
  }

  // اعثر على أوّل بند bank مُفعَّل (نفس منطق webhook الحالي)
  const bankItem = db.prepare(`
    SELECT i.id, cv.try_amount
    FROM items i LEFT JOIN current_values cv ON cv.item_id = i.id
    WHERE i.type = 'bank' AND i.is_active = 1
    ORDER BY i.sort_order ASC LIMIT 1
  `).get();
  if (!bankItem) {
    db.prepare(`
      INSERT INTO bank_sms_log
        (ip, secret_ok, parse_status, error_message, sender, raw_body, item_id, direction, amount, transaction_id)
      VALUES (?, 1, 'no_bank_item', 'No active bank item', ?, ?, NULL, ?, ?, NULL)
    `).run('gmsg-scraper', contact_name || '', text, parsed.direction, parsed.amount);
    return res.status(404).json({ ok: false, error: 'no_bank_item' });
  }

  const currentBalance = bankItem.try_amount || 0;
  const newBalance = parsed.direction === 'in'
    ? currentBalance + parsed.amount
    : currentBalance - parsed.amount;

  // atomic: update balance + insert tx (مع external_id) + log
  let txId;
  try {
    txId = db.transaction(() => {
      db.prepare('UPDATE current_values SET try_amount = ? WHERE item_id = ?')
        .run(newBalance, bankItem.id);

      const ins = db.prepare(`
        INSERT INTO bank_transactions
          (item_id, direction, amount, sender_receiver, description, transaction_time,
           raw_sms, balance_after, source, external_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        bankItem.id,
        parsed.direction,
        parsed.amount,
        parsed.senderReceiver,
        parsed.description,
        parsed.transactionTime || occurred_at || '',
        text,
        newBalance,
        'gmsg',
        external_id,
      );
      const newId = ins.lastInsertRowid;

      db.prepare(`
        INSERT INTO bank_sms_log
          (ip, secret_ok, parse_status, error_message, sender, raw_body, item_id, direction, amount, transaction_id)
        VALUES (?, 1, 'applied', '', ?, ?, ?, ?, ?, ?)
      `).run('gmsg-scraper', contact_name || '', text, bankItem.id, parsed.direction, parsed.amount, newId);

      return newId;
    })();
  } catch (e) {
    // SQLITE_CONSTRAINT_UNIQUE → سباق مع طلب آخر بنفس external_id
    if (String(e.message).includes('UNIQUE')) {
      const existing2 = db.prepare(
        'SELECT id FROM bank_transactions WHERE external_id = ?'
      ).get(external_id);
      return res.json({ ok: true, duplicate: true, transaction_id: existing2?.id });
    }
    return res.status(500).json({ ok: false, error: e.message });
  }

  res.json({
    ok: true,
    applied: true,
    transaction_id: txId,
    direction: parsed.direction,
    amount: parsed.amount,
    balance_before: currentBalance,
    balance_after: newBalance,
    source: effSource,
  });
});

// ─── Bank source status (proxy إلى messages-scraper) ────────────────────────
/**
 * GET /api/internal/bank-message/status
 * الواجهة تستعلم عن حالة messages-scraper (port 3101).
 *  - reachable=false → الخدمة غير متاحة
 */
router.get('/bank-message/status', async (req, res) => {
  const url = process.env.GMSG_SCRAPER_URL || 'http://127.0.0.1:3101';
  const key = process.env.INTERNAL_API_KEY || '';
  try {
    const r = await fetch(`${url}/status`, {
      headers: { 'X-Internal-Api-Key': key },
    });
    if (!r.ok) return res.json({ reachable: false, error: `http_${r.status}` });
    const data = await r.json();
    res.json({ reachable: true, ...data });
  } catch (e) {
    res.json({ reachable: false, error: e.code || 'unreachable' });
  }
});

/**
 * POST /api/internal/bank-message/start
 * أمر بدء/استئناف خدمة messages-scraper
 */
router.post('/bank-message/start', async (req, res) => {
  const url = process.env.GMSG_SCRAPER_URL || 'http://127.0.0.1:3101';
  const key = process.env.INTERNAL_API_KEY || '';
  try {
    const r = await fetch(`${url}/start`, {
      method: 'POST',
      headers: { 'X-Internal-Api-Key': key, 'Content-Type': 'application/json' },
    });
    const data = await r.json().catch(() => ({}));
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.code || e.message });
  }
});

// ─── Session upload (لتجديد جلسة Google Messages على السيرفر) ───────────────
/**
 * POST /api/internal/bank-message/upload-session
 * multipart/form-data: field name "session" = ملف ZIP لـ browser-data/
 *
 * فك الـ zip في GMSG_BROWSER_DATA (افتراضياً /data/gmsg-browser-data)،
 * ثم يُرسِل أمر restart لخدمة messages-scraper كي تستأنف بالجلسة الجديدة.
 */
const sessionUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `gmsg-session-${Date.now()}.zip`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB سقف آمن
  fileFilter: (req, file, cb) => {
    if (/\.zip$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('يجب أن يكون الملف بصيغة .zip'));
  },
});

// قفل بسيط في الذاكرة لمنع الرفع المتزامن المتعدّد (Cloudflare retry, double-click, ...)
let _uploadInProgress = false;
let _lastUploadAt = 0;

router.post('/bank-message/upload-session', sessionUpload.single('session'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ملف ZIP مطلوب (field name=session)' });

  // ارفض رفعاً جديداً إذا كان السابق ما زال يعمل أو انتهى منذ <5 دقائق
  const now = Date.now();
  if (_uploadInProgress) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(409).json({ error: 'رفع آخر قيد التنفيذ — انتظر…' });
  }
  if (now - _lastUploadAt < 5 * 60_000) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    const waitSec = Math.ceil((5 * 60_000 - (now - _lastUploadAt)) / 1000);
    return res.status(429).json({ error: `تم رفع جلسة قبل قليل — انتظر ${waitSec} ثانية` });
  }
  _uploadInProgress = true;

  const dest = process.env.GMSG_BROWSER_DATA
    || path.resolve(process.cwd(), '..', 'messages-scraper', 'browser-data');

  let entriesCount = 0;
  let restartResult = null;
  try {
    // 1) أوقِف الـ scraper أوّلاً (force=1 لتجاوز حماية pairing)
    const url = process.env.GMSG_SCRAPER_URL || 'http://127.0.0.1:3101';
    const key = process.env.INTERNAL_API_KEY || '';
    try {
      await fetch(`${url}/stop?force=1`, {
        method: 'POST',
        headers: { 'X-Internal-Api-Key': key },
      });
    } catch (_) { /* الـ scraper قد يكون متوقّفاً أصلاً */ }

    // انتظار قصير حتى يُحرّر Chromium الملفات على Windows
    await new Promise(r => setTimeout(r, 1500));

    // 2) فرّغ المجلد القديم (احتفظ بالمجلد نفسه)
    if (fs.existsSync(dest)) {
      for (const entry of fs.readdirSync(dest)) {
        try {
          fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
        } catch (_) { /* تجاهل قفل ملف عابر */ }
      }
    } else {
      fs.mkdirSync(dest, { recursive: true });
    }

    // 3) فكّ ZIP
    const zip = new AdmZip(req.file.path);
    const entries = zip.getEntries();
    entriesCount = entries.length;
    if (entriesCount === 0) {
      return res.status(400).json({ error: 'الـ ZIP فارغ' });
    }
    // فحص بسيط لمنع zip-slip
    for (const e of entries) {
      const full = path.resolve(dest, e.entryName);
      if (!full.startsWith(path.resolve(dest))) {
        return res.status(400).json({ error: 'ملف خارج المسار في الـ ZIP' });
      }
    }
    zip.extractAllTo(dest, true);

    // إزالة ملفات قفل Chromium المتبقّية (تُسبّب hang عند الإقلاع على Linux)
    for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { fs.rmSync(path.join(dest, lockName), { force: true }); } catch (_) {}
    }

    // 4) سجّل وقت آخر تحديث للجلسة (يظهر في الواجهة)
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('gmsg_session_uploaded_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(new Date().toISOString());

    // 5) أعد تشغيل الـ scraper (fire-and-forget — لا ننتظر pairing/التشغيل الكامل)
    //    استدعاء /start قد يستغرق حتى 300 ثانية لانتظار قشرة الواجهة،
    //    لذلك نُطلقه بدون await ونرجع للواجهة فوراً.
    fetch(`${url}/start`, {
      method: 'POST',
      headers: { 'X-Internal-Api-Key': key, 'Content-Type': 'application/json' },
    }).catch(() => { /* الواجهة تتابع الحالة عبر /status */ });
    restartResult = { dispatched: true };

    res.json({
      ok: true,
      extracted_entries: entriesCount,
      dest,
      restart: restartResult,
    });
  } catch (e) {
    res.status(500).json({ error: e.message, where: 'unzip_or_restart' });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    _uploadInProgress = false;
    _lastUploadAt = Date.now();
  }
});

/**
 * GET /api/internal/bank-message/session-info
 * متى آخر مرّة رُفعت جلسة Google Messages.
 */
router.get('/bank-message/session-info', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'gmsg_session_uploaded_at'").get();
  res.json({
    uploaded_at: row?.value || null,
  });
});

export default router;
