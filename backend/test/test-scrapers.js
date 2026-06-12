/**
 * اختبار scrapers multi-tenant — يتحقّق من:
 *  1. /api/internal/bank-message/ingest يحترم tenant_id من body.
 *  2. عزل bank items: tenant A لا يرى bank tenant B.
 *  3. dedup (external_id) لكل tenant مستقلّ.
 *  4. bank_sms_log يكتب tenant_id الصحيح (ليس 1 افتراضياً).
 *
 * تشغيل: node backend/test/test-scrapers.js
 */
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

const SHARED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jrd-scrapers-'));
process.env.DATA_DIR = SHARED_DIR;
process.env.JWT_SECRET = 'test_secret_at_least_16_chars_long_xyz';
process.env.JWT_EXPIRES_IN = '1h';
process.env.INTERNAL_API_KEY = 'test_internal_key';

const dbMod = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'database.js')).href);
const db = dbMod.default;
const internalRouter = (await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'routes', 'internal.js')).href)).default;
const express = (await import('express')).default;
const cookieParser = (await import('cookie-parser')).default;

// أنشئ tenant ثانٍ + bank item لكل tenant
db.prepare(`INSERT INTO tenants (slug, name, is_active) VALUES ('beta', 'Beta Co', 1)`).run();
const tenant2 = db.prepare(`SELECT id FROM tenants WHERE slug = 'beta'`).get().id;

// bank items
db.prepare(`INSERT INTO items (tenant_id, name, type, is_active, sort_order) VALUES (1, 'Bank-T1', 'bank', 1, 0)`).run();
db.prepare(`INSERT INTO items (tenant_id, name, type, is_active, sort_order) VALUES (?, 'Bank-T2', 'bank', 1, 0)`).run(tenant2);
const bank1 = db.prepare(`SELECT id FROM items WHERE tenant_id = 1 AND type = 'bank'`).get().id;
const bank2 = db.prepare(`SELECT id FROM items WHERE tenant_id = ? AND type = 'bank'`).get(tenant2).id;

// أرصدة ابتدائية
db.prepare(`INSERT INTO current_values (tenant_id, item_id, try_amount) VALUES (1, ?, 1000.0)`).run(bank1);
db.prepare(`INSERT INTO current_values (tenant_id, item_id, try_amount) VALUES (?, ?, 5000.0)`).run(tenant2, bank2);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/internal', internalRouter);

