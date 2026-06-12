#!/usr/bin/env node
/**
 * Migrate data from Railway snapshot DB into Hetzner multi-tenant DB.
 *
 * Usage (inside jrd-app container):
 *   node backend/scripts/migrate-railway-to-tenant.js \
 *        --source=/data/migration/jrd-railway.db \
 *        --target-tenant=2 \
 *        [--dry-run]
 *
 * - Source DB must be a SQLite file with the same schema family (it can have
 *   tenant_id columns with all rows = 1, or older schema without tenant_id).
 * - Target DB is the live Hetzner DB at /data/jrd.db (opened via the app's
 *   own connection module so WAL is consistent).
 *
 * Behavior:
 *   - Skips: tenants, users, auth_sessions, sqlite_sequence (we keep Hetzner auth).
 *   - For every other table, copies all rows from source where (tenant_id IS NULL OR tenant_id = 1)
 *     and inserts into target with tenant_id = <target>.
 *   - Preserves original IDs (target tables expected empty for that tenant).
 *   - Wraps everything in a single transaction. On any error -> rollback.
 *   - Refreshes sqlite_sequence so future AUTOINCREMENT continues past migrated IDs.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

// Parse args
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const SRC = args.source;
const TARGET_TENANT = parseInt(args['target-tenant'], 10);
const DRY = !!args['dry-run'];

if (!SRC || !Number.isInteger(TARGET_TENANT)) {
  console.error('Usage: node migrate-railway-to-tenant.js --source=<path> --target-tenant=<id> [--dry-run]');
  process.exit(2);
}
if (!fs.existsSync(SRC)) {
  console.error('Source DB not found:', SRC);
  process.exit(2);
}

// Open target through the app's own module so the live WAL is honored.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetMod = await import(path.join(__dirname, '..', 'src', 'database.js'));
const target = targetMod.default;

// Open source as readonly
const source = new Database(SRC, { readonly: true });

// Verify target tenant exists & is active
const tenant = target.prepare('SELECT id, name FROM tenants WHERE id = ?').get(TARGET_TENANT);
if (!tenant) {
  console.error(`Target tenant id=${TARGET_TENANT} not found in target DB.`);
  process.exit(3);
}
console.log(`Target tenant: id=${tenant.id} name="${tenant.name}"`);
console.log(`Source DB: ${SRC}`);
console.log(`Dry run: ${DRY ? 'YES (no writes)' : 'NO'}`);
console.log('---');

// Tables to copy, in FK-safe order. Excludes tenants/users/auth_sessions.
const TABLES = [
  'items',
  'current_values',
  'api_configs',
  'inventories',
  'inventory_items',
  'monthly_inventories',
  'monthly_inventory_items',
  'photos',
  'settings',
  'bank_transactions',
  'bank_sms_log',
  'whatsapp_messages',
  'whatsapp_transactions',
];

function getColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
}

function tableExists(db, table) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}

// Pre-flight: check target tables are empty for that tenant, warn otherwise.
for (const t of TABLES) {
  if (!tableExists(target, t)) {
    console.warn(`[skip-precheck] target missing table: ${t}`);
    continue;
  }
  const cols = getColumns(target, t);
  if (!cols.includes('tenant_id')) continue;
  const existing = target.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE tenant_id = ?`).get(TARGET_TENANT).c;
  if (existing > 0) {
    console.warn(`[WARN] target.${t} already has ${existing} row(s) for tenant ${TARGET_TENANT}`);
  }
}

const summary = [];

function migrateTable(t) {
  if (!tableExists(source, t)) {
    summary.push({ table: t, copied: 0, note: 'source-missing' });
    return;
  }
  if (!tableExists(target, t)) {
    summary.push({ table: t, copied: 0, note: 'target-missing' });
    return;
  }
  const srcCols = getColumns(source, t);
  const tgtCols = getColumns(target, t);
  // Use intersection so we don't blow up on schema drift.
  const cols = srcCols.filter((c) => tgtCols.includes(c));
  if (cols.length === 0) {
    summary.push({ table: t, copied: 0, note: 'no-common-columns' });
    return;
  }
  const hasTenant = cols.includes('tenant_id');
  const where = hasTenant ? 'WHERE tenant_id IS NULL OR tenant_id = 1' : '';
  const rows = source.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t}" ${where}`).all();
  if (rows.length === 0) {
    summary.push({ table: t, copied: 0, note: 'empty-source' });
    return;
  }
  // Build INSERT (use REPLACE for tables with composite/non-id natural keys
  // so previously-seeded rows in the target are overwritten by source values).
  const REPLACE_TABLES = new Set(['settings']);
  const verb = REPLACE_TABLES.has(t) ? 'INSERT OR REPLACE' : 'INSERT';
  const insertCols = hasTenant ? cols : [...cols, 'tenant_id'];
  const placeholders = insertCols.map((c) => `@${c}`).join(', ');
  const stmt = target.prepare(
    `${verb} INTO "${t}" (${insertCols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`
  );
  let copied = 0;
  for (const row of rows) {
    // Force tenant_id to target
    row.tenant_id = TARGET_TENANT;
    stmt.run(row);
    copied++;
  }
  // Refresh sqlite_sequence for AUTOINCREMENT tables so future inserts don't collide
  if (cols.includes('id')) {
    const maxId = target.prepare(`SELECT MAX(id) AS m FROM "${t}"`).get().m || 0;
    const seqExists = target.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`).get();
    if (seqExists && maxId > 0) {
      const exists = target.prepare(`SELECT seq FROM sqlite_sequence WHERE name = ?`).get(t);
      if (exists) {
        target.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`).run(maxId, t);
      } else {
        target.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`).run(t, maxId);
      }
    }
  }
  summary.push({ table: t, copied, note: '' });
}

// Run inside a single transaction (rollback on any error)
const txn = target.transaction(() => {
  for (const t of TABLES) migrateTable(t);
  if (DRY) {
    // Force rollback
    throw new Error('__DRY_RUN_ROLLBACK__');
  }
});

try {
  txn();
} catch (e) {
  if (DRY && e.message === '__DRY_RUN_ROLLBACK__') {
    console.log('[dry-run] all writes rolled back.');
  } else {
    console.error('Migration FAILED, rolled back:', e);
    process.exit(1);
  }
}

console.log('--- SUMMARY ---');
console.table(summary);
console.log(DRY ? '(dry-run, no changes persisted)' : 'OK: migration committed.');

// Final per-tenant counts
console.log('\n--- TARGET COUNTS FOR TENANT', TARGET_TENANT, '---');
const out = [];
for (const t of TABLES) {
  if (!tableExists(target, t)) continue;
  const cols = getColumns(target, t);
  if (!cols.includes('tenant_id')) continue;
  const c = target.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE tenant_id = ?`).get(TARGET_TENANT).c;
  out.push({ table: t, rows: c });
}
console.table(out);
