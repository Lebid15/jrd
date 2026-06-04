import { Router } from 'express';
import crypto from 'crypto';
import db from '../database.js';

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

// ingest فقط يحتاج auth (يُستدعى من البوت)
router.post('/ingest', internalAuth, (req, res) => {
  const { tenant_id, group_id, group_name, sender, sender_name, message_id, text, is_group } = req.body;
  if (!text || !group_id) return res.status(400).json({ error: 'text and group_id required' });

  // فلترة: نقبل فقط رسائل المجموعات من القائمة المعتمدة
  if (!is_group || !isGroupAllowed(group_name)) {
    return res.json({ ok: true, filtered: true });
  }

  db.prepare(`
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

  res.json({ ok: true });
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
 * GET /api/internal/whatsapp/messages?limit=50
 * آخر الرسائل الواردة
 */
router.get('/whatsapp/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT * FROM whatsapp_messages ORDER BY id DESC LIMIT ?
  `).all(limit);
  res.json(rows);
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

export default router;
