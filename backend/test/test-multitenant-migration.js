/**
 * اختبار migration المرحلة 3.
 *
 * نختبر سيناريوهَين:
 *  (A) قاعدة "Railway قديمة" — جداول بدون tenant_id + بيانات حقيقية.
 *  (B) قاعدة جديدة فارغة — كأنّها Hetzner أوّل مرّة.
 *
 * في الحالتَين: نتحقّق أن tenant 1 موجود، tenant_id موجود في كل جدول،
 * settings PK مركّب، whatsapp_messages.tenant_id INTEGER، البيانات محفوظة.
 *
 * تشغيل: node backend/test/test-multitenant-migration.js
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}${extra ? '   → ' + extra : ''}`); fail++; }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** يبني قاعدة بشكل Railway القديم (قبل multi-tenant) ويزرع فيها بيانات. */
function seedLegacyDb(dir) {
  const db = new Database(path.join(dir, 'jrd.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'manual',
      provider_type TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE current_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
      try_amount REAL DEFAULT 0,
      usd_amount REAL DEFAULT 0,
      notes TEXT DEFAULT ''
    );
    CREATE TABLE api_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
      provider_type TEXT NOT NULL,
      base_url TEXT DEFAULT '',
      api_token TEXT DEFAULT '',
      kod TEXT DEFAULT '',
      sifre TEXT DEFAULT ''
    );
    CREATE TABLE inventories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      exchange_rate REAL NOT NULL,
      total_try REAL NOT NULL DEFAULT 0,
      total_usd REAL NOT NULL DEFAULT 0,
      total_converted_usd REAL NOT NULL DEFAULT 0,
      previous_total_usd REAL DEFAULT 0,
      profit REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      try_amount REAL DEFAULT 0,
      usd_amount REAL DEFAULT 0,
      notes TEXT DEFAULT ''
    );
    CREATE TABLE photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      notes TEXT DEFAULT '',
      uploaded_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE bank_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
      direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
      amount REAL NOT NULL,
      sender_receiver TEXT DEFAULT '',
      description TEXT DEFAULT '',
      transaction_time TEXT DEFAULT '',
      raw_sms TEXT DEFAULT '',
      balance_after REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE whatsapp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT DEFAULT '1',
      group_id TEXT NOT NULL,
      group_name TEXT DEFAULT '',
      sender TEXT DEFAULT '',
      sender_name TEXT DEFAULT '',
      message_id TEXT UNIQUE,
      text TEXT NOT NULL,
      is_group INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE whatsapp_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
      message_id INTEGER REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK(source IN ('us','them')),
      direction TEXT NOT NULL CHECK(direction IN ('lana','lakum')),
      currency TEXT NOT NULL CHECK(currency IN ('TRY','USD')),
      amount REAL NOT NULL,
      delta REAL NOT NULL,
      balance_after REAL DEFAULT 0,
      raw_text TEXT DEFAULT '',
      sender_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE monthly_inventories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      exchange_rate REAL NOT NULL,
      total_try REAL NOT NULL DEFAULT 0,
      total_usd REAL NOT NULL DEFAULT 0,
      total_converted_usd REAL NOT NULL DEFAULT 0,
      previous_monthly_id INTEGER REFERENCES monthly_inventories(id) ON DELETE SET NULL,
      previous_total_usd REAL DEFAULT 0,
      period_from TEXT DEFAULT '',
      period_to TEXT DEFAULT '',
      period_profit REAL NOT NULL DEFAULT 0,
      daily_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE monthly_inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monthly_inventory_id INTEGER NOT NULL REFERENCES monthly_inventories(id) ON DELETE CASCADE,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      try_amount REAL DEFAULT 0,
      usd_amount REAL DEFAULT 0,
      notes TEXT DEFAULT ''
    );
    CREATE TABLE bank_sms_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now')),
      ip TEXT DEFAULT '',
      secret_ok INTEGER DEFAULT 1,
      parse_status TEXT DEFAULT '',
      error_message TEXT DEFAULT '',
      sender TEXT DEFAULT '',
      raw_body TEXT DEFAULT '',
      item_id INTEGER,
      direction TEXT DEFAULT '',
      amount REAL,
      transaction_id INTEGER
    );
  `);

  // بيانات تجريبية
  db.prepare(`INSERT INTO items (name, type) VALUES ('بنك كويت ترك', 'bank')`).run();
  db.prepare(`INSERT INTO items (name, type, provider_type) VALUES ('Znet', 'provider', 'znet')`).run();
  db.prepare(`INSERT INTO current_values (item_id, try_amount, usd_amount) VALUES (1, 1500.50, 0)`).run();
  db.prepare(`INSERT INTO current_values (item_id, try_amount, usd_amount) VALUES (2, 0, 200)`).run();
  db.prepare(`INSERT INTO api_configs (item_id, provider_type, api_token) VALUES (2, 'znet', 'tok123')`).run();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('exchange_rate', '40.00')`).run();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('whatsapp_admin_token', 'custom_admin')`).run();
  db.prepare(`INSERT INTO whatsapp_messages (tenant_id, group_id, group_name, text, is_group) VALUES ('1', 'g1@g.us', 'مجموعة 1', 'test', 1)`).run();
  db.prepare(`INSERT INTO whatsapp_messages (tenant_id, group_id, group_name, text, is_group) VALUES ('', 'g2@g.us', 'مجموعة 2', 'test2', 1)`).run();
  db.prepare(`INSERT INTO bank_transactions (item_id, direction, amount, balance_after) VALUES (1, 'in', 500, 2000.50)`).run();
  db.prepare(`INSERT INTO inventories (date, exchange_rate, total_converted_usd, profit) VALUES ('2026-06-01', 40.0, 1000, 50)`).run();
  db.prepare(`INSERT INTO inventory_items (inventory_id, item_name) VALUES (1, 'بنك كويت ترك')`).run();

  db.close();
}

async function loadMigrationOn(dir) {
  process.env.DATA_DIR = dir;
  // import واحد فقط لكل عملية — لذا نلجأ إلى timestamp ?v= لتجنّب cache
  const url = pathToFileURL(path.resolve(__dirname, '..', 'src', 'database.js')).href + `?v=${Date.now()}`;
  const mod = await import(url);
  return mod.default;
}

async function testLegacyMigration() {
  console.log('\n=== Test A: Legacy Railway DB → multi-tenant ===');
  const dir = makeTempDir('jrd-legacy-');
  try {
    seedLegacyDb(dir);
    const db = await loadMigrationOn(dir);

    // 1) tenants موجود + المستأجر الافتراضي
    const t = db.prepare('SELECT * FROM tenants WHERE id = 1').get();
    check('tenants table created + default tenant exists', !!t && t.slug === 'default');

    // 2) users + auth_sessions
    check('users table created',         !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get());
    check('auth_sessions table created', !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get());

    // 3) tenant_id موجود في كل جدول
    const tables = ['items', 'current_values', 'api_configs', 'inventories', 'inventory_items',
                    'photos', 'bank_transactions', 'bank_sms_log',
                    'whatsapp_transactions', 'monthly_inventories', 'monthly_inventory_items'];
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
      check(`${t}.tenant_id present`, cols.includes('tenant_id'));
    }

    // 4) settings — PK مركّب (tenant_id, key)
    const sInfo = db.prepare(`PRAGMA table_info(settings)`).all();
    const sPk = sInfo.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    check('settings has tenant_id column', sInfo.some(c => c.name === 'tenant_id'));
    check('settings PK = (tenant_id, key)', sPk.length === 2 && sPk[0] === 'tenant_id' && sPk[1] === 'key',
      `actual PK: [${sPk.join(', ')}]`);

    // 5) whatsapp_messages.tenant_id is INTEGER
    const waInfo = db.prepare(`PRAGMA table_info(whatsapp_messages)`).all();
    const waTid = waInfo.find(c => c.name === 'tenant_id');
    check('whatsapp_messages.tenant_id is INTEGER', waTid && String(waTid.type).toUpperCase() === 'INTEGER',
      `actual type: ${waTid?.type}`);

    // 6) البيانات محفوظة + tenant_id = 1 لكل صفّ
    const itemsCount = db.prepare(`SELECT COUNT(*) as n FROM items WHERE tenant_id = 1`).get().n;
    check('items: 2 rows kept under tenant 1', itemsCount === 2, `count=${itemsCount}`);

    const cv = db.prepare(`SELECT try_amount FROM current_values WHERE item_id = 1`).get();
    check('current_values: balance preserved (1500.50)', cv?.try_amount === 1500.50, `actual=${cv?.try_amount}`);

    const er = db.prepare(`SELECT value FROM settings WHERE tenant_id = 1 AND key = 'exchange_rate'`).get();
    check('settings: exchange_rate preserved (40.00)', er?.value === '40.00', `actual=${er?.value}`);

    const customAdmin = db.prepare(`SELECT value FROM settings WHERE tenant_id = 1 AND key = 'whatsapp_admin_token'`).get();
    check('settings: existing admin token NOT overwritten by seed', customAdmin?.value === 'custom_admin',
      `actual=${customAdmin?.value}`);

    const wm = db.prepare(`SELECT id, tenant_id FROM whatsapp_messages ORDER BY id`).all();
    check('whatsapp_messages: 2 rows kept', wm.length === 2);
    check('whatsapp_messages: tenant_id converted to integer 1', wm.every(r => r.tenant_id === 1),
      `actual=${JSON.stringify(wm)}`);

    const btx = db.prepare(`SELECT tenant_id, amount FROM bank_transactions`).get();
    check('bank_transactions: backfilled tenant_id=1', btx?.tenant_id === 1 && btx?.amount === 500);

    // 7) indexes موجودة
    const idxs = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%_tenant'`).all().map(r => r.name);
    check('tenant indexes created (>= 12)', idxs.length >= 12, `found ${idxs.length}: ${idxs.join(', ')}`);

    // 8) FK constraints — في القواعد الجديدة (CREATE TABLE) فقط.
    //    SQLite لا يسمح بإضافة REFERENCES عبر ALTER TABLE + DEFAULT.
    //    على القواعد القديمة نعتمد على middleware لاحقاً.
    const fks = db.prepare(`PRAGMA foreign_key_list(items)`).all();
    const hasTenantFk = fks.some(f => f.table === 'tenants' && f.from === 'tenant_id');
    check('items.tenant_id has FK → tenants (legacy: not enforced via ALTER)', !hasTenantFk,
      'expected NO FK on legacy ALTER (will be enforced in fresh DBs only)');

    // 9) إعادة تشغيل migration — idempotent (لا انفجار)
    db.close();
    await loadMigrationOn(dir);
    const db2 = await loadMigrationOn(dir);
    const itemsCount2 = db2.prepare(`SELECT COUNT(*) as n FROM items`).get().n;
    check('idempotent: re-running migration keeps data', itemsCount2 === 2);
    db2.close();
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function testFreshDb() {
  console.log('\n=== Test B: Fresh DB (Hetzner first boot) ===');
  const dir = makeTempDir('jrd-fresh-');
  try {
    const db = await loadMigrationOn(dir);

    const t = db.prepare('SELECT * FROM tenants WHERE id = 1').get();
    check('default tenant created on fresh DB', !!t && t.slug === 'default');

    const sInfo = db.prepare(`PRAGMA table_info(settings)`).all();
    const sPk = sInfo.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    check('fresh settings PK = (tenant_id, key)', sPk[0] === 'tenant_id' && sPk[1] === 'key');

    const er = db.prepare(`SELECT value FROM settings WHERE tenant_id = 1 AND key = 'exchange_rate'`).get();
    check('seeded exchange_rate on fresh DB', er?.value === '44.75');

    // INSERT بدون tenant_id يستخدم DEFAULT 1 (محاكاة لـ routes الحالية)
    db.prepare(`INSERT INTO items (name, type) VALUES ('بند جديد', 'manual')`).run();
    const row = db.prepare(`SELECT tenant_id FROM items WHERE name = 'بند جديد'`).get();
    check('INSERT without tenant_id → defaults to 1', row?.tenant_id === 1, `actual=${row?.tenant_id}`);

    // في الفرش الجديد: FK على tenant_id موجود
    const fks = db.prepare(`PRAGMA foreign_key_list(items)`).all();
    check('fresh DB: items.tenant_id has FK → tenants', fks.some(f => f.table === 'tenants' && f.from === 'tenant_id'));

    // اختبار CASCADE: حذف tenant 1 يحذف items? (لا ننفّذ فعلاً — نحتفظ بـ tenant 1)
    // لكن نتحقّق أن المحاولة على INSERT مع tenant_id غير موجود تفشل
    db.prepare(`INSERT INTO tenants (id, name, slug) VALUES (99, 'Test Tenant', 'test')`).run();
    db.prepare(`INSERT INTO items (tenant_id, name) VALUES (99, 'بند للمستأجر 99')`).run();
    const counts = db.prepare(`SELECT tenant_id, COUNT(*) as n FROM items GROUP BY tenant_id ORDER BY tenant_id`).all();
    check('fresh DB: items isolated by tenant', counts.length === 2 && counts[0].tenant_id === 1 && counts[1].tenant_id === 99,
      JSON.stringify(counts));

    // INSERT بـ tenant_id غير موجود → FK يرفض
    let fkRejected = false;
    try {
      db.prepare(`INSERT INTO items (tenant_id, name) VALUES (999, 'لمستأجر غير موجود')`).run();
    } catch (e) {
      fkRejected = String(e.message).includes('FOREIGN KEY');
    }
    check('fresh DB: FK rejects INSERT with non-existent tenant_id', fkRejected);

    db.close();
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

(async () => {
  await testLegacyMigration();
  await testFreshDb();
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
