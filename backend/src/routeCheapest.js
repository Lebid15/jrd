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

export function computeRoutingPlan(db, tenantId, tab, category, { defaultItemId = null, topN = 3 } = {}) {
  if (!KONTOR_OPERATORS[tab]) {
    throw new Error('bad_tab: التوجيه متاح لتبويبات الكونتور فقط');
  }
  const wantCat = norm(category).toLowerCase();

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

  // تجميع حسب (النوع + رقم الربط) — نفس منطق /compare للكونتور.
  const keyOf = (r) => {
    const ref = normalizeRef(r.external_ref);
    return ref ? makeMatchKey({ name: `${r.category || ''} ${ref}` }) : makeMatchKey({ name: r.name });
  };

  const groups = new Map();
  for (const r of rows) {
    if (wantCat && norm(r.category).toLowerCase() !== wantCat) continue;
    const k = keyOf(r);
    if (!groups.has(k)) {
      groups.set(k, {
        link_ref: normalizeRef(r.external_ref),
        display_name: norm(r.name),
        category: norm(r.category),
        candidates: new Map(),   // source_item_id → {name, price, available}
      });
    }
    const g = groups.get(k);
    if (!g.link_ref) g.link_ref = normalizeRef(r.external_ref);
    // احتفظ بأقل سعر لكل مصدر (لو تكرّر)
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

  const plans = [];
  for (const g of groups.values()) {
    if (!g.link_ref) continue;   // لا يمكن مطابقتها في زينت بلا رقم ربط
    const ranked = [...g.candidates.values()]
      .filter((c) => c.source_item_id !== defaultItemId && c.available && c.price != null && c.price > 0)
      .sort((a, b) => {
        if (a.price !== b.price) return a.price - b.price;
        // تعادل: الأقدم إضافةً أولاً
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
