import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const dbPath = path.join(DATA_DIR, 'jrd.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'manual',
    provider_type TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS current_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    try_amount REAL DEFAULT 0,
    usd_amount REAL DEFAULT 0,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS api_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL,
    base_url TEXT DEFAULT '',
    api_token TEXT DEFAULT '',
    kod TEXT DEFAULT '',
    sifre TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS inventories (
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

  CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_id INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
    item_id INTEGER,
    item_name TEXT NOT NULL,
    try_amount REAL DEFAULT 0,
    usd_amount REAL DEFAULT 0,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    notes TEXT DEFAULT '',
    uploaded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bank_transactions (
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

  CREATE TABLE IF NOT EXISTS whatsapp_messages (
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

  CREATE TABLE IF NOT EXISTS whatsapp_transactions (
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

  -- ─── الجرد الشهري ───────────────────────────────────────────────────────
  -- snapshot دوري لرأس المال + مجموع الأرباح في الفترة بين هذا الجرد والسابق.
  CREATE TABLE IF NOT EXISTS monthly_inventories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                          -- تاريخ إنشاء الجرد الشهري (YYYY-MM-DD)
    exchange_rate REAL NOT NULL,
    total_try REAL NOT NULL DEFAULT 0,           -- إجمالي الليرة وقت الـ snapshot
    total_usd REAL NOT NULL DEFAULT 0,           -- إجمالي الدولار وقت الـ snapshot
    total_converted_usd REAL NOT NULL DEFAULT 0, -- المجموع الكلي بالدولار
    previous_monthly_id INTEGER REFERENCES monthly_inventories(id) ON DELETE SET NULL,
    previous_total_usd REAL DEFAULT 0,           -- إجمالي الجرد الشهري السابق (للمقارنة)
    period_from TEXT DEFAULT '',                 -- بداية الفترة المغطّاة (created_at للسابق)
    period_to TEXT DEFAULT '',                   -- نهاية الفترة (created_at لهذا الجرد)
    period_profit REAL NOT NULL DEFAULT 0,       -- مجموع profit للجرود اليومية في الفترة
    daily_count INTEGER NOT NULL DEFAULT 0,      -- عدد الجرود اليومية المضمَّنة
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS monthly_inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monthly_inventory_id INTEGER NOT NULL REFERENCES monthly_inventories(id) ON DELETE CASCADE,
    item_id INTEGER,
    item_name TEXT NOT NULL,
    try_amount REAL DEFAULT 0,
    usd_amount REAL DEFAULT 0,
    notes TEXT DEFAULT ''
  );
`);

// ─── Migration: add whatsapp_group_name column to api_configs ────────────────
const cols = db.prepare("PRAGMA table_info(api_configs)").all().map(c => c.name);
if (!cols.includes('whatsapp_group_name')) {
  db.exec(`ALTER TABLE api_configs ADD COLUMN whatsapp_group_name TEXT DEFAULT ''`);
}

// ─── Migration: bank_sms_log — سجلّ خام لكل طلب يصل إلى /api/bank/sms-webhook
// نخزّن كل محاولة (نجاح/فشل) حتى يستطيع المستخدم تشخيص لماذا توقّفت رسائل البنك.
db.exec(`
  CREATE TABLE IF NOT EXISTS bank_sms_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    ip TEXT DEFAULT '',
    secret_ok INTEGER DEFAULT 1,         -- 0 إذا فشل التحقّق من SMS_WEBHOOK_SECRET
    parse_status TEXT DEFAULT '',        -- ok | no_body | no_pattern | no_bank_item | applied
    error_message TEXT DEFAULT '',
    sender TEXT DEFAULT '',
    raw_body TEXT DEFAULT '',
    item_id INTEGER,
    direction TEXT DEFAULT '',           -- in | out | ''
    amount REAL,
    transaction_id INTEGER               -- bank_transactions.id إذا تم التطبيق
  );
  CREATE INDEX IF NOT EXISTS idx_bank_sms_log_created ON bank_sms_log(created_at DESC);
`);

// ─── Migration: source + external_id on bank_transactions ───────────────────
// source = 'sms' (افتراضي — SMS Forwarder) أو 'gmsg' (Google Messages Web scraper)
// external_id = بصمة فريدة من المصدر لمنع التكرار (يُستخدم من gmsg scraper)
const btxCols = db.prepare("PRAGMA table_info(bank_transactions)").all().map(c => c.name);
if (!btxCols.includes('source')) {
  db.exec(`ALTER TABLE bank_transactions ADD COLUMN source TEXT DEFAULT 'sms'`);
}
if (!btxCols.includes('external_id')) {
  db.exec(`ALTER TABLE bank_transactions ADD COLUMN external_id TEXT`);
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_tx_external_id
    ON bank_transactions(external_id)
    WHERE external_id IS NOT NULL
`);

// ─── Default settings ────────────────────────────────────────────────────────
const seedSetting = (key, val) => {
  const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
  if (!exists) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, val);
};

seedSetting('exchange_rate', '44.75');
seedSetting('whatsapp_kw_us',     JSON.stringify(['لنا', 'النا', 'لينا', 'علينا']));
seedSetting('whatsapp_kw_them',   JSON.stringify(['لكم', 'لكن', 'عليكم', 'عليك']));
seedSetting('whatsapp_kw_try',    JSON.stringify(['تركي', 'تركى', 'تركية', 'ليرة', 'لير', 'تل', 'tl', 'try', 'lira', '₺']));
seedSetting('whatsapp_kw_usd',    JSON.stringify(['دولار', 'دولر', 'دلار', 'usd', 'usdt', 'dolar', 'dollar', 'doler', '$']));
seedSetting('whatsapp_kw_ignore', JSON.stringify(['مطابقة', 'مطابق', 'تطابق', 'match']));
seedSetting('whatsapp_admin_token', 'admin');

export default db;
