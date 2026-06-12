/**
 * Admin routes — إدارة المستأجرين والمستخدمين.
 *
 * كل المسارات تحت /api/admin/* تتطلّب role=admin (يُفرض في index.js).
 *
 * Routes:
 *   GET    /tenants                 — قائمة المستأجرين
 *   POST   /tenants                 — إنشاء مستأجر جديد (+ owner اختيارياً)
 *   PATCH  /tenants/:id             — تعديل (الاسم، is_active، notes)
 *   DELETE /tenants/:id             — حذف (cascade على كل بياناته)
 *   POST   /tenants/:id/rotate-webhook-secret — توليد/تدوير secret الـ SMS webhook
 *   GET    /tenants/:id/webhook-status        — حالة secret (مُسجَّل/لا) دون كشفه
 *
 *   GET    /users                   — قائمة المستخدمين (مع فلتر tenant_id)
 *   POST   /users                   — إنشاء مستخدم (admin أو owner)
 *   PATCH  /users/:id               — تعديل (الإيميل، is_active، password اختيارياً)
 *   DELETE /users/:id               — حذف
 *   POST   /users/:id/revoke-sessions — قطع كل جلسات المستخدم
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../database.js';

const router = Router();

const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// ─── Tenants ────────────────────────────────────────────────────────────────

router.get('/tenants', (req, res) => {
  const rows = db.prepare(`
    SELECT
      t.id, t.name, t.slug, t.is_active, t.notes, t.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS users_count,
      (SELECT COUNT(*) FROM items i WHERE i.tenant_id = t.id) AS items_count
    FROM tenants t
    ORDER BY t.id ASC
  `).all();
  res.json(rows);
});

router.post('/tenants', (req, res) => {
  const name = String(req.body?.name || '').trim();
  let slug = String(req.body?.slug || '').trim().toLowerCase();
  const notes = String(req.body?.notes || '').trim() || null;
  const ownerEmail = String(req.body?.owner_email || '').trim().toLowerCase();
  const ownerPassword = String(req.body?.owner_password || '');

  if (!name) return res.status(400).json({ error: 'name required' });
  if (!slug) slug = slugify(name);
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug (use 2-40 chars: a-z, 0-9, -)' });

  const dup = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug);
  if (dup) return res.status(409).json({ error: 'slug already exists' });

  // owner اختياري — لكن لو طُلب يجب صحّة الإيميل والباسوورد
  if (ownerEmail || ownerPassword) {
    if (!EMAIL_RE.test(ownerEmail)) return res.status(400).json({ error: 'invalid owner_email' });
    if (ownerPassword.length < 8) return res.status(400).json({ error: 'owner_password must be ≥ 8 chars' });
    const emailDup = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
    if (emailDup) return res.status(409).json({ error: 'owner_email already used' });
  }

  const result = db.transaction(() => {
    const ins = db.prepare(`
      INSERT INTO tenants (name, slug, is_active, notes) VALUES (?, ?, 1, ?)
    `).run(name, slug, notes);
    const tenantId = ins.lastInsertRowid;

    let owner = null;
    if (ownerEmail) {
      const hash = bcrypt.hashSync(ownerPassword, 10);
      const u = db.prepare(`
        INSERT INTO users (tenant_id, email, password_hash, role, is_active)
        VALUES (?, ?, ?, 'owner', 1)
      `).run(tenantId, ownerEmail, hash);
      owner = { id: u.lastInsertRowid, email: ownerEmail, role: 'owner' };
    }

    return { tenantId, owner };
  })();

  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(result.tenantId);
  res.status(201).json({ tenant, owner: result.owner });
});

router.patch('/tenants/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const exists = db.prepare('SELECT id FROM tenants WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'tenant not found' });

  const fields = [];
  const params = [];
  if (req.body?.name !== undefined) {
    const v = String(req.body.name).trim();
    if (!v) return res.status(400).json({ error: 'name cannot be empty' });
    fields.push('name = ?'); params.push(v);
  }
  if (req.body?.is_active !== undefined) {
    fields.push('is_active = ?'); params.push(req.body.is_active ? 1 : 0);
  }
  if (req.body?.notes !== undefined) {
    fields.push('notes = ?'); params.push(String(req.body.notes).trim() || null);
  }
  if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
  params.push(id);
  db.prepare(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM tenants WHERE id = ?').get(id));
});

router.delete('/tenants/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  if (id === 1) return res.status(400).json({ error: 'cannot delete default tenant' });
  const info = db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'tenant not found' });
  res.json({ ok: true });
});

/**
 * POST /api/admin/tenants/:id/rotate-webhook-secret
 * يولّد secret جديد للـ SMS webhook الخاصّ بالمستأجر ويُعيده مرّة واحدة.
 * يستبدل الـ secret القديم (URL القديم يتوقّف فوراً).
 */