const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function ingest(body) {
  const r = await fetch(base + '/api/internal/bank-message/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Api-Key': 'test_internal_key',
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

// نموذج SMS كويت ترك حقيقي (يطابق parseSms في bank.js)
const REAL_SMS_IN = 'Hesabınıza para geldi. Tutar: 250,00 TL Gönderen: ALI VELI Açıklama: TEST İşlem Zamanı: 12.06.2026 15:30';

console.log('\n=== Test A: ingest with tenant_id=1 ===');
const rA = await ingest({
  source: 'gmsg',
  tenant_id: 1,
  contact_name: 'KUVEYT TURK',
  text: REAL_SMS_IN,
  external_id: 'ext-t1-001',
});
check('ingest tenant 1 → 200', rA.status === 200, `body=${JSON.stringify(rA.json)}`);

const tx1 = db.prepare(`SELECT * FROM bank_transactions WHERE external_id = 'ext-t1-001'`).get();
check('tx written for tenant 1', tx1?.tenant_id === 1, `tenant_id=${tx1?.tenant_id}`);
check('tx item_id == bank1', tx1?.item_id === bank1);

const cv1 = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = 1 AND item_id = ?`).get(bank1);
check('balance tenant 1 updated to 1250', Math.abs(cv1.try_amount - 1250) < 0.01, `got ${cv1.try_amount}`);

const cv2_unchanged = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = ? AND item_id = ?`).get(tenant2, bank2);
check('tenant 2 balance NOT touched', Math.abs(cv2_unchanged.try_amount - 5000) < 0.01, `got ${cv2_unchanged.try_amount}`);

console.log('\n=== Test B: ingest with tenant_id=2 ===');
const rB = await ingest({
  source: 'gmsg',
  tenant_id: tenant2,
  contact_name: 'KUVEYT TURK',
  text: REAL_SMS_IN,
  external_id: 'ext-t2-001',
});
check('ingest tenant 2 → 200', rB.status === 200, `body=${JSON.stringify(rB.json)}`);

const tx2 = db.prepare(`SELECT * FROM bank_transactions WHERE external_id = 'ext-t2-001'`).get();
check('tx written for tenant 2', tx2?.tenant_id === tenant2, `tenant_id=${tx2?.tenant_id}`);
check('tx item_id == bank2', tx2?.item_id === bank2);

const cv2 = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = ? AND item_id = ?`).get(tenant2, bank2);
check('balance tenant 2 updated to 5250', Math.abs(cv2.try_amount - 5250) < 0.01, `got ${cv2.try_amount}`);

const cv1_unchanged = db.prepare(`SELECT try_amount FROM current_values WHERE tenant_id = 1 AND item_id = ?`).get(bank1);
check('tenant 1 balance NOT re-touched', Math.abs(cv1_unchanged.try_amount - 1250) < 0.01, `got ${cv1_unchanged.try_amount}`);

console.log('\n=== Test C: dedup per-tenant ===');
const rC = await ingest({
  source: 'gmsg',
  tenant_id: 1,
  contact_name: 'KUVEYT TURK',
  text: REAL_SMS_IN,
  external_id: 'ext-t1-001', // نفس الـ ID
});
check('duplicate same tenant → 200 duplicate=true', rC.status === 200 && rC.json?.duplicate === true);

// نفس external_id لكن tenant مختلف — يجب أن يُقبَل (dedup per-tenant)
const rC2 = await ingest({
  source: 'gmsg',
  tenant_id: tenant2,
  contact_name: 'KUVEYT TURK',
  text: REAL_SMS_IN,
  external_id: 'ext-t1-001', // same ID different tenant
});
check('same external_id different tenant → not duplicate', rC2.status === 200 && rC2.json?.duplicate !== true,
  `body=${JSON.stringify(rC2.json)}`);

console.log('\n=== Test D: missing/invalid tenant_id defaults to 1 ===');
const rD = await ingest({
  source: 'gmsg',
  contact_name: 'KUVEYT TURK',
  text: REAL_SMS_IN,
  external_id: 'ext-default-001',
  // no tenant_id
});
check('no tenant_id → 200', rD.status === 200);
const txD = db.prepare(`SELECT * FROM bank_transactions WHERE external_id = 'ext-default-001'`).get();
check('defaulted to tenant 1', txD?.tenant_id === 1);

console.log('\n=== Test E: bank_sms_log writes correct tenant_id ===');
// رسالة سيُفشِل parser
const rE = await ingest({
  source: 'gmsg',
  tenant_id: tenant2,
  contact_name: 'OTHER',
  text: 'random text not parseable',
  external_id: 'ext-t2-bad',
});
check('unparseable → 422', rE.status === 422);
const logRow = db.prepare(`
  SELECT tenant_id, parse_status FROM bank_sms_log
  WHERE parse_status = 'no_pattern' AND raw_body = 'random text not parseable'
  ORDER BY id DESC LIMIT 1
`).get();
check('log row has tenant_id=2 (not default 1)', logRow?.tenant_id === tenant2,
  `got tenant_id=${logRow?.tenant_id}`);

console.log('\n=== Test F: tenant with no bank item → 404 ===');
db.prepare(`INSERT INTO tenants (slug, name, is_active) VALUES ('empty', 'Empty Co', 1)`).run();
const tenant3 = db.prepare(`SELECT id FROM tenants WHERE slug = 'empty'`).get().id;
const rF = await ingest({
  source: 'gmsg',
  tenant_id: tenant3,
  contact_name: 'KUVEYT TURK',
  text: REAL_SMS_IN,
  external_id: 'ext-t3-001',
});
check('tenant with no bank item → 404', rF.status === 404, `body=${JSON.stringify(rF.json)}`);
const logRow2 = db.prepare(`
  SELECT tenant_id FROM bank_sms_log
  WHERE parse_status = 'no_bank_item' ORDER BY id DESC LIMIT 1
`).get();
check('no_bank_item log has tenant_id=3', logRow2?.tenant_id === tenant3,
  `got ${logRow2?.tenant_id}`);

await new Promise(r => server.close(r));
try { fs.rmSync(SHARED_DIR, { recursive: true, force: true }); } catch {}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
