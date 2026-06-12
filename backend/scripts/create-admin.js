#!/usr/bin/env node
/**
 * scripts/create-admin.js — أداة سطر أوامر لإنشاء/تحديث حساب admin.
 *
 * الاستخدام:
 *   node scripts/create-admin.js --email=you@example.com --password='SecretP@ss123'
 *   node scripts/create-admin.js --email=you@example.com --password='SecretP@ss123' --reset
 *
 *  - يُنشئ أوّل admin لو لم يوجد.
 *  - مع `--reset`: يعيد تعيين كلمة سرّ admin موجود بنفس الـ email.
 *  - admin لا ينتمي لمستأجر (tenant_id = NULL) — يستطيع رؤية كل المستأجرين.
 *
 * تشغيل على Hetzner داخل الحاوية:
 *   docker exec -it jrd-app node backend/scripts/create-admin.js --email=... --password=...
 */
import bcrypt from 'bcryptjs';
import db from '../src/database.js';

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const flagIdx = process.argv.indexOf(`--${name}`);
  if (flagIdx !== -1 && process.argv[flagIdx + 1] && !process.argv[flagIdx + 1].startsWith('--')) {
    return process.argv[flagIdx + 1];
  }
  return null;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const email = (arg('email') || '').trim().toLowerCase();
const password = arg('password') || '';
const reset = hasFlag('reset');

if (!email || !password) {
  console.error('استخدام: node scripts/create-admin.js --email=<email> --password=<password> [--reset]');
  process.exit(2);
}
if (password.length < 8) {
  console.error('كلمة السرّ يجب أن تكون 8 أحرف على الأقل');
  process.exit(2);
}

const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
if (existing && !reset) {
  console.error(`المستخدم موجود مسبقاً (id=${existing.id}, role=${existing.role}). استخدم --reset لتعديل كلمة السرّ.`);
  process.exit(3);
}

const hash = bcrypt.hashSync(password, 10);

if (existing && reset) {
  db.prepare('UPDATE users SET password_hash = ?, role = ?, is_active = 1, tenant_id = NULL WHERE id = ?')
    .run(hash, 'admin', existing.id);
  // أبطل كل جلساته السابقة (لو فقد كلمة السرّ، لا نريد أن تبقى الجلسات شغّالة)
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(existing.id);
  console.log(`✓ تم إعادة تعيين كلمة سرّ admin (id=${existing.id}, email=${email}). كل الجلسات السابقة أُلغيت.`);
} else {
  const info = db.prepare(`
    INSERT INTO users (tenant_id, email, password_hash, role, is_active)
    VALUES (NULL, ?, ?, 'admin', 1)
  `).run(email, hash);
  console.log(`✓ تم إنشاء حساب admin (id=${info.lastInsertRowid}, email=${email}).`);
}

process.exit(0);
