/**
 * routes/auth.js — تسجيل دخول / خروج / معلومات المستخدم الحالي.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../database.js';
import { issueToken, revokeToken, requireAuth, cookieOptions, AUTH_COOKIE } from '../auth.js';

const router = Router();

// محدودية بسيطة في الذاكرة لمنع brute-force على /login
// (5 محاولات فاشلة لكل IP خلال 15 دقيقة → 429)
const loginAttempts = new Map(); // ip → { count, firstAt }
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_MAX = 5;

function recordFailedAttempt(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAt > ATTEMPT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: now });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

function isLockedOut(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= ATTEMPT_MAX;
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Set cookie + return user info.
 */
router.post('/login', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';

  if (isLockedOut(ip)) {
    return res.status(429).json({ error: 'too_many_attempts', retry_after_minutes: 15 });
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'email_and_password_required' });
  }

  const user = db.prepare(`
    SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.is_active,
           t.is_active AS tenant_active, t.name AS tenant_name, t.slug AS tenant_slug
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE u.email = ?
  `).get(email);

  if (!user) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  if (!user.is_active) return res.status(403).json({ error: 'user_disabled' });
  if (user.role !== 'admin' && !user.tenant_active) {
    return res.status(403).json({ error: 'tenant_disabled' });
  }

  clearAttempts(ip);

  const { token, expiresAt } = issueToken(user, { userAgent: ua, ip });
  db.prepare('UPDATE users SET last_login_at = datetime(?) WHERE id = ?')
    .run(new Date().toISOString(), user.id);

  res.cookie(AUTH_COOKIE, token, cookieOptions());
  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      tenant_name: user.tenant_name,
      tenant_slug: user.tenant_slug,
    },
    expires_at: expiresAt.toISOString(),
  });
});

/**
 * POST /api/auth/logout
 * يحذف الجلسة الحالية + يمسح الـ cookie.
 */
router.post('/logout', (req, res) => {
  const token = req.cookies?.[AUTH_COOKIE] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (token) revokeToken(token);
  res.clearCookie(AUTH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

/**
 * GET /api/auth/me
 * معلومات المستخدم الحالي. 401 إن لم يكن مصادقاً.
 */
router.get('/me', requireAuth, (req, res) => {
  const t = req.user.tenant_id
    ? db.prepare('SELECT id, name, slug FROM tenants WHERE id = ?').get(req.user.tenant_id)
    : null;
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      tenant_id: req.user.tenant_id,
      tenant_name: t?.name || null,
      tenant_slug: t?.slug || null,
    },
  });
});

/**
 * POST /api/auth/change-password
 * Body: { current_password, new_password }
 * المستخدم الحالي يغيّر كلمة سرّه. يُلغي كل الجلسات الأخرى.
 */
router.post('/change-password', requireAuth, async (req, res) => {
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  if (!current || !next) return res.status(400).json({ error: 'fields_required' });
  if (next.length < 8) return res.status(400).json({ error: 'password_too_short' });

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const ok = await bcrypt.compare(current, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_current_password' });

  const hash = await bcrypt.hash(next, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

  // أبقِ الجلسة الحالية، احذف الباقي
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?')
    .run(req.user.id, crypto.createHash('sha256').update(req.authToken).digest('hex'));

  res.json({ ok: true });
});

export default router;
