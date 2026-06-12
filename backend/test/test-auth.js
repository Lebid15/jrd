/**
 * اختبار وحدات الـ auth + سيناريو HTTP كامل (login → me → logout).
 *
 * تشغيل: node backend/test/test-auth.js
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}${extra ? '   → ' + extra : ''}`); fail++; }
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// نستخدم dir واحدة + DB واحدة لكل الاختبارات لتجنّب مشاكل ESM module cache.
// (routes/auth.js يستورد ../auth.js بـ specifier ثابت، فلا فائدة من cache-buster متعدد.)
const SHARED_DIR = mkTmpDir('jrd-auth-');
process.env.DATA_DIR = SHARED_DIR;
process.env.JWT_SECRET = 'test_secret_at_least_16_chars_long_xyz';
process.env.JWT_EXPIRES_IN = '1h';
process.env.INTERNAL_API_KEY = 'test_internal_key';

const dbMod = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'database.js')).href);
const sharedDb = dbMod.default;
const auth = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'auth.js')).href);

// ─── Unit tests ─────────────────────────────────────────────────────────────
async function testAuthUnit() {
  console.log('\n=== Test A: Auth unit (issue / verify / revoke) ===');
  const db = sharedDb;

    // أنشئ مستأجراً + مستخدماً عاديّاً
    db.prepare(`INSERT INTO tenants (id, name, slug) VALUES (10, 'T10', 't10')`).run();
    const hash = bcrypt.hashSync('password123', 4); // rounds منخفض للاختبار
    db.prepare(`
      INSERT INTO users (tenant_id, email, password_hash, role) VALUES (10, ?, ?, 'owner')
    `).run('owner@x.com', hash);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get('owner@x.com');

    // 1) issueToken
    const { token, expiresAt } = auth.issueToken(u, { userAgent: 'jest', ip: '127.0.0.1' });
    check('issueToken returns string token', typeof token === 'string' && token.length > 20);
    check('issueToken returns future expiresAt', expiresAt > new Date());

    // 2) verifyToken يعمل
    const v = auth.verifyToken(token);
    check('verifyToken returns same user.id', v.user.id === u.id);
    check('verifyToken sets tenant_id correctly', v.user.tenant_id === 10);
    check('verifyToken sets role=owner', v.user.role === 'owner');

    // 3) verifyToken يفشل مع توكن غير صالح
    let err1 = '';
    try { auth.verifyToken('not.a.real.jwt'); } catch (e) { err1 = e.message; }
    check('verifyToken rejects invalid token', err1 === 'invalid_token', `got ${err1}`);

    // 4) revokeToken
    const removed = auth.revokeToken(token);
    check('revokeToken removes one session', removed === 1);
    let err2 = '';
    try { auth.verifyToken(token); } catch (e) { err2 = e.message; }
    check('verifyToken rejects after revoke', err2 === 'revoked', `got ${err2}`);

    // 5) المستخدم المعطَّل
    const { token: t2 } = auth.issueToken(u);
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(u.id);
    let err3 = '';
    try { auth.verifyToken(t2); } catch (e) { err3 = e.message; }
    check('verifyToken rejects disabled user', err3 === 'user_disabled', `got ${err3}`);
    db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(u.id);

    // 6) المستأجر المعطَّل (owner)
    const { token: t3 } = auth.issueToken(u);
    db.prepare('UPDATE tenants SET is_active = 0 WHERE id = ?').run(10);
    let err4 = '';
    try { auth.verifyToken(t3); } catch (e) { err4 = e.message; }
    check('verifyToken rejects disabled tenant for owner', err4 === 'tenant_disabled', `got ${err4}`);
    db.prepare('UPDATE tenants SET is_active = 1 WHERE id = ?').run(10);

    // 7) admin بدون tenant_id يمر حتى لو مستأجره null
    db.prepare(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES (NULL, ?, ?, 'admin')`).run('admin-a@x.com', hash);
    const adm = db.prepare('SELECT * FROM users WHERE email = ?').get('admin-a@x.com');
    const { token: tAdm } = auth.issueToken(adm);
    const vAdm = auth.verifyToken(tAdm);
    check('admin (tenant_id=NULL) verifies OK', vAdm.user.role === 'admin' && vAdm.user.tenant_id == null);
}

// ─── HTTP integration test ──────────────────────────────────────────────────
async function testHttpFlow() {
  console.log('\n=== Test B: HTTP flow (login → me → logout → me=401) ===');
  const db = sharedDb;

    // أنشئ مستخدماً
    db.prepare(`INSERT INTO tenants (id, name, slug) VALUES (20, 'Tenant 20', 't20')`).run();
    const hash = bcrypt.hashSync('p@ssword1', 4);
    db.prepare(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES (20, ?, ?, 'owner')`).run('me@x.com', hash);

    // ابنِ تطبيق express صغير يحوي auth router فقط
    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const authRouter = (await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'auth.js')).href)).default;

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRouter);

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    async function req(method, url, body, cookieHeader) {
      const r = await fetch(base + url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = r.headers.get('set-cookie');
      let json = null;
      try { json = await r.json(); } catch {}
      return { status: r.status, json, setCookie };
    }

    // 1) login بكلمة سرّ خاطئة
    const r1 = await req('POST', '/api/auth/login', { email: 'me@x.com', password: 'WRONG' });
    check('login wrong password → 401', r1.status === 401);
    check('login wrong password → no cookie set', !r1.setCookie);

    // 2) login بكلمة سرّ صحيحة
    const r2 = await req('POST', '/api/auth/login', { email: 'me@x.com', password: 'p@ssword1' });
    check('login OK → 200', r2.status === 200);
    check('login OK → returns user.email', r2.json?.user?.email === 'me@x.com');
    check('login OK → returns tenant info', r2.json?.user?.tenant_id === 20 && r2.json?.user?.tenant_slug === 't20');
    check('login OK → sets cookie', r2.setCookie && r2.setCookie.includes('jrd_token='));
    check('login OK → cookie is HttpOnly', r2.setCookie?.toLowerCase().includes('httponly'));

    // استخرج الـ cookie للاستخدام لاحقاً
    const cookieValue = r2.setCookie.split(';')[0]; // "jrd_token=...."

    // 3) /me مع cookie
    const r3 = await req('GET', '/api/auth/me', null, cookieValue);
    check('me with cookie → 200', r3.status === 200);
    check('me → returns correct user', r3.json?.user?.email === 'me@x.com');

    // 4) /me بدون cookie
    const r4 = await req('GET', '/api/auth/me');
    check('me without cookie → 401', r4.status === 401);

    // 5) logout
    const r5 = await req('POST', '/api/auth/logout', null, cookieValue);
    check('logout → 200', r5.status === 200);

    // 6) /me بعد logout — يجب 401 (الـ session مُلغاة في DB)
    const r6 = await req('GET', '/api/auth/me', null, cookieValue);
    check('me after logout → 401 (session revoked)', r6.status === 401);
    check('me after logout → reason = revoked', r6.json?.reason === 'revoked', `got ${r6.json?.reason}`);

    // 7) change-password
    const r7 = await req('POST', '/api/auth/login', { email: 'me@x.com', password: 'p@ssword1' });
    const ck2 = r7.setCookie.split(';')[0];
    const r8 = await req('POST', '/api/auth/change-password', { current_password: 'WRONG', new_password: 'newpass123' }, ck2);
    check('change-password wrong current → 401', r8.status === 401);
    const r9 = await req('POST', '/api/auth/change-password', { current_password: 'p@ssword1', new_password: 'newpass123' }, ck2);
    check('change-password OK → 200', r9.status === 200);

    // الجلسة الحالية تبقى نشطة بعد change-password
    const r10 = await req('GET', '/api/auth/me', null, ck2);
    check('me after change-password (same session) → 200', r10.status === 200);

    // login بكلمة السرّ الجديدة
    const r11 = await req('POST', '/api/auth/login', { email: 'me@x.com', password: 'newpass123' });
    check('login with new password → 200', r11.status === 200);

    // login بالقديمة → 401
    const r12 = await req('POST', '/api/auth/login', { email: 'me@x.com', password: 'p@ssword1' });
    check('login with old password → 401', r12.status === 401);

    // 8) rate limit — 5 محاولات فاشلة ثم الـ 6 = 429
    // ملاحظة: عدّاد المحاولات في الذاكرة → IP=127.0.0.1، نُجرّب 5 مرّات فاشلة جديدة
    // (الـ login السابقة الفاشلة سُمحت لأن النجاحات بين الإخفاقات تمسح العدّاد).
    for (let i = 0; i < 5; i++) {
      await req('POST', '/api/auth/login', { email: 'me@x.com', password: 'bad' + i });
    }
    const r13 = await req('POST', '/api/auth/login', { email: 'me@x.com', password: 'newpass123' });
    check('rate limit: 6th attempt → 429', r13.status === 429, `got ${r13.status}`);

    await new Promise(r => server.close(r));
}

// ─── Admin script test ──────────────────────────────────────────────────────
async function testAdminScript() {
  console.log('\n=== Test C: create-admin script ===');
  const db = sharedDb;

    // شغّل السكربت كـ subprocess (يحاكي docker exec)
    const { spawnSync } = await import('child_process');
    const scriptPath = path.resolve(__dirname, '..', 'scripts', 'create-admin.js');

    const env = { ...process.env, DATA_DIR: SHARED_DIR };

    // 1) إنشاء admin أوّل
    const r1 = spawnSync(process.execPath, [scriptPath, '--email=admin@x.com', '--password=Adm1nPass!'], { env, encoding: 'utf8' });
    check('admin:create exits 0', r1.status === 0, `stderr=${r1.stderr}`);
    const admUser = db.prepare(`SELECT * FROM users WHERE email = 'admin@x.com'`).get();
    check('admin user created with role=admin', admUser?.role === 'admin');
    check('admin user tenant_id is NULL', admUser?.tenant_id == null);

    // 2) إنشاء نفس admin مرة ثانية بدون --reset → خطأ
    const r2 = spawnSync(process.execPath, [scriptPath, '--email=admin@x.com', '--password=Different!'], { env, encoding: 'utf8' });
    check('admin:create on existing without --reset exits non-zero', r2.status !== 0);
    const hash1 = db.prepare(`SELECT password_hash FROM users WHERE email = 'admin@x.com'`).get().password_hash;
    check('password unchanged without --reset', bcrypt.compareSync('Adm1nPass!', hash1));

    // 3) --reset يعمل
    const r3 = spawnSync(process.execPath, [scriptPath, '--email=admin@x.com', '--password=Different!', '--reset'], { env, encoding: 'utf8' });
    check('admin:create --reset exits 0', r3.status === 0, `stderr=${r3.stderr}`);
    const hash2 = db.prepare(`SELECT password_hash FROM users WHERE email = 'admin@x.com'`).get().password_hash;
    check('password updated after --reset', bcrypt.compareSync('Different!', hash2));

    // 4) كلمة سرّ قصيرة → خطأ
    const r4 = spawnSync(process.execPath, [scriptPath, '--email=short@x.com', '--password=abc'], { env, encoding: 'utf8' });
    check('admin:create short password exits non-zero', r4.status !== 0);
}

(async () => {
  await testAuthUnit();
  await testHttpFlow();
  await testAdminScript();
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  try { sharedDb.close(); } catch {}
  try { fs.rmSync(SHARED_DIR, { recursive: true, force: true }); } catch {}
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(2);
});
