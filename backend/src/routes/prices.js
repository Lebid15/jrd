import { Router } from 'express';
import db from '../database.js';
import { tid } from '../tenantHelpers.js';
import { fetchPackages, supportsPriceList, cleanText, makeMatchKey } from '../priceProviders.js';

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

// قائمة باقات مصدر واحد (للمطابقة اليدوية) — تُقرأ من اللقطة المخزّنة.
router.get('/packages', (req, res) => {
  const t = tid(req);
  const tab = req.query.tab || 'games';
  const itemId = Number(req.query.item_id);
  if (!TABS.has(tab) || !itemId) return res.status(400).json({ error: 'bad_params' });
  const rows = db.prepare(`
    SELECT external_ref, name, category, denomination, price, currency, is_available
    FROM price_packages
    WHERE tenant_id = ? AND tab = ? AND source_item_id = ?
    ORDER BY name
  `).all(t, tab, itemId);
  // تنظيف الأسماء عند القراءة (البيانات القديمة قد تحوي HTML)
  const cleaned = rows.map((r) => ({ ...r, name: cleanText(r.name), category: cleanText(r.category) }));
  res.json(cleaned);
});

// ربط يدوي: صفّ المقارنة (match_key) ↔ باقة مصدر معيّن.
router.post('/link', (req, res) => {
  const t = tid(req);
  const { tab = 'games', match_key, source_item_id, external_ref } = req.body || {};
  if (!TABS.has(tab) || !match_key || !source_item_id || external_ref == null) {
    return res.status(400).json({ error: 'bad_params' });
  }
  const own = db.prepare('SELECT 1 FROM items WHERE id = ? AND tenant_id = ?').get(source_item_id, t);
  if (!own) return res.status(404).json({ error: 'source_not_found' });
  db.prepare(`
    INSERT INTO price_links (tenant_id, tab, match_key, source_item_id, external_ref)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, tab, match_key, source_item_id)
    DO UPDATE SET external_ref = excluded.external_ref, created_at = datetime('now')
  `).run(t, tab, match_key, source_item_id, String(external_ref));
  res.json({ success: true });
});

// إلغاء ربط يدوي.
router.delete('/link', (req, res) => {
  const t = tid(req);
  const { tab = 'games', match_key, source_item_id } = req.body || {};
  if (!TABS.has(tab) || !match_key || !source_item_id) return res.status(400).json({ error: 'bad_params' });
  db.prepare('DELETE FROM price_links WHERE tenant_id = ? AND tab = ? AND match_key = ? AND source_item_id = ?')
    .run(t, tab, match_key, source_item_id);
  res.json({ success: true });
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
           external_ref, name, category, denomination, price, currency, is_available
    FROM price_packages
    WHERE tenant_id = ? AND tab = ?
    ORDER BY match_key, price ASC
  `).all(t, tab);

  // بحث سريع عن باقة بـ (source_item_id, external_ref) — للمطابقة اليدوية.
  const pkgByRef = new Map();
  for (const r of rows) pkgByRef.set(`${r.source_item_id}|${r.external_ref}`, r);

  // إعادة حساب مفتاح المطابقة من الاسم (يعمل فوراً على البيانات المخزّنة دون حاجة لتحديث).
  const keyOf = (r) => makeMatchKey({ name: r.name }) || r.match_key || String(r.name || '').toLowerCase();

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
    const key = keyOf(r);
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        match_key: key,
        display_name: cleanText(r.name),
        category: cleanText(r.category),
        denomination: r.denomination,
        external_ref: null,
        prices: {},
        hasZnet: false,
      });
    }
    const grp = groupsMap.get(key);
    // الصفّ يُرتكز على باقات znet (تتطابق تلقائياً). zdk تُضاف بالربط فقط.
    if (r.provider_type === 'znet') {
      grp.hasZnet = true;
      // رقم الربط (external_ref) من باقة znet — يُعرض بجانب اسم المنتج.
      if (grp.external_ref == null) grp.external_ref = r.external_ref;
    }
    const cur = grp.prices[r.source_item_id];
    // نحتفظ بأقل سعر لكل مصدر (في حال وجود تكرار)
    if (cur == null || r.price < cur.price) {
      grp.prices[r.source_item_id] = {
        price: r.price,
        currency: r.currency,
        name: cleanText(r.name),
        available: !!r.is_available,
      };
    }
  }

  // تطبيق الروابط اليدوية: تُدخِل سعر باقة مصدر إلى صفّ مطابقة معيّن.
  const links = db.prepare(
    'SELECT match_key, source_item_id, external_ref FROM price_links WHERE tenant_id = ? AND tab = ?'
  ).all(t, tab);
  for (const lk of links) {
    const g = groupsMap.get(lk.match_key);
    if (!g) continue;
    const pkg = pkgByRef.get(`${lk.source_item_id}|${lk.external_ref}`);
    if (!pkg) continue;
    g.prices[lk.source_item_id] = {
      price: pkg.price,
      currency: pkg.currency,
      name: cleanText(pkg.name),
      available: !!pkg.is_available,
      manual: true,
    };
  }

  // نعرض فقط الصفوف المرتكزة على znet (باقات zdk المستقلّة لا تظهر كصفوف؛ تظهر بالربط).
  const groups = [...groupsMap.values()].filter((g) => g.hasZnet).map((g) => {
    const entries = Object.entries(g.prices).map(([sid, v]) => ({ source_item_id: Number(sid), ...v }));
    const priced = entries.filter((e) => e.available && e.price > 0);
    const cheapest = priced.length ? Math.min(...priced.map((e) => e.price)) : null;
    return { ...g, cheapest_price: cheapest, source_count: entries.length };
  });

  // فرز ثابت حسب المنتج: باقات المنتج الواحد متجاورة، مرتّبة حسب الفئة (الكمية).
  // الترتيب لا يتأثّر بالربط اليدوي (لا نفرز حسب عدد المصادر).
  const num = (s) => {
    const n = parseFloat(String(s ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : Infinity;
  };
  groups.sort((a, b) =>
    (a.category || '').localeCompare(b.category || '', 'ar') ||
    num(a.denomination) - num(b.denomination) ||
    (a.display_name || '').localeCompare(b.display_name || '', 'ar')
  );

  res.json({ tab, sources, groups });
});

export default router;
