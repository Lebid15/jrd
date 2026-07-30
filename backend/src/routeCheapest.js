import { makeMatchKey, KONTOR_OPERATORS } from './priceProviders.js';

// ════════════════════════════════════════════════════════════════════════════
// حساب خطّة توجيه الباقات «حسب الأرخص» لتبويب كونتور معيّن + نوع (tip).
// - يُرتّب لكل باقة (حسب رقم الربط) المزوّدين من الأرخص للأغلى.
// - يستثني المزوّد الافتراضي (باقاتي) — فهو موقعنا نفسه الذي نوجّه عليه.
// - التعادل: الأقدم إضافةً إلى الجدول (sort_order ثم id).
// - يُرجع أوّل 3 مزوّدين لكل باقة (الباقي Kapat).
// المطابقة مع صفوف زينت تتم برقم الربط (external_ref/küpür) في الروبوت.
// ════════════════════════════════════════════════════════════════════════════

const norm = (s) => String(s ?? '').trim();

// رقم الربط الموحّد: نتجاهل الكسور (".00") ونُبقي الجزء الصحيح فقط.
// زينت يعرض "24583.00" ونحن نخزّن "24583" — نوحّدهما هنا.
export function normalizeRef(ref) {
  const s = norm(ref);
  if (!s) return '';
  // خُذ ما قبل النقطة العشرية (لو وُجدت)، وأزل أي محارف غير رقمية زائدة.
  const m = s.match(/^-?\d+/);
  return m ? m[0] : s;
}

