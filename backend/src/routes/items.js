import { Router } from 'express';
import db from '../database.js';
import { tid } from '../tenantHelpers.js';

const router = Router();

// Get all items with their current values
router.get('/', (req, res) => {
  const t = tid(req);
  const items = db.prepare(`
    SELECT i.*, cv.try_amount, cv.usd_amount, cv.notes,
           ac.provider_type as api_provider_type, ac.base_url, ac.api_token, ac.kod, ac.sifre
    FROM items i
    LEFT JOIN current_values cv ON cv.item_id = i.id AND cv.tenant_id = i.tenant_id
    LEFT JOIN api_configs ac ON ac.item_id = i.id AND ac.tenant_id = i.tenant_id
    WHERE i.is_active = 1 AND i.tenant_id = ?
    ORDER BY i.sort_order ASC, i.id ASC
  `).all(t);
  res.json(items);
});

// Create item
router.post('/', (req, res) => {
  const t = tid(req);
  const { name, type = 'manual', provider_type, sort_order = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM items WHERE is_active = 1 AND tenant_id = ?').get(t);
  const order = sort_order || (maxOrder.max || 0) + 1;

  const result = db.prepare(
    'INSERT INTO items (tenant_id, name, type, provider_type, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(t, name, type, provider_type || null, order);

  db.prepare(
    'INSERT INTO current_values (tenant_id, item_id, try_amount, usd_amount, notes) VALUES (?, ?, 0, 0, ?)'
  ).run(t, result.lastInsertRowid, '');

  res.json({ id: result.lastInsertRowid });
});

// Update item
router.put('/:id', (req, res) => {
  const t = tid(req);
  const { name, sort_order, type } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
  if (type !== undefined) { updates.push('type = ?'); params.push(type); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id, t);
  const info = db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
  if (info.changes === 0) return res.status(404).json({ error: 'item_not_found' });
  res.json({ success: true });
});

// Update item values (TRY, USD, notes)
router.put('/:id/values', (req, res) => {
  const t = tid(req);
  const { try_amount, usd_amount, notes } = req.body;
  const itemId = req.params.id;

  // تأكّد أن الـ item يخص هذا المستأجر
  const ownItem = db.prepare('SELECT id FROM items WHERE id = ? AND tenant_id = ?').get(itemId, t);
  if (!ownItem) return res.status(404).json({ error: 'item_not_found' });

  const existing = db.prepare('SELECT id FROM current_values WHERE item_id = ? AND tenant_id = ?').get(itemId, t);
  if (existing) {
    const updates = [];
    const params = [];
    if (try_amount !== undefined) { updates.push('try_amount = ?'); params.push(Math.round(try_amount * 100) / 100); }
    if (usd_amount !== undefined) { updates.push('usd_amount = ?'); params.push(Math.round(usd_amount * 100) / 100); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (updates.length > 0) {
      params.push(itemId, t);
      db.prepare(`UPDATE current_values SET ${updates.join(', ')} WHERE item_id = ? AND tenant_id = ?`).run(...params);
    }
  } else {
    db.prepare(
      'INSERT INTO current_values (tenant_id, item_id, try_amount, usd_amount, notes) VALUES (?, ?, ?, ?, ?)'
    ).run(t, itemId, try_amount || 0, usd_amount || 0, notes || '');
  }
  res.json({ success: true });
});

// Delete item (soft delete)
router.delete('/:id', (req, res) => {
  const t = tid(req);
  const info = db.prepare('UPDATE items SET is_active = 0 WHERE id = ? AND tenant_id = ?').run(req.params.id, t);
  if (info.changes === 0) return res.status(404).json({ error: 'item_not_found' });
  res.json({ success: true });
});

// Reorder items
router.post('/reorder', (req, res) => {
  const t = tid(req);
  const { items } = req.body; // [{id, sort_order}]
  const stmt = db.prepare('UPDATE items SET sort_order = ? WHERE id = ? AND tenant_id = ?');
  const updateMany = db.transaction((list) => {
    for (const item of list) {
      stmt.run(item.sort_order, item.id, t);
    }
  });
  updateMany(items);
  res.json({ success: true });
});

export default router;
