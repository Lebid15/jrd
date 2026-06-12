/**
 * المصادقة — مساعدات JWT + Cookie + استخراج المستخدم.
 *
 * تصميم:
 *  - JWT (HS256) موقّع بـ JWT_SECRET، يحوي { uid, tid, role }.
 *  - يُحفظ في cookie httpOnly اسمها `jrd_token` (SameSite=Lax، Secure تلقائياً في الإنتاج).
 *  - نخزّن أيضاً SHA-256(token) في جدول auth_sessions لإمكانية الإلغاء (logout الكلّي).
 *  - عند كل طلب: نتحقّق من التوقيع، ثم من أن hash موجود في DB وغير منتهي.
 *  - middleware يضع req.user = { id, tenant_id, role, email }.
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from './database.js';

const COOKIE_NAME = 'jrd_token';
const DEFAULT_EXPIRES = '7d';

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET is missing or too short (need ≥ 16 chars). Set it in env before starting the server.');
  }
  return s;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseDurationToMs(s) {
  if (typeof s === 'number') return s * 1000;
  const m = String(s || '').match(/^(\d+)([smhd])$/);
  if (!m) return 7 * 24 * 60 * 60 * 1000; // 7d افتراضي
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const map = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * map[unit];
}

/**
 * يُصدر token جديد لمستخدم ويسجّل hash في auth_sessions.
 * يرجع { token, expiresAt }.
 */
export function issueToken(user, { userAgent = '', ip = '' } = {}) {
  const expiresIn = process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES;
  // jti فريد لكل توكن لضمان hash مميَّز حتى لو صدرت عدّة توكنات في نفس الثانية
  const jti = crypto.randomBytes(12).toString('hex');
  const payload = { uid: user.id, tid: user.tenant_id, role: user.role, jti };
  const token = jwt.sign(payload, getSecret(), { expiresIn });

  const expiresAt = new Date(Date.now() + parseDurationToMs(expiresIn));
  db.prepare(`
    INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, hashToken(token), userAgent || '', ip || '', expiresAt.toISOString());

  return { token, expiresAt };
}

/**
 * يحذف جلسة واحدة (logout الجهاز الحالي).
 */
export function revokeToken(token) {
  if (!token) return 0;
  const info = db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
  return info.changes;
}

/**
 * يحذف كل جلسات مستخدم (logout من كل الأجهزة).
 */
export function revokeAllForUser(userId) {
  const info = db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
  return info.changes;
}

/**
 * يتحقق من token: التوقيع + الـ hash في DB + عدم انتهاء صلاحيته + المستخدم نشط.
 * يرجع { user, payload } عند النجاح، أو يرمي خطأ.
 */
export function verifyToken(token) {
  if (!token) throw new Error('no_token');
  let payload;
  try {
    payload = jwt.verify(token, getSecret());
  } catch (e) {
    throw new Error(e.name === 'TokenExpiredError' ? 'expired' : 'invalid_token');
  }
  const row = db.prepare('SELECT id, expires_at FROM auth_sessions WHERE token_hash = ?').get(hashToken(token));
  if (!row) throw new Error('revoked');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(row.id);
    throw new Error('expired');
  }

  const user = db.prepare(`
    SELECT u.id, u.tenant_id, u.email, u.role, u.is_active,
           t.is_active AS tenant_active
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE u.id = ?
  `).get(payload.uid);

  if (!user || !user.is_active) throw new Error('user_disabled');
  // admin قد يكون بدون tenant_id (tid=null). owners يجب أن يكون مستأجرهم مفعّلاً.
  if (user.role !== 'admin' && !user.tenant_active) throw new Error('tenant_disabled');

  return { user, payload, sessionId: row.id };
}

/**
 * Express middleware: يقرأ cookie أو header Authorization، يضع req.user.
 * يرجع 401 إذا فشل.
 */
export function requireAuth(req, res, next) {
  const token = extractToken(req);
  try {
    const { user } = verifyToken(token);
    req.user = user;
    req.authToken = token;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'unauthenticated', reason: e.message });
  }
}

/**
 * يجب أن يكون المستخدم admin.
 */
export function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  });
}

/**
 * نسخة "اختيارية": تضع req.user إن وُجد token صحيح، وإلّا تكمل بدونه.
 * مفيدة لمسارات تكون مختلفة بحسب وجود مستخدم (مثل الصفحة الرئيسية).
 */
export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const { user } = verifyToken(token);
    req.user = user;
    req.authToken = token;
  } catch {
    // تجاهل
  }
  next();
}

function extractToken(req) {
  // 1) cookie
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  // 2) Authorization: Bearer ...
  const h = req.headers?.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/**
 * خيارات cookie موحّدة — تُستخدم عند set/clear.
 */
export function cookieOptions() {
  const expiresIn = process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES;
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: parseDurationToMs(expiresIn),
    path: '/',
  };
}

export const AUTH_COOKIE = COOKIE_NAME;
