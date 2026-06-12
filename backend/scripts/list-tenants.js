#!/usr/bin/env node
// List tenants and users from the live DB (reads through better-sqlite3, sees WAL)
import db from '../../backend/src/database.js';

console.log('=== TENANTS ===');
const tenants = db.prepare('SELECT id, name, slug, is_active, created_at FROM tenants ORDER BY id').all();
console.table(tenants);

console.log('\n=== USERS ===');
const users = db.prepare('SELECT id, tenant_id, email, role, is_active FROM users ORDER BY id').all();
console.table(users);
