import { Router } from 'express';
import db from '../database.js';

const router = Router();

// Get all inventories (for archive)
router.get('/', (req, res) => {
  const { from, to, limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM inventories WHERE 1=1';
  const params = [];

  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to) { query += ' AND date <= ?'; params.push(to); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const inventories = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM inventories').get().count;
  res.json({ inventories, total });
});

// Get single inventory with items
router.get('/:id', (req, res) => {
  const inventory = db.prepare('SELECT * FROM inventories WHERE id = ?').get(req.params.id);
  if (!inventory) return res.status(404).json({ error: 'Not found' });

  const items = db.prepare('SELECT * FROM inventory_items WHERE inventory_id = ? ORDER BY id ASC').all(req.params.id);
  res.json({ ...inventory, items });
});

// Get last inventory
router.get('/last/one', (req, res) => {
  const inventory = db.prepare('SELECT * FROM inventories ORDER BY created_at DESC LIMIT 1').get();
  if (!inventory) return res.json(null);

  const items = db.prepare('SELECT * FROM inventory_items WHERE inventory_id = ? ORDER BY id ASC').all(inventory.id);
  res.json({ ...inventory, items });
});

// Create inventory (save current state)
router.post('/', (req, res) => {
  const { date } = req.body;
  const inventoryDate = date || new Date().toISOString().split('T')[0];

  // Get exchange rate
  const rateSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('exchange_rate');
  const exchangeRate = parseFloat(rateSetting?.value || '1');

  // Get all active items with values
  const items = db.prepare(`
    SELECT i.id, i.name, cv.try_amount, cv.usd_amount, cv.notes
    FROM items i
    LEFT JOIN current_values cv ON cv.item_id = i.id
    WHERE i.is_active = 1
    ORDER BY i.sort_order ASC, i.id ASC
  `).all();

  // Calculate totals
  let totalTry = 0;
  let totalUsd = 0;
  for (const item of items) {
    totalTry += item.try_amount || 0;
    totalUsd += item.usd_amount || 0;
  }

const tryConvertedToUsd = Math.round((exchangeRate > 0 ? totalTry / exchangeRate : 0) * 100) / 100;
    const totalConvertedUsd = Math.round((totalUsd + tryConvertedToUsd) * 100) / 100;

  // Get previous inventory
  const prevInventory = db.prepare('SELECT total_converted_usd FROM inventories ORDER BY created_at DESC LIMIT 1').get();
const previousTotal = Math.round((prevInventory?.total_converted_usd || 0) * 100) / 100;
    const profit = Math.round((totalConvertedUsd - previousTotal) * 100) / 100;

  // Save inventory
  const createInventory = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO inventories (date, exchange_rate, total_try, total_usd, total_converted_usd, previous_total_usd, profit)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(inventoryDate, exchangeRate, totalTry, totalUsd, totalConvertedUsd, previousTotal, profit);

    const inventoryId = result.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO inventory_items (inventory_id, item_id, item_name, try_amount, usd_amount, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(inventoryId, item.id, item.name, item.try_amount || 0, item.usd_amount || 0, item.notes || '');
    }

    return { id: inventoryId, profit, totalConvertedUsd, previousTotal };
  });

  const result = createInventory();
  res.json(result);
});

// Delete inventory
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM inventory_items WHERE inventory_id = ?').run(req.params.id);
  db.prepare('DELETE FROM inventories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
