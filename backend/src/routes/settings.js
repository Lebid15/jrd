import { Router } from 'express';
import db from '../database.js';
import { tid } from '../tenantHelpers.js';

const router = Router();

// Get all settings
router.get('/', (req, res) => {
  const t = tid(req);
  const settings = db.prepare('SELECT key, value FROM settings WHERE tenant_id = ?').all(t);
  const obj = {};
  for (const s of settings) obj[s.key] = s.value;
  res.json(obj);
});

// Update setting
router.put('/:key', (req, res) => {
  const t = tid(req);
  const { value } = req.body;
  db.prepare(`
    INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value
  `).run(t, req.params.key, String(value));
  res.json({ success: true });
});

export default router;
