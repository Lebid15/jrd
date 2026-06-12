import { Router } from 'express';
import db from '../database.js';
import { fetchBalance } from '../providers.js';
import { tid } from '../tenantHelpers.js';

const router = Router();

// Get API config for an item
router.get('/:itemId', (req, res) => {
  const t = tid(req);
  const config = db.prepare('SELECT * FROM api_configs WHERE item_id = ? AND tenant_id = ?').get(req.params.itemId, t);
  res.json(config || null);
});

// Save/update API config for an item
router.put('/:itemId', (req, res) => {
  const t = tid(req);
  const { provider_type, base_url, api_token, kod, sifre, whatsapp_group_name } = req.body;
  const itemId = req.params.itemId;

  // تأكّد ملكية الـ item
  const own = db.prepare('SELECT id FROM items WHERE id = ? AND tenant_id = ?').get(itemId, t);
  if (!own) return res.status(404).json({ error: 'item_not_found' });

  // Also update the item's type and provider_type
  db.prepare('UPDATE items SET type = ?, provider_type = ? WHERE id = ? AND tenant_id = ?')
    .run('provider', provider_type, itemId, t);

  db.prepare(`
    INSERT INTO api_configs (tenant_id, item_id, provider_type, base_url, api_token, kod, sifre, whatsapp_group_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      provider_type = excluded.provider_type,
      base_url = excluded.base_url,
      api_token = excluded.api_token,
      kod = excluded.kod,
      sifre = excluded.sifre,
      whatsapp_group_name = excluded.whatsapp_group_name
  `).run(t, itemId, provider_type, base_url || '', api_token || '', kod || '', sifre || '', whatsapp_group_name || '');

  res.json({ success: true });
});

// أنواع تُحدَّث من مصدر خارجي (واتساب / SMS بنك) — لا داعي لجلبها
const PASSIVE_TYPES = new Set(['whatsapp_group', 'kuveyt_turk']);

// Fetch balance for a single provider item
router.post('/:itemId/fetch', async (req, res) => {
  try {
    const t = tid(req);
    const config = db.prepare('SELECT * FROM api_configs WHERE item_id = ? AND tenant_id = ?').get(req.params.itemId, t);
    if (!config) return res.status(404).json({ error: 'No API config found' });

    if (PASSIVE_TYPES.has(config.provider_type)) {
      const cv = db.prepare('SELECT try_amount, usd_amount FROM current_values WHERE item_id = ? AND tenant_id = ?').get(req.params.itemId, t);
      return res.json({
        balance: cv?.try_amount ?? 0,
        usd_amount: cv?.usd_amount ?? 0,
        currency: 'TRY',
        passive: true,
        message: 'هذا البند يُحدَّث تلقائياً من المصدر الخارجي (واتساب / بنك).',
      });
    }

    const result = await fetchBalance(config.provider_type, config, { itemId: req.params.itemId, tenantId: t });
    const roundedValue = Math.round(result.value * 100) / 100;
    const isUsd = result.currency === 'USD';
    const field = isUsd ? 'usd_amount' : 'try_amount';

    const existing = db.prepare('SELECT id FROM current_values WHERE item_id = ? AND tenant_id = ?').get(req.params.itemId, t);
    if (existing) {
      db.prepare(`UPDATE current_values SET ${field} = ? WHERE item_id = ? AND tenant_id = ?`).run(roundedValue, req.params.itemId, t);
    } else {
      db.prepare(`INSERT INTO current_values (tenant_id, item_id, ${field}) VALUES (?, ?, ?)`).run(t, req.params.itemId, roundedValue);
    }

    res.json({ balance: roundedValue, currency: result.currency || 'TRY', details: result.details });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch all provider balances
router.post('/fetch-all', async (req, res) => {
  const t = tid(req);
  const configs = db.prepare(`
    SELECT ac.*, i.name as item_name
    FROM api_configs ac
    JOIN items i ON i.id = ac.item_id AND i.tenant_id = ac.tenant_id
    WHERE i.is_active = 1 AND ac.tenant_id = ?
  `).all(t);

  const results = [];
  for (const config of configs) {
    try {
      if (PASSIVE_TYPES.has(config.provider_type)) {
        results.push({ item_id: config.item_id, name: config.item_name, passive: true, success: true });
        continue;
      }
      const result = await fetchBalance(config.provider_type, config, { itemId: config.item_id, tenantId: t });
      const roundedValue = Math.round(result.value * 100) / 100;
      const isUsd = result.currency === 'USD';
      const field = isUsd ? 'usd_amount' : 'try_amount';

      const existing = db.prepare('SELECT id FROM current_values WHERE item_id = ? AND tenant_id = ?').get(config.item_id, t);
      if (existing) {
        db.prepare(`UPDATE current_values SET ${field} = ? WHERE item_id = ? AND tenant_id = ?`).run(roundedValue, config.item_id, t);
      } else {
        db.prepare(`INSERT INTO current_values (tenant_id, item_id, ${field}) VALUES (?, ?, ?)`).run(t, config.item_id, roundedValue);
      }

      results.push({ item_id: config.item_id, name: config.item_name, balance: roundedValue, currency: result.currency || 'TRY', details: result.details, success: true });
    } catch (err) {
      results.push({ item_id: config.item_id, name: config.item_name, error: err.message, success: false });
    }
  }

  res.json(results);
});

// Delete API config
router.delete('/:itemId', (req, res) => {
  const t = tid(req);
  db.prepare('DELETE FROM api_configs WHERE item_id = ? AND tenant_id = ?').run(req.params.itemId, t);
  db.prepare('UPDATE items SET type = ?, provider_type = NULL WHERE id = ? AND tenant_id = ?').run('manual', req.params.itemId, t);
  res.json({ success: true });
});

export default router;
