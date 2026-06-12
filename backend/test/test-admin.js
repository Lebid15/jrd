/**
 * اختبار /api/admin/* — tenants و users.
 *
 * تشغيل: node backend/test/test-admin.js
 */
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

const SHARED_DIR = mkTmpDir('jrd-admin-');
process.env.DATA_DIR = SHARED_DIR;
process.env.JWT_SECRET = 'test_secret_at_least_16_chars_long_xyz';
process.env.JWT_EXPIRES_IN = '1h';
process.env.INTERNAL_API_KEY = 'test_internal_key';

const dbMod = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'database.js')).href);
const db = dbMod.default;
const auth = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'auth.js')).href);
const adminRouter = (await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'admin.js')).href)).default;
const express = (await import('express')).default;
const cookieParser = (await import('cookie-parser')).default;

// ─── Setup: admin + owner + app ────────────────────────────────────────────
const hashAdm = bcrypt.hashSync('AdminPass1', 4);
const hashOwn = bcrypt.hashSync('OwnerPass1', 4);
db.prepare(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES (NULL, ?, ?, 'admin')`).run('root@x.com', hashAdm);
db.prepare(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES (1, ?, ?, 'owner')`).run('owner1@x.com', hashOwn);
const adminUser = db.prepare(`SELECT * FROM users WHERE email = 'root@x.com'`).get();
const ownerUser = db.prepare(`SELECT * FROM users WHERE email = 'owner1@x.com'`).get();

const { token: adminToken } = auth.issueToken(adminUser);
const { token: ownerToken } = auth.issueToken(ownerUser);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin', auth.requireAdmin, adminRouter);