export function computeRoutingPlan(db, tenantId, tab, category, { defaultItemId = null, topN = 3, includeItemIds = null, priorityMap = null, mode = 'kontor' } = {}) {
  const isGames = mode === 'games';
  // مجموعة المصادر المسموح ترشيحها (الأعمدة المُضافة للمقارنة). null = الكل.
  const includeSet = Array.isArray(includeItemIds) && includeItemIds.length
    ? new Set(includeItemIds.map(Number))
    : null;

  // أولوية كسر التعادل اليدوية { item_id: رقم } — الأصغر أولاً؛ بلا رقم = الأدنى.
  const prio = (itemId) => {
    const v = priorityMap ? priorityMap[itemId] ?? priorityMap[String(itemId)] : null;
    const n = Number(v);
    return (v == null || v === '' || Number.isNaN(n)) ? Infinity : n;
  };
  if (!KONTOR_OPERATORS[tab] && !isGames) {
    throw new Error('bad_tab: التوجيه متاح لتبويبات الكونتور والألعاب فقط');
  }
  const wantCat = norm(category).toLowerCase();

  // مفتاح المطابقة: الكونتور برقم الربط (küpür)، والألعاب بـ (لعبة + فئة).
  const groupKey = (r) => {
    if (!isGames) { const ref = normalizeRef(r.external_ref); return ref ? `k${ref}` : makeMatchKey({ name: r.name }); }
    const denom = String(r.denomination ?? '').trim();
    const game = norm(r.category);
    return (denom && game) ? `g${makeMatchKey({ name: `${game} ${denom}` })}` : makeMatchKey({ name: r.name });
  };

  // ترتيب المصادر (المزوّدين) كما أُضيفت للجدول: sort_order ثم id.
  const items = db.prepare(`
    SELECT id, name, sort_order FROM items
    WHERE tenant_id = ? AND is_active = 1
  `).all(tenantId);
  const orderOf = new Map();   // item_id → رتبة الإضافة (أصغر = أقدم)
  [...items]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id - b.id))
    .forEach((it, idx) => orderOf.set(it.id, idx));

  const rows = db.prepare(`
    SELECT source_item_id, source_name, provider_type, external_ref,
           name, category, denomination, price, currency, is_available
    FROM price_packages
    WHERE tenant_id = ? AND tab = ?
  `).all(tenantId, tab);

  // تجميع كل المزوّدين معاً بمفتاح المطابقة. فئة/اسم الصفّ من znet (المرجع).
  // رقم الربط الذي تُطابَق به صفحة زينت:
  //   - الكونتور: küpür (ثابت عبر المواقع) من أي znet.
  //   - الألعاب: رقم منتج **المزوّد الافتراضي** (= صفّ admin_allPinList).
  const groups = new Map();
  for (const r of rows) {
    const k = groupKey(r);
    if (!groups.has(k)) {
      groups.set(k, { link_ref: '', display_name: norm(r.name), category: norm(r.category), candidates: new Map() });
    }
    const g = groups.get(k);
    if (r.provider_type === 'znet') {
      g.display_name = norm(r.name);
      g.category = norm(r.category);
    }
    if (isGames) {
      if (r.source_item_id === defaultItemId) g.link_ref = normalizeRef(r.external_ref);
    } else if (r.provider_type === 'znet') {
      g.link_ref = normalizeRef(r.external_ref) || g.link_ref;
    } else if (!g.link_ref) {
      g.link_ref = normalizeRef(r.external_ref);
    }
    const cur = g.candidates.get(r.source_item_id);
    if (cur == null || (r.price != null && r.price < cur.price)) {
      g.candidates.set(r.source_item_id, {
        source_item_id: r.source_item_id,
        name: norm(r.source_name),
        price: r.price,
        available: !!r.is_available,
      });
    }
  }

  // الروابط اليدوية: أضِف سعر المصدر المربوط إلى المجموعة برقم ربط znet.
  const pkgByRef = new Map();
  for (const r of rows) pkgByRef.set(`${r.source_item_id}|${r.external_ref}`, r);
  const links = db.prepare(
    'SELECT match_key, source_item_id, external_ref FROM price_links WHERE tenant_id = ? AND tab = ?'
  ).all(tenantId, tab);
  for (const lk of links) {
    const g = groups.get(lk.match_key);
    if (!g) continue;
    const pkg = pkgByRef.get(`${lk.source_item_id}|${lk.external_ref}`);
    if (!pkg) continue;
    g.candidates.set(lk.source_item_id, {
      source_item_id: lk.source_item_id,
      name: norm(pkg.source_name),
      price: pkg.price,
      available: !!pkg.is_available,
    });
  }

  const plans = [];
  for (const g of groups.values()) {
    if (!g.link_ref) continue;                                   // بلا رقم ربط لا مطابقة
    if (wantCat && norm(g.category).toLowerCase() !== wantCat) continue;  // فلتر النوع (فئة znet)
    const ranked = [...g.candidates.values()]
      .filter((c) => c.source_item_id !== defaultItemId
        && (!includeSet || includeSet.has(c.source_item_id))   // الأعمدة المُضافة فقط
        && c.available && c.price != null && c.price > 0)
      .sort((a, b) => {
        if (a.price !== b.price) return a.price - b.price;
        // تعادل: الأولوية اليدوية أولاً (الأصغر)، ثم الأقدم إضافةً.
        const pa = prio(a.source_item_id), pb = prio(b.source_item_id);
        if (pa !== pb) return pa - pb;
        return (orderOf.get(a.source_item_id) ?? 1e9) - (orderOf.get(b.source_item_id) ?? 1e9);
      });

    const top = ranked.slice(0, topN);
    // خانات الـ API: املأ المتاح ثم Kapat للباقي حتى topN.
    const slots = [];
    for (let i = 0; i < topN; i++) {
      slots.push(top[i] ? { name: top[i].name, price: top[i].price } : { name: 'Kapat', price: null });
    }

    plans.push({
      link_ref: g.link_ref,
      display_name: g.display_name,
      category: g.category,
      slots,                              // [{name, price}] بطول topN — الترتيب = API1..N
      candidate_count: ranked.length,
    });
  }

  // فرز ثابت: حسب رقم الربط رقمياً.
  plans.sort((a, b) => (parseInt(a.link_ref, 10) || 0) - (parseInt(b.link_ref, 10) || 0));
  return plans;
}
