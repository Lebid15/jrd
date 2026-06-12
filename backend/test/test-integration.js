/**
 * اختبار تكامل end-to-end:
 *  1. Admin يُنشئ tenant جديد + owner.
 *  2. Admin يولّد webhook secret للـ tenant.
 *  3. Owner يسجّل دخول.
 *  4. Owner يُنشئ bank item + initial balance.
 *  5. SMS عبر webhook → balance يتحدّث (tenant_id صحيح).
 *  6. bot ingest → whatsapp_messages تُحفظ للـ tenant.
 *  7. Owner يقرأ بياناته فقط (لا يرى tenant آخر).
 *  8. Tenant آخر معزول تماماً (كل استعلام لا يكشف بيانات الـ tenant الأوّل).
 *  9. Admin يحذف tenant → كل البيانات تختفي (cascade).
 * 10. Owner المحذوف لا يستطيع تسجيل الدخول بعد ذلك.
 *
 * تشغيل: node backend/test/test-integration.js
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
  if (cond) { console.log(`  + ${name}`); pass++; }
  else      { console.log(`  - ${name}${extra ? '   -> ' + extra : ''}`); fail++; }
}

const SHARED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jrd-integ-'));
process.env.DATA_DIR = SHARED_DIR;
process.env.JWT_SECRET = 'integration_test_secret_at_least_16_chars';
process.env.JWT_EXPIRES_IN = '1h';
process.env.INTERNAL_API_KEY = 'integ_internal_key';

const dbMod = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'database.js')).href);
const db = dbMod.default;
const auth = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'auth.js')).href);
const authRoutes = (await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'auth.js')).href)).default;
const adminRouter = (await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'admin.js')).href)).default;
const internalRouter = (await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'internal.js')).href)).default;
const itemsRouter = (await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'items.js')).href)).default;
const bankRouterMod = (await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'bank.js')).href));
const bankRouter = bankRouterMod.default;
const { smsWebhookHandler } = bankRouterMod;
const express = (await import('express')).default;
const cookieParser = (await import('cookie-parser')).default;

// admin seed
const hashAdm = bcrypt.hashSync('AdminInteg1', 4);
db.prepare(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES (NULL, ?, ?, 'admin')`).run('admin@integ.com', hashAdm);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);
app.post('/api/webhooks/bank-sms/:tenantSecret', smsWebhookHandler);
app.use('/api/internal', auth.optionalAuth, internalRouter);
app.use('/api', auth.requireAuth);
app.use('/api/admin', auth.requireAdmin, adminRouter);
app.use('/api/items', itemsRouter);
app.use('/api/bank', bankRouter);

const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function jsonReq(method, url, body, token, headers = {}) {
  const r = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}

// ─── Step 1: Admin login ───────────────────────────────────────────────────
console.log('\n=== Step 1: Admin login ===');
const rLogin = await jsonReq('POST', '/api/auth/login', {
  email: 'admin@integ.com', password: 'AdminInteg1',
});
check('admin login → 200', rLogin.status === 200, `body=${JSON.stringify(rLogin.json)}`);
check('returned user.role=admin', rLogin.json?.user?.role === 'admin');
// نُنشئ Bearer token يدوياً من DB (login يضعه في cookie، اختصاراً نستخدم issueToken)
const adminRow = db.prepare(`SELECT * FROM users WHERE email = 'admin@integ.com'`).get();
const adminToken = auth.issueToken(adminRow).token;
check('admin Bearer token created', typeof adminToken === 'string' && adminToken.length > 20);

// ─── Step 2: Admin creates tenant + owner ──────────────────────────────────
console.log('\n=== Step 2: Admin creates tenant + owner ===');
const rCreateT = await jsonReq('POST', '/api/admin/tenants', {
  name: 'Integ Co', slug: 'integ-co',
  owner_email: 'owner@integ.com', owner_password: 'OwnerInteg1',
}, adminToken);
check('create tenant+owner → 201', rCreateT.status === 201, `body=${JSON.stringify(rCreateT.json)}`);
check('tenant id > 1', rCreateT.json?.tenant?.id > 1);
check('owner created', rCreateT.json?.owner?.email === 'owner@integ.com');
const tenantId = rCreateT.json?.tenant?.id;

// أنشئ tenant ثانٍ "Other Co" لاختبار العزل
const rOther = await jsonReq('POST', '/api/admin/tenants', {
  name: 'Other Co', slug: 'other-co',
  owner_email: 'other@integ.com', owner_password: 'OtherInteg1',
}, adminToken);
check('create 2nd tenant → 201', rOther.status === 201);
const otherTenantId = rOther.json?.tenant?.id;

// ─── Step 3: Admin rotates webhook secret ──────────────────────────────────
console.log('\n=== Step 3: Admin rotates webhook secret ===');
const rRot = await jsonReq('POST', `/api/admin/tenants/${tenantId}/rotate-webhook-secret`, {}, adminToken);
check('rotate → 200', rRot.status === 200);
const secret = rRot.json?.secret;
check('secret is base64url-ish', typeof secret === 'string' && secret.length >= 24);

// ─── Step 4: Owner login ──────────────────────────────────────────────────
console.log('\n=== Step 4: Owner login ===');
const rOwnerLogin = await jsonReq('POST', '/api/auth/login', {
  email: 'owner@integ.com', password: 'OwnerInteg1',
});
check('owner login → 200', rOwnerLogin.status === 200);
check('owner.tenant_id matches', rOwnerLogin.json?.user?.tenant_id === tenantId);
const ownerRow = db.prepare(`SELECT * FROM users WHERE email = 'owner@integ.com'`).get();
const ownerToken = auth.issueToken(ownerRow).token;

// Other owner login
const rOtherLogin = await jsonReq('POST', '/api/auth/login', {
  email: 'other@integ.com', password: 'OtherInteg1',
});
check('other owner login → 200', rOtherLogin.status === 200);
const otherRow = db.prepare(`SELECT * FROM users WHERE email = 'other@integ.com'`).get();
const otherOwnerToken = auth.issueToken(otherRow).token;

// ─── Step 5: Owner creates bank item ──────────────────────────────────────
console.log('\n=== Step 5: Owner creates bank item ===');
const rNewItem = await jsonReq('POST', '/api/items', {
  name: 'Bank Integ', type: 'bank', is_active: 1,
}, ownerToken);
check('create item → 201/200', rNewItem.status === 201 || rNewItem.status === 200,
  `body=${JSON.stringify(rNewItem.json)}`);
const itemId = rNewItem.json?.id;
check('item id assigned', typeof itemId === 'number');

// رصيد ابتدائي 1000 (UPDATE بدلاً من INSERT لأن items POST يُنشئ row في current_values)
db.prepare(`UPDATE current_values SET try_amount = 1000 WHERE tenant_id = ? AND item_id = ?`).run(tenantId, itemId);

// تأكّد من العزل: tenant آخر لا يرى الـ item
const rListOther = await jsonReq('GET', '/api/items', null, otherOwnerToken);
const otherSeesIntegItem = rListOther.json?.some?.(i => i.id === itemId);
check('other tenant does NOT see integ item', !otherSeesIntegItem,
  `other list: ${JSON.stringify(rListOther.json)}`);

// ─── Step 6: SMS via webhook ──────────────────────────────────────────────
console.log('\n=== Step 6: SMS webhook updates balance ===');
const REAL_SMS = 'Hesabınıza para geldi. Tutar: 500,00 TL Gönderen: TEST_SENDER Açıklama: integ İşlem Zamanı: 12.06.2026 16:00';
const rSms = await jsonReq('POST', `/api/webhooks/bank-sms/${secret}`, {
  sender: 'KUVEYT TURK', body: REAL_SMS,
});
check('webhook → 200', rSms.status === 200, `body=${JSON.stringify(rSms.json)}`);

const cv = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = ? AND item_id = ?`).get(tenantId, itemId);
check('balance 1000 + 500 = 1500', Math.abs(cv.try_amount - 1500) < 0.01, `got ${cv.try_amount}`);

// تأكّد من عدم تسرّب على tenant الآخر
const otherHasBank = db.prepare(`SELECT id FROM items WHERE tenant_id = ?`).get(otherTenantId);
check('other tenant has 0 items', !otherHasBank);

// ─── Step 7: bot ingest (whatsapp message) ────────────────────────────────
console.log('\n=== Step 7: bot ingest writes whatsapp_messages per-tenant ===');
// أعدّ allowed_groups settings للـ tenant كي لا تُرفَض الرسالة
db.prepare(`
  INSERT INTO settings (tenant_id, key, value)
  VALUES (?, 'whatsapp_allowed_groups', ?)
  ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value
`).run(tenantId, JSON.stringify(['Integ Group']));

const rIngest = await jsonReq('POST', '/api/internal/ingest', {
  tenant_id: tenantId,
  group_id: 'integ@g.us',
  group_name: 'Integ Group',
  sender: '999999',
  sender_name: 'Bot Tester',
  message_id: 'msg-integ-001',
  text: 'integration test message',
  is_group: true,
}, null, { 'X-Internal-Api-Key': 'integ_internal_key' });
check('ingest → 200', rIngest.status === 200, `body=${JSON.stringify(rIngest.json)}`);

const msgRow = db.prepare(`SELECT tenant_id, group_name, text FROM whatsapp_messages WHERE message_id = 'msg-integ-001'`).get();
check('message saved with correct tenant_id', msgRow?.tenant_id === tenantId,
  `got ${msgRow?.tenant_id}`);
check('group_name preserved', msgRow?.group_name === 'Integ Group');

// ─── Step 8: Owner reads only own data ────────────────────────────────────
console.log('\n=== Step 8: Owner reads only own data ===');
const rOwnerItems = await jsonReq('GET', '/api/items', null, ownerToken);
check('owner sees own items', Array.isArray(rOwnerItems.json) && rOwnerItems.json.some(i => i.id === itemId));
check('owner item count = 1', rOwnerItems.json?.length === 1);

const rOwnerBankLog = await jsonReq('GET', '/api/bank/sms-log', null, ownerToken);
check('owner sees own SMS log', Array.isArray(rOwnerBankLog.json));
check('SMS log has the applied entry', rOwnerBankLog.json?.some(l => l.parse_status === 'applied'));

// ─── Step 9: Admin deletes tenant → cascade ───────────────────────────────
console.log('\n=== Step 9: Admin deletes tenant, cascade purges all data ===');
const rDel = await jsonReq('DELETE', `/api/admin/tenants/${tenantId}`, null, adminToken);
check('delete tenant → 200', rDel.status === 200, `body=${JSON.stringify(rDel.json)}`);

const itemsLeft = db.prepare(`SELECT COUNT(*) AS n FROM items WHERE tenant_id = ?`).get(tenantId).n;
const cvLeft = db.prepare(`SELECT COUNT(*) AS n FROM current_values WHERE tenant_id = ?`).get(tenantId).n;
const txLeft = db.prepare(`SELECT COUNT(*) AS n FROM bank_transactions WHERE tenant_id = ?`).get(tenantId).n;
const msgLeft = db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_messages WHERE tenant_id = ?`).get(tenantId).n;
const usersLeft = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?`).get(tenantId).n;
const settingsLeft = db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE tenant_id = ?`).get(tenantId).n;

check('items cascaded', itemsLeft === 0, `${itemsLeft} items left`);
check('current_values cascaded', cvLeft === 0, `${cvLeft} values left`);
check('bank_transactions cascaded', txLeft === 0, `${txLeft} txs left`);
check('whatsapp_messages cascaded', msgLeft === 0, `${msgLeft} msgs left`);
check('users cascaded', usersLeft === 0, `${usersLeft} users left`);
check('settings cascaded', settingsLeft === 0, `${settingsLeft} settings left`);

// ─── Step 10: deleted owner can't login ───────────────────────────────────
console.log('\n=== Step 10: Deleted owner cannot login ===');
const rDeadLogin = await jsonReq('POST', '/api/auth/login', {
  email: 'owner@integ.com', password: 'OwnerInteg1',
});
check('deleted owner login → 401', rDeadLogin.status === 401);

// Other tenant still works
const rOtherStillLogin = await jsonReq('POST', '/api/auth/login', {
  email: 'other@integ.com', password: 'OtherInteg1',
});
check('other tenant owner still works → 200', rOtherStillLogin.status === 200);

await new Promise(r => server.close(r));
try { fs.rmSync(SHARED_DIR, { recursive: true, force: true }); } catch {}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
