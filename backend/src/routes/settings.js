import { Router } from 'express';
import db from '../database.js';

const router = Router();

// Get all settings
router.get('/', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const s of settings) obj[s.key] = s.value;
  res.json(obj);
});

// Update setting
router.put('/:key', (req, res) => {
  const { value } = req.body;
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(req.params.key);
  if (existing) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(value), req.params.key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(req.params.key, String(value));
  }
  res.json({ success: true });
});

export default router;
