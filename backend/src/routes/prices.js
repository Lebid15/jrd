import { Router } from 'express';
import db from '../database.js';
import { tid } from '../tenantHelpers.js';
import { fetchPackages, supportsPriceList } from '../priceProviders.js';

const router = Router();

// التبويبات المدعومة. حالياً نعمل على "games" فقط؛ البقية placeholders.
const TABS = new Set(['games', 'turkcell', 'vodafone', 'avea']);

// قائمة المصادر المرشّحة = بنود المزوّدين التي تدعم قائمة أسعار (znet / barakat).
router.get('/sources', (req, res) => {
  const t = tid(req);
  const rows = db.prepare(`
    SELECT i.id AS item_id, i.name, ac.provider_type, ac.base_url,
      (SELECT MAX(fetched_at) FROM price_packages pp
         WHERE pp.source_item_id = i.id AND pp.tenant_id = i.tenant_id) AS last_fetched_at,
      (SELECT COUNT(*) FROM price_packages pp
         WHERE pp.source_item_id = i.id AND pp.tenant_id = i.tenant_id) AS package_count
    FROM items i
    JOIN api_configs ac ON ac.item_id = i.id AND ac.tenant_id = i.tenant_id
    WHERE i.tenant_id = ? AND i.is_active = 1
    ORDER BY i.sort_order, i.id
  `).all(t);

  const sources = rows.filter((r) => supportsPriceList(r.provider_type));
  res.json(sources);
});

// تحديث الأسعار: يجلب الباقات من كل المصادر المدعومة (أو مصدر واحد) ويخزّن لقطة.
router.post('/refresh', async (req, res) => {
  const t = tid(req);
  const tab = req.body?.tab || 'games';
  if (!TABS.has(tab)) return res.status(400).json({ error: 'bad_tab' });
  const onlyItemId = req.body?.item_id ? Number(req.body.item_id) : null;

  const configs = db.prepare(`
    SELECT ac.*, i.name AS item_name
    FROM api_configs ac
    JOIN items i ON i.id = ac.item_id AND i.tenant_id = ac.tenant_id
    WHERE ac.tenant_id = ? AND i.is_active = 1
  `).all(t);

  const del = db.prepare('DELETE FROM price_packages WHERE tenant_id = ? AND source_item_id = ? AND tab = ?');
  const ins = db.prepare(`
    INSERT INTO price_packages
      (tenant_id, source_item_id, source_name, provider_type, tab,
       external_ref, name, category, denomination, match_key, price, currency, is_available, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const results = [];
  for (const cfg of configs) {
    if (!supportsPriceList(cfg.provider_type)) continue;
    if (onlyItemId && cfg.item_id !== onlyItemId) continue;
    try {
      const pkgs = await fetchPackages(cfg.provider_type, cfg);
      const write = db.transaction(() => {
        del.run(t, cfg.item_id, tab);
        for (const p of pkgs) {
          ins.run(
            t, cfg.item_id, cfg.item_name, cfg.provider_type, tab,
            p.external_ref, p.name, p.category, p.denomination, p.match_key,
            p.price, p.currency, p.is_available,
          );
        }
      });
      write();
      results.push({ item_id: cfg.item_id, name: cfg.item_name, success: true, count: pkgs.length });
    } catch (err) {
      results.push({ item_id: cfg.item_id, name: cfg.item_name, success: false, error: err.message });
    }
  }
  res.json({ tab, results });
});

// المقارنة: يجمّع الباقات حسب match_key عبر كل المصادر، ويحسب الأرخص.
router.get('/compare', (req, res) => {
  const t = tid(req);
  const tab = req.query.tab || 'games';
  if (!TABS.has(tab)) return res.status(400).json({ error: 'bad_tab' });

  const rows = db.prepare(`
    SELECT source_item_id, source_name, provider_type, match_key,
           name, category, denomination, price, currency, is_available
    FROM price_packages
    WHERE tenant_id = ? AND tab = ?
    ORDER BY match_key, price ASC
  `).all(t, tab);

  // المصادر الموجودة فعلاً في اللقطة
  const sourcesMap = new Map();
  for (const r of rows) {
    if (!sourcesMap.has(r.source_item_id)) {
      sourcesMap.set(r.source_item_id, {
        item_id: r.source_item_id,
        name: r.source_name,
        provider_type: r.provider_type,
      });
    }
  }
  const sources = [...sourcesMap.values()];

  // تجميع حسب match_key
  const groupsMap = new Map();
  for (const r of rows) {
    const key = r.match_key || r.name.toLowerCase();
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        match_key: key,
        display_name: r.name,
        category: r.category,
        denomination: r.denomination,
        prices: {},
      });
    }
    const g = groupsMap.get(key);
    const cur = g.prices[r.source_item_id];
    // نحتفظ بأقل سعر لكل مصدر (في حال وجود تكرار)
    if (cur == null || r.price < cur.price) {
      g.prices[r.source_item_id] = {
        price: r.price,
        currency: r.currency,
        name: r.name,
        available: !!r.is_available,
      };
    }
  }

  const groups = [...groupsMap.values()].map((g) => {
    const entries = Object.entries(g.prices).map(([sid, v]) => ({ source_item_id: Number(sid), ...v }));
    const priced = entries.filter((e) => e.available && e.price > 0);
    const cheapest = priced.length ? Math.min(...priced.map((e) => e.price)) : null;
    return { ...g, cheapest_price: cheapest, source_count: entries.length };
  });

  // فرز: الأكثر انتشاراً عبر المصادر أوّلاً، ثم أبجدياً
  groups.sort((a, b) => b.source_count - a.source_count || a.display_name.localeCompare(b.display_name));

  res.json({ tab, sources, groups });
});

export default router;