router.post('/tenants/:id/rotate-webhook-secret', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const tenant = db.prepare('SELECT id, slug FROM tenants WHERE id = ?').get(id);
  if (!tenant) return res.status(404).json({ error: 'tenant not found' });

  const secret = crypto.randomBytes(24).toString('base64url');
  db.prepare(`
    INSERT INTO settings (tenant_id, key, value, updated_at)
    VALUES (?, 'sms_webhook_secret', ?, datetime('now'))
    ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(id, secret);

  res.json({
    ok: true,
    tenant_id: id,
    tenant_slug: tenant.slug,
    secret,
    webhook_path: `/api/webhooks/bank-sms/${secret}`,
    notice: 'احفظ هذا الـ secret الآن — لن يظهر ثانية. الـ URL القديم متوقّف.',
  });
});

/**
 * GET /api/admin/tenants/:id/webhook-status
 * يخبر هل لـ tenant secret مُسجَّل (دون كشفه).
 */
router.get('/tenants/:id/webhook-status', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const row = db.prepare(`
    SELECT updated_at FROM settings WHERE tenant_id = ? AND key = 'sms_webhook_secret'
  `).get(id);
  res.json({
    tenant_id: id,
    configured: !!row,
    last_rotated_at: row?.updated_at || null,
  });
});

// ─── Users ──────────────────────────────────────────────────────────────────

router.get('/users', (req, res) => {
  const tenantId = req.query.tenant_id ? parseInt(req.query.tenant_id) : null;
  let rows;
  if (tenantId) {
    rows = db.prepare(`
      SELECT u.id, u.tenant_id, u.email, u.role, u.is_active, u.last_login_at, u.created_at,
             t.name AS tenant_name, t.slug AS tenant_slug
      FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.tenant_id = ?
      ORDER BY u.id ASC
    `).all(tenantId);
  } else {
    rows = db.prepare(`
      SELECT u.id, u.tenant_id, u.email, u.role, u.is_active, u.last_login_at, u.created_at,
             t.name AS tenant_name, t.slug AS tenant_slug
      FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      ORDER BY u.id ASC
    `).all();
  }
  res.json(rows);
});

router.post('/users', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'owner';
  const tenantId = role === 'admin' ? null : parseInt(req.body?.tenant_id);

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be ≥ 8 chars' });
  if (role === 'owner') {
    if (!tenantId) return res.status(400).json({ error: 'tenant_id required for owner' });
    const t = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
    if (!t) return res.status(404).json({ error: 'tenant not found' });
  }
  const dup = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (dup) return res.status(409).json({ error: 'email already used' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (tenant_id, email, password_hash, role, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(tenantId, email, hash, role);

  res.status(201).json({
    id: info.lastInsertRowid,
    tenant_id: tenantId,
    email,
    role,
    is_active: 1,
  });
});

router.patch('/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'user not found' });

  const fields = [];
  const params = [];
  if (req.body?.email !== undefined) {
    const v = String(req.body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return res.status(400).json({ error: 'invalid email' });
    const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(v, id);
    if (dup) return res.status(409).json({ error: 'email already used' });
    fields.push('email = ?'); params.push(v);
  }
  if (req.body?.is_active !== undefined) {
    // منع تعطيل آخر admin مفعّل
    if (u.role === 'admin' && !req.body.is_active) {
      const otherAdmins = db.prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?"
      ).get(id);
      if ((otherAdmins?.c || 0) === 0) {
        return res.status(400).json({ error: 'cannot disable last active admin' });
      }
    }
    fields.push('is_active = ?'); params.push(req.body.is_active ? 1 : 0);
  }
  if (req.body?.password !== undefined) {
    const p = String(req.body.password);
    if (p.length < 8) return res.status(400).json({ error: 'password must be ≥ 8 chars' });
    fields.push('password_hash = ?'); params.push(bcrypt.hashSync(p, 10));
  }
  if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
  params.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);

  // لو تغيّر الباسوورد، نُلغي كل الجلسات
  if (req.body?.password !== undefined) {
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
  }

  const row = db.prepare(`
    SELECT id, tenant_id, email, role, is_active, last_login_at, created_at
    FROM users WHERE id = ?
  `).get(id);
  res.json(row);
});

router.delete('/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const u = db.prepare("SELECT id, role FROM users WHERE id = ?").get(id);
  if (!u) return res.status(404).json({ error: 'user not found' });
  if (u.role === 'admin') {
    const otherAdmins = db.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id != ?"
    ).get(id);
    if ((otherAdmins?.c || 0) === 0) {
      return res.status(400).json({ error: 'cannot delete last admin' });
    }
  }
  // منع حذف نفسه
  if (req.user?.id === id) {
    return res.status(400).json({ error: 'cannot delete yourself' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.post('/users/:id/revoke-sessions', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const info = db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
  res.json({ ok: true, revoked: info.changes });
});

export default router;