const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function req(method, url, body, token) {
  const r = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

// ─── Tests ─────────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n=== Test A: Auth gates on /api/admin ===');
  const r0 = await req('GET', '/api/admin/tenants');
  check('no token → 401', r0.status === 401);
  const r0b = await req('GET', '/api/admin/tenants', null, ownerToken);
  check('owner token → 403', r0b.status === 403);
  const r0c = await req('GET', '/api/admin/tenants', null, adminToken);
  check('admin token → 200', r0c.status === 200);
  check('admin sees default tenant', Array.isArray(r0c.json) && r0c.json.some(t => t.id === 1));

  console.log('\n=== Test B: Create tenant (without owner) ===');
  const rB1 = await req('POST', '/api/admin/tenants', { name: 'Acme', slug: 'acme' }, adminToken);
  check('create tenant → 201', rB1.status === 201, `body=${JSON.stringify(rB1.json)}`);
  check('tenant has id', rB1.json?.tenant?.id > 1);
  check('tenant slug', rB1.json?.tenant?.slug === 'acme');
  check('no owner created', rB1.json?.owner == null);
  const acmeId = rB1.json?.tenant?.id;

  const rB2 = await req('POST', '/api/admin/tenants', { name: 'Dup', slug: 'acme' }, adminToken);
  check('duplicate slug → 409', rB2.status === 409);

  const rB3 = await req('POST', '/api/admin/tenants', { name: 'Bad', slug: 'NOT-VALID slug!' }, adminToken);
  check('invalid slug → 400', rB3.status === 400);

  console.log('\n=== Test C: Create tenant with owner ===');
  const rC1 = await req('POST', '/api/admin/tenants', {
    name: 'Foo Co', slug: 'foo',
    owner_email: 'foo-owner@x.com',
    owner_password: 'FooPass123',
  }, adminToken);
  check('create with owner → 201', rC1.status === 201, `body=${JSON.stringify(rC1.json)}`);
  check('owner created with email', rC1.json?.owner?.email === 'foo-owner@x.com');
  check('owner role=owner', rC1.json?.owner?.role === 'owner');
  const fooId = rC1.json?.tenant?.id;
  const fooOwnerId = rC1.json?.owner?.id;
  // owner password works?
  const ownerRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(fooOwnerId);
  check('owner password hashed correctly', bcrypt.compareSync('FooPass123', ownerRow.password_hash));

  const rC2 = await req('POST', '/api/admin/tenants', {
    name: 'Bar', slug: 'bar',
    owner_email: 'foo-owner@x.com', // dup
    owner_password: 'BarPass123',
  }, adminToken);
  check('duplicate owner email → 409', rC2.status === 409);

  console.log('\n=== Test D: Patch tenant ===');
  const rD1 = await req('PATCH', `/api/admin/tenants/${acmeId}`, { name: 'Acme Inc' }, adminToken);
  check('patch name → 200', rD1.status === 200);
  check('name updated', rD1.json?.name === 'Acme Inc');

  const rD2 = await req('PATCH', `/api/admin/tenants/${acmeId}`, { is_active: false }, adminToken);
  check('disable tenant → 200', rD2.status === 200);
  check('is_active is 0', rD2.json?.is_active === 0);

  // owner لتلك المؤسسة المعطّلة لا يستطيع login (نتحقّق من خلال verifyToken)
  const fooOwnerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(fooOwnerId);
  const { token: fooToken } = auth.issueToken(fooOwnerUser);
  // ندخل أوّلاً قبل التعطيل (Acme معطّل، Foo لا يزال نشطاً) — لذا token foo يجب أن يعمل
  let fooOk = true;
  try { auth.verifyToken(fooToken); } catch { fooOk = false; }
  check('foo owner token still works (foo active)', fooOk);

  // الآن نعطّل foo
  await req('PATCH', `/api/admin/tenants/${fooId}`, { is_active: false }, adminToken);
  let fooFail = '';
  try { auth.verifyToken(fooToken); } catch (e) { fooFail = e.message; }
  check('foo owner blocked after tenant disabled', fooFail === 'tenant_disabled', `got ${fooFail}`);

  console.log('\n=== Test E: Delete tenant ===');
  const rE1 = await req('DELETE', '/api/admin/tenants/1', null, adminToken);
  check('cannot delete default tenant (id=1)', rE1.status === 400);

  // أنشئ مستأجراً + بنود تابعة له + تأكّد cascade عند الحذف
  const rE2 = await req('POST', '/api/admin/tenants', { name: 'Del', slug: 'del' }, adminToken);
  const delId = rE2.json?.tenant?.id;
  db.prepare(`INSERT INTO items (tenant_id, name, type) VALUES (?, 'TestItem', 'simple_value')`).run(delId);
  db.prepare(`INSERT INTO settings (tenant_id, key, value) VALUES (?, 'k', 'v')`).run(delId);
  const itemsBefore = db.prepare('SELECT COUNT(*) c FROM items WHERE tenant_id = ?').get(delId).c;
  check('item created for tenant del', itemsBefore === 1);

  const rE3 = await req('DELETE', `/api/admin/tenants/${delId}`, null, adminToken);
  check('delete tenant → 200', rE3.status === 200);
  const itemsAfter = db.prepare('SELECT COUNT(*) c FROM items WHERE tenant_id = ?').get(delId).c;
  check('cascade deleted items', itemsAfter === 0);

  console.log('\n=== Test F: Users CRUD ===');
  // قائمة users (يجب أن تحوي root + owner1 + foo-owner)
  const rF1 = await req('GET', '/api/admin/users', null, adminToken);
  check('list users → 200', rF1.status === 200);
  check('list includes root', rF1.json?.some(u => u.email === 'root@x.com'));

  // قائمة users فلتر tenant_id=1
  const rF2 = await req('GET', '/api/admin/users?tenant_id=1', null, adminToken);
  check('filter by tenant_id=1 → 200', rF2.status === 200);
  check('filter only owner1', rF2.json?.every(u => u.tenant_id === 1));

  // إنشاء owner جديد لـ acme
  const rF3 = await req('POST', '/api/admin/users', {
    email: 'acme-owner@x.com',
    password: 'AcmePass1',
    role: 'owner',
    tenant_id: acmeId,
  }, adminToken);
  check('create owner → 201', rF3.status === 201, `body=${JSON.stringify(rF3.json)}`);
  const acmeOwnerId = rF3.json?.id;

  // owner بدون tenant_id → 400
  const rF4 = await req('POST', '/api/admin/users', {
    email: 'noten@x.com', password: 'NoTen1234', role: 'owner',
  }, adminToken);
  check('owner without tenant_id → 400', rF4.status === 400);

  // إيميل مكرَّر
  const rF5 = await req('POST', '/api/admin/users', {
    email: 'acme-owner@x.com', password: 'AcmePass1', role: 'owner', tenant_id: acmeId,
  }, adminToken);
  check('duplicate email → 409', rF5.status === 409);

  // كلمة سرّ قصيرة
  const rF6 = await req('POST', '/api/admin/users', {
    email: 'short@x.com', password: 'abc', role: 'owner', tenant_id: acmeId,
  }, adminToken);
  check('short password → 400', rF6.status === 400);

  // تعديل user
  const rF7 = await req('PATCH', `/api/admin/users/${acmeOwnerId}`, { is_active: false }, adminToken);
  check('disable user → 200', rF7.status === 200);
  check('is_active 0', rF7.json?.is_active === 0);

  // تغيير كلمة السرّ يُلغي الجلسات
  // (نختبر على ownerUser في tenant=1 — يبقى نشطاً)
  const { token: oldT } = auth.issueToken(ownerUser);
  let oldOk = true; try { auth.verifyToken(oldT); } catch { oldOk = false; }
  check('issued token verifies before pw change', oldOk);
  const rF8 = await req('PATCH', `/api/admin/users/${ownerUser.id}`, { password: 'NewOwnerPass1' }, adminToken);
  check('change password → 200', rF8.status === 200);
  let oldFail = '';
  try { auth.verifyToken(oldT); } catch (e) { oldFail = e.message; }
  check('old session revoked after pw change', oldFail === 'revoked', `got ${oldFail}`);

  // منع حذف آخر admin
  const rF9 = await req('DELETE', `/api/admin/users/${adminUser.id}`, null, adminToken);
  check('cannot delete last admin', rF9.status === 400);

  // منع تعطيل آخر admin
  const rF10 = await req('PATCH', `/api/admin/users/${adminUser.id}`, { is_active: false }, adminToken);
  check('cannot disable last active admin', rF10.status === 400);

  // أنشئ admin ثانٍ → الآن نستطيع حذف root (لكن لا نحذفه لأن req.user=root)
  const rF11 = await req('POST', '/api/admin/users', {
    email: 'root2@x.com', password: 'Root2Pass!', role: 'admin',
  }, adminToken);
  check('create second admin → 201', rF11.status === 201);
  check('second admin tenant_id null', rF11.json?.tenant_id == null);

  // الآن حذف root يجب أن يفشل لأن req.user=root (self-delete)
  const rF12 = await req('DELETE', `/api/admin/users/${adminUser.id}`, null, adminToken);
  check('cannot delete yourself', rF12.status === 400);

  // حذف root2 يجب أن يعمل
  const root2Id = rF11.json?.id;
  const rF13 = await req('DELETE', `/api/admin/users/${root2Id}`, null, adminToken);
  check('delete other admin → 200', rF13.status === 200);

  // revoke-sessions
  // أصدر token جديد لـ ownerUser (الـ session القديمة حُذفت بعد change-password)
  auth.issueToken(ownerUser);
  const ownerSess = db.prepare('SELECT COUNT(*) c FROM auth_sessions WHERE user_id = ?').get(ownerUser.id).c;
  check('owner has sessions before revoke', ownerSess >= 1);
  const rF14 = await req('POST', `/api/admin/users/${ownerUser.id}/revoke-sessions`, null, adminToken);
  check('revoke-sessions → 200', rF14.status === 200);
  const ownerSessAfter = db.prepare('SELECT COUNT(*) c FROM auth_sessions WHERE user_id = ?').get(ownerUser.id).c;
  check('owner has 0 sessions after', ownerSessAfter === 0);
}

(async () => {
  try {
    await runTests();
  } catch (e) {
    console.error('FATAL:', e);
    fail++;
  } finally {
    await new Promise(r => server.close(r));
    try { db.close(); } catch {}
    try { fs.rmSync(SHARED_DIR, { recursive: true, force: true }); } catch {}
    console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
    process.exit(fail > 0 ? 1 : 0);
  }
})();
