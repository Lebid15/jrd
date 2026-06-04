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
`);

// Default settings
const existingRate = db.prepare('SELECT value FROM settings WHERE key = ?').get('exchange_rate');
if (!existingRate) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('exchange_rate', '44.75');
}

export default db;
