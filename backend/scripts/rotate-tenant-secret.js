/**
 * CLI: توليد/تدوير الـ webhook secret لـ tenant معيّن.
 *
 * تشغيل:
 *   node scripts/rotate-tenant-secret.js <tenant_id>
 *
 * الناتج: يطبع الـ secret الجديد + URL الكامل للـ webhook.
 *
 * ملاحظة: يُحفَظ في settings(tenant_id, key='sms_webhook_secret', value=<secret>).
 * إن وُجد secret سابق، يُستبدَل (التدوير يُبطل URL القديم فوراً).
 */
import crypto from 'crypto';
import db, { DEFAULT_TENANT_ID } from '../src/database.js';

const tenantIdArg = process.argv[2];
if (!tenantIdArg) {
  console.error('Usage: node scripts/rotate-tenant-secret.js <tenant_id>');
  process.exit(1);
}
const tenantId = parseInt(tenantIdArg, 10);
if (!Number.isInteger(tenantId) || tenantId <= 0) {
  console.error('tenant_id must be a positive integer');
  process.exit(1);
}

const tenant = db.prepare('SELECT id, slug, name FROM tenants WHERE id = ?').get(tenantId);
if (!tenant) {
  console.error(`tenant ${tenantId} not found`);
  process.exit(1);
}

const secret = crypto.randomBytes(24).toString('base64url'); // ~32 char URL-safe
db.prepare(`
  INSERT INTO settings (tenant_id, key, value, updated_at)
  VALUES (?, 'sms_webhook_secret', ?, datetime('now'))
  ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`).run(tenantId, secret);

const baseUrl = process.env.PUBLIC_BASE_URL || 'https://your-domain.example';
console.log(`✓ Rotated webhook secret for tenant ${tenantId} (${tenant.slug}: ${tenant.name})`);
console.log(`  Secret: ${secret}`);
console.log(`  URL:    ${baseUrl}/api/webhooks/bank-sms/${secret}`);
console.log('');
console.log('  → ضع هذا الـ URL في تطبيق SMS Forwarder على جوال المستأجر.');
console.log('  → عند التدوير، الـ URL القديم يتوقّف فوراً.');

// silence unused-import warning
void DEFAULT_TENANT_ID;
