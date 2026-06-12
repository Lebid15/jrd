/**
 * اختبار webhook secrets per-tenant.
 *  - rotate-webhook-secret يولّد secret ويُسجّله في settings.
 *  - استدعاء /api/webhooks/bank-sms/:secret يوجّه لـ tenant الصحيح.
 *  - secret خاطئ → 401.
 *  - secret tenant A لا يصل لـ bank tenant B.
 *  - تدوير الـ secret يُبطل القديم.
 *
 * تشغيل: node backend/test/test-webhook-secrets.js
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

const SHARED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jrd-webhook-'));
process.env.DATA_DIR = SHARED_DIR;
process.env.JWT_SECRET = 'test_secret_at_least_16_chars_long_xyz';
process.env.JWT_EXPIRES_IN = '1h';
process.env.INTERNAL_API_KEY = 'test_internal_key';
// متعمّداً: لا نضع SMS_WEBHOOK_SECRET لتجنّب التوافق الرجعي

const dbMod = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'database.js')).href);
const db = dbMod.default;
const auth = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'auth.js')).href);
const adminRouter = (await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'admin.js')).href)).default;
const { smsWebhookHandler } = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'bank.js')).href);
const express = (await import('express')).default;
const cookieParser = (await import('cookie-parser')).default;

// ─── setup admin + tenants + bank items ────────────────────────────────────
const hashAdm = bcrypt.hashSync('AdminPass1', 4);
db.prepare(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES (NULL, ?, ?, 'admin')`).run('root@x.com', hashAdm);
const adminUser = db.prepare(`SELECT * FROM users WHERE email = 'root@x.com'`).get();
const { token: adminToken } = auth.issueToken(adminUser);

// tenant 2
db.prepare(`INSERT INTO tenants (slug, name, is_active) VALUES ('alpha', 'Alpha', 1)`).run();
const tenantA = 1; // default
const tenantB = db.prepare(`SELECT id FROM tenants WHERE slug = 'alpha'`).get().id;

// bank items + initial balances
db.prepare(`INSERT INTO items (tenant_id, name, type, is_active, sort_order) VALUES (1, 'Bank-A', 'bank', 1, 0)`).run();
db.prepare(`INSERT INTO items (tenant_id, name, type, is_active, sort_order) VALUES (?, 'Bank-B', 'bank', 1, 0)`).run(tenantB);
const bankA = db.prepare(`SELECT id FROM items WHERE tenant_id = 1 AND type = 'bank'`).get().id;
const bankB = db.prepare(`SELECT id FROM items WHERE tenant_id = ? AND type = 'bank'`).get(tenantB).id;
db.prepare(`INSERT INTO current_values (tenant_id, item_id, try_amount) VALUES (1, ?, 1000)`).run(bankA);
db.prepare(`INSERT INTO current_values (tenant_id, item_id, try_amount) VALUES (?, ?, 2000)`).run(tenantB, bankB);

// app
const app = express();
app.use(express.json());
app.use(cookieParser());
app.post('/api/webhooks/bank-sms/:tenantSecret', smsWebhookHandler);
app.use('/api/admin', auth.requireAdmin, adminRouter);

const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function jsonReq(method, url, body, token) {
  const r = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}

const REAL_SMS_IN = 'Hesabınıza para geldi. Tutar: 250,00 TL Gönderen: TEST Açıklama: x İşlem Zamanı: 12.06.2026 15:30';

// ─── Test A: rotate secret لـ tenant A ────────────────────────────────────
console.log('\n=== Test A: rotate secret + status ===');
const rA = await jsonReq('POST', `/api/admin/tenants/${tenantA}/rotate-webhook-secret`, {}, adminToken);
check('rotate → 200', rA.status === 200);
check('returns secret', typeof rA.json?.secret === 'string' && rA.json.secret.length > 16);
check('returns webhook_path', typeof rA.json?.webhook_path === 'string');
const secretA = rA.json?.secret;

const rA2 = await jsonReq('GET', `/api/admin/tenants/${tenantA}/webhook-status`, null, adminToken);
check('status returns configured=true', rA2.json?.configured === true);
check('status returns last_rotated_at', typeof rA2.json?.last_rotated_at === 'string');

const rA3 = await jsonReq('GET', `/api/admin/tenants/${tenantB}/webhook-status`, null, adminToken);
check('tenant B has no secret yet', rA3.json?.configured === false);

// ─── Test B: webhook call with valid secret routes to tenant A ────────────
console.log('\n=== Test B: webhook call routes to correct tenant ===');
const rB = await jsonReq('POST', `/api/webhooks/bank-sms/${secretA}`, {
  sender: 'KUVEYT TURK',
  body: REAL_SMS_IN,
});
check('valid secret → 200', rB.status === 200, `body=${JSON.stringify(rB.json)}`);

const cvA = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = 1 AND item_id = ?`).get(bankA);
check('tenant A balance 1000 → 1250', Math.abs(cvA.try_amount - 1250) < 0.01, `got ${cvA.try_amount}`);

const cvB_unchanged = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = ? AND item_id = ?`).get(tenantB, bankB);
check('tenant B balance NOT touched', Math.abs(cvB_unchanged.try_amount - 2000) < 0.01);

// ─── Test C: invalid secret ────────────────────────────────────────────────
console.log('\n=== Test C: invalid secret rejected ===');
const rC = await jsonReq('POST', '/api/webhooks/bank-sms/totally-bogus-secret-xyz', {
  sender: 'X',
  body: REAL_SMS_IN,
});
check('bad secret → 401', rC.status === 401, `status=${rC.status}, body=${JSON.stringify(rC.json)}`);

// ─── Test D: rotate secret invalidates old one ────────────────────────────
console.log('\n=== Test D: rotation invalidates old secret ===');
const rD1 = await jsonReq('POST', `/api/admin/tenants/${tenantA}/rotate-webhook-secret`, {}, adminToken);
check('rotate again → 200', rD1.status === 200);
const newSecret = rD1.json?.secret;
check('new secret differs from old', newSecret !== secretA);

const rD2 = await jsonReq('POST', `/api/webhooks/bank-sms/${secretA}`, {
  sender: 'KUVEYT TURK',
  body: REAL_SMS_IN,
});
check('old secret → 401', rD2.status === 401);

const rD3 = await jsonReq('POST', `/api/webhooks/bank-sms/${newSecret}`, {
  sender: 'KUVEYT TURK',
  body: REAL_SMS_IN,
});
check('new secret → 200', rD3.status === 200, `body=${JSON.stringify(rD3.json)}`);

// ─── Test E: secret لـ tenant B لا يصل لـ bank tenant A ───────────────────
console.log('\n=== Test E: per-tenant routing isolation ===');
const rE1 = await jsonReq('POST', `/api/admin/tenants/${tenantB}/rotate-webhook-secret`, {}, adminToken);
const secretB = rE1.json?.secret;

const cvA_before = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = 1`).get();
const cvB_before = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = ?`).get(tenantB);

await jsonReq('POST', `/api/webhooks/bank-sms/${secretB}`, {
  sender: 'KUVEYT TURK',
  body: REAL_SMS_IN,
});

const cvA_after = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = 1`).get();
const cvB_after = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = ?`).get(tenantB);

check('tenant A balance UNCHANGED', cvA_after.try_amount === cvA_before.try_amount,
  `before=${cvA_before.try_amount} after=${cvA_after.try_amount}`);
check('tenant B balance +250', Math.abs(cvB_after.try_amount - cvB_before.try_amount - 250) < 0.01,
  `before=${cvB_before.try_amount} after=${cvB_after.try_amount}`);

// ─── Test F: auth gate on rotate ──────────────────────────────────────────
console.log('\n=== Test F: rotate requires admin ===');
const rF = await jsonReq('POST', `/api/admin/tenants/${tenantA}/rotate-webhook-secret`);
check('no token → 401', rF.status === 401);

await new Promise(r => server.close(r));
try { fs.rmSync(SHARED_DIR, { recursive: true, force: true }); } catch {}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
