import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Tags, Search, Server, AlertCircle, Link2, X, ArrowUp, Filter, ChevronDown, Check, EyeOff, RotateCcw, Plus, Star } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

const TABS = [
  { key: 'games', label: 'ألعاب', enabled: true },
  { key: 'turkcell', label: 'تركسيل', enabled: true },
  { key: 'vodafone', label: 'فودافون', enabled: false },
  { key: 'avea', label: 'افيا', enabled: false },
];

// تبويبات الكونتور (الموبايل) — واجهتها مختلفة عن الألعاب: مرتكزة على مزوّد افتراضي.
const KONTOR_TABS = new Set(['turkcell', 'vodafone', 'avea']);

export default function Prices() {
  const [tab, setTab] = useState('games');
  const [sources, setSources] = useState([]);
  const [groups, setGroups] = useState([]);
  const [compareSources, setCompareSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showTop, setShowTop] = useState(false);
  const [hiddenSources, setHiddenSources] = useState(() => new Set()); // مصادر مُزالة من المقارنة
  const scrollRef = useRef(null);

  // تبويبات الكونتور: المزوّد الافتراضي + الأعمدة الإضافية المفتوحة
  const isKontor = KONTOR_TABS.has(tab);
  const [defaultSrc, setDefaultSrc] = useState(null);
  const [expandedSrc, setExpandedSrc] = useState(() => new Set());

  // المطابقة اليدوية
  const [linkModal, setLinkModal] = useState(null); // { group, source }
  const [pkgCache, setPkgCache] = useState({});      // { [item_id]: [pkgs] }
  const [pkgLoading, setPkgLoading] = useState(false);
  const [pkgSearch, setPkgSearch] = useState('');

  const load = useCallback(async (activeTab) => {
    setLoading(true);
    try {
      const [srcRes, cmpRes] = await Promise.all([
        api.get('/prices/sources'),
        api.get('/prices/compare', { params: { tab: activeTab } }),
      ]);
      setSources(srcRes.data || []);
      setGroups(cmpRes.data?.groups || []);
      setCompareSources(cmpRes.data?.sources || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'خطأ في تحميل الأسعار');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [load, tab]);
  // عند تبديل التبويب تختلف المصادر — نعيد إظهار كل شيء ونصفّر اختيار الكونتور.
  useEffect(() => { setHiddenSources(new Set()); setDefaultSrc(null); setExpandedSrc(new Set()); }, [tab]);

  // مصادر الكونتور = مزوّدو znet فقط (بركات/مراد تميز لا يبيعون كونتور).
  const kontorSources = useMemo(
    () => compareSources.filter((s) => s.provider_type === 'znet'),
    [compareSources],
  );
  // بطاقات "مصادر الأسعار": في تبويبات الكونتور نعرض مزوّدي znet فقط.
  const summarySources = useMemo(
    () => (isKontor ? sources.filter((s) => s.provider_type === 'znet') : sources),
    [sources, isKontor],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.post('/prices/refresh', { tab });
      const results = res.data?.results || [];
      const ok = results.filter((r) => r.success);
      const fail = results.filter((r) => !r.success);
      if (ok.length) toast.success(`تم تحديث ${ok.length} مصدر (${ok.reduce((s, r) => s + (r.count || 0), 0)} باقة)`);
      for (const f of fail) toast.error(`فشل ${f.name}: ${f.error || 'خطأ'}`, { autoClose: 8000 });
      if (!ok.length && !fail.length) toast.info('لا توجد مصادر مدعومة (znet / barakat) لجلب الأسعار.');
      await load(tab);
    } catch (err) {
      toast.error(err.response?.data?.error || 'خطأ في تحديث الأسعار');
    } finally {
      setRefreshing(false);
    }
  };

  const filteredGroups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups.filter((g) => {
      if (catFilter && g.category !== catFilter) return false;
      if (!needle) return true;
      return (
        (g.display_name || '').toLowerCase().includes(needle) ||
        (g.category || '').toLowerCase().includes(needle) ||
        (g.denomination || '').toLowerCase().includes(needle)
      );
    });
  }, [groups, q, catFilter]);

  const categories = useMemo(() => {
    const set = new Set();
    for (const g of groups) if (g.category) set.add(g.category);
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [groups]);

  // المصادر المعروضة/المخفاة في المقارنة
  const visibleSources = useMemo(
    () => compareSources.filter((s) => !hiddenSources.has(s.item_id)),
    [compareSources, hiddenSources],
  );
  const hiddenList = useMemo(
    () => compareSources.filter((s) => hiddenSources.has(s.item_id)),
    [compareSources, hiddenSources],
  );
  // أرخص سعر محسوب على المصادر المعروضة فقط (يتجاهل المصادر المُزالة).
  const cheapestVisible = useCallback((g) => {
    let min = null;
    for (const s of visibleSources) {
      const c = g.prices[s.item_id];
      if (c && c.available && c.price > 0) min = min == null ? c.price : Math.min(min, c.price);
    }
    return min;
  }, [visibleSources]);
  const hideSource = (id) => setHiddenSources((prev) => { const n = new Set(prev); n.add(id); return n; });
  const restoreSource = (id) => setHiddenSources((prev) => { const n = new Set(prev); n.delete(id); return n; });
  const restoreAll = () => setHiddenSources(new Set());

  const recomputeCheapest = (prices) => {
    const vals = Object.values(prices).filter((v) => v.available && v.price > 0).map((v) => v.price);
    return vals.length ? Math.min(...vals) : null;
  };

  const openLink = async (group, source) => {
    setLinkModal({ group, source });
    setPkgSearch('');
    if (pkgCache[source.item_id]) return;
    setPkgLoading(true);
    try {
      const res = await api.get('/prices/packages', { params: { tab, item_id: source.item_id } });
      setPkgCache((prev) => ({ ...prev, [source.item_id]: res.data || [] }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'خطأ في جلب باقات المصدر');
    } finally {
      setPkgLoading(false);
    }
  };

  // ربط: تحديث الحقل محلياً فقط (بلا إعادة تحميل كامل) للحفاظ على الترتيب والموضع.
  const doLink = async (pkg) => {
    if (!linkModal) return;
    const { group, source } = linkModal;
    try {
      await api.post('/prices/link', {
        tab,
        match_key: group.match_key,
        source_item_id: source.item_id,
        external_ref: pkg.external_ref,
      });
      setGroups((prev) => prev.map((g) => {
        if (g.match_key !== group.match_key) return g;
        const prices = {
          ...g.prices,
          [source.item_id]: {
            price: pkg.price,
            currency: pkg.currency,
            name: pkg.name,
            available: !!pkg.is_available,
            manual: true,
          },
        };
        return { ...g, prices, cheapest_price: recomputeCheapest(prices), source_count: Object.keys(prices).length };
      }));
      setLinkModal(null);
      toast.success('تم الربط');
    } catch (err) {
      toast.error(err.response?.data?.error || 'خطأ في الربط');
    }
  };

  const doUnlink = async (group, source) => {
    try {
      await api.delete('/prices/link', { data: { tab, match_key: group.match_key, source_item_id: source.item_id } });
      setGroups((prev) => prev.map((g) => {
        if (g.match_key !== group.match_key) return g;
        const prices = { ...g.prices };
        delete prices[source.item_id];
        return { ...g, prices, cheapest_price: recomputeCheapest(prices), source_count: Object.keys(prices).length };
      }));
      toast.success('تم إلغاء الربط');
    } catch (err) {
      toast.error(err.response?.data?.error || 'خطأ في إلغاء الربط');
    }
  };

  const onScroll = (e) => setShowTop(e.target.scrollTop > 300);
  const scrollTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <Tags size={26} className="text-emerald-600" /> أسعار الباقات
          </h2>
          <p className="text-gray-500 mt-1 text-sm md:text-base">مقارنة أسعار المزوّدين لمعرفة الأرخص</p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 font-bold"
        >
          <RefreshCw size={18} className={refreshing ? 'animate-spin-slow' : ''} />
          تحديث الأسعار
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => t.enabled && setTab(t.key)}
            disabled={!t.enabled}
            className={`px-4 py-2 text-sm md:text-base font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-emerald-600 text-emerald-700'
                : t.enabled
                  ? 'border-transparent text-gray-500 hover:text-gray-700'
                  : 'border-transparent text-gray-300 cursor-not-allowed'
            }`}
          >
            {t.label}{!t.enabled && ' (قريباً)'}
          </button>
        ))}
      </div>

      {/* Sources summary */}
      <div className="bg-white rounded-xl shadow p-4 mb-5">
        <div className="flex items-center gap-2 text-gray-700 font-bold mb-3">
          <Server size={18} className="text-emerald-600" /> مصادر الأسعار
        </div>
        {summarySources.length === 0 ? (
          <div className="flex items-start gap-2 text-amber-700 bg-amber-50 rounded-lg p-3 text-sm">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span>
              {isKontor
                ? <>لا يوجد مزوّد <b>znet</b> معدّ. أضِف مزوّداً من نوع <b>znet</b> في إعدادات API ليظهر هنا (الكونتور من znet فقط).</>
                : <>لا توجد مصادر مدعومة. أضف مزوّد <b>znet</b> أو <b>barakat</b> من إعدادات API ليظهر هنا.</>}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {summarySources.map((s) => (
              <div key={s.item_id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <span className="font-semibold text-gray-800">{s.name}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{s.provider_type}</span>
                <span className="text-gray-400 text-xs">
                  {s.package_count ? `${s.package_count} باقة` : 'لم تُجلب بعد'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث عن باقة..."
            className="w-full border border-gray-300 rounded-lg pr-10 pl-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
          />
        </div>
        <CategorySelect value={catFilter} options={categories} onChange={setCatFilter} />
      </div>

      {/* شريط إعادة إظهار المصادر المُزالة (تبويب الألعاب فقط) */}
      {!isKontor && hiddenList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <span className="text-sm text-amber-800 font-semibold flex items-center gap-1">
            <EyeOff size={15} /> مصادر مُزالة من المقارنة:
          </span>
          {hiddenList.map((s) => (
            <button
              key={s.item_id}
              onClick={() => restoreSource(s.item_id)}
              className="inline-flex items-center gap-1 text-xs bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 rounded-lg px-2 py-1"
              title="إعادة إظهار هذا المصدر في المقارنة"
            >
              <RotateCcw size={12} /> {s.name}
            </button>
          ))}
          <button
            onClick={restoreAll}
            className="text-xs text-amber-700 hover:text-amber-900 underline mr-auto"
          >
            إعادة الكل
          </button>
        </div>
      )}

      {/* Comparison table */}
      {isKontor ? (
        <KontorCompare
          sources={kontorSources}
          groups={groups}
          q={q}
          catFilter={catFilter}
          loading={loading}
          defaultId={defaultSrc}
          setDefaultId={setDefaultSrc}
          expanded={expandedSrc}
          setExpanded={setExpandedSrc}
          fmt={fmt}
        />
      ) : loading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="animate-spin-slow text-emerald-600" size={40} />
        </div>
      ) : compareSources.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center text-gray-500">
          لا توجد بيانات بعد. اضغط <b>«تحديث الأسعار»</b> لجلب الباقات من المصادر.
        </div>
      ) : (
        <div ref={scrollRef} onScroll={onScroll} className="relative bg-white rounded-xl shadow-lg overflow-auto max-h-[70vh]">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="bg-emerald-600 text-white">
                <th className="py-3 px-3 text-right sticky right-0 z-30 bg-emerald-600">الباقة</th>
                {visibleSources.map((s) => (
                  <th key={s.item_id} className="py-3 px-3 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <span>{s.name}</span>
                      <button
                        onClick={() => hideSource(s.item_id)}
                        className="text-white/70 hover:text-white hover:bg-white/20 rounded p-0.5"
                        title="إزالة هذا المصدر من المقارنة"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </th>
                ))}
                <th className="py-3 px-3 text-center whitespace-nowrap">الأرخص</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((g) => {
                const cheapest = cheapestVisible(g);
                return (
                <tr key={g.match_key} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium text-gray-800 sticky right-0 z-10 bg-white">
                    <div className="truncate max-w-[220px]" title={g.display_name}>
                      {g.display_name}
                      {g.external_ref != null && g.external_ref !== '' && (
                        <span className="text-gray-400 font-normal"> ({g.external_ref})</span>
                      )}
                    </div>
                    {g.category && <div className="text-xs text-gray-400">{g.category}</div>}
                  </td>
                  {visibleSources.map((s) => {
                    const cell = g.prices[s.item_id];
                    const isCheapest = cell && cheapest != null && cell.available && cell.price === cheapest;
                    if (!cell) {
                      return (
                        <td key={s.item_id} className="py-2 px-3 text-center">
                          <button
                            onClick={() => openLink(g, s)}
                            className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded px-1.5 py-1 border border-indigo-200"
                            title="ربط باقة من هذا المصدر يدوياً"
                          >
                            <Link2 size={13} /> ربط
                          </button>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={s.item_id}
                        className={`py-2 px-3 text-center ${isCheapest ? 'bg-emerald-100 text-emerald-800 font-bold rounded' : 'text-gray-700'} ${cell.manual ? 'ring-1 ring-inset ring-indigo-200' : ''}`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span title={cell.name}>{cell.available ? fmt(cell.price) : '—'}</span>
                          {cell.manual && (
                            <button
                              onClick={() => doUnlink(g, s)}
                              className="text-indigo-400 hover:text-red-500"
                              title="إلغاء الربط اليدوي"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="py-2 px-3 text-center font-bold text-emerald-700">
                    {cheapest != null ? `₺${fmt(cheapest)}` : '—'}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {filteredGroups.length === 0 && (
            <div className="p-6 text-center text-gray-400">لا نتائج مطابقة للبحث.</div>
          )}
        </div>
      )}

      {/* Manual link modal */}
      {linkModal && (
        <LinkModal
          group={linkModal.group}
          source={linkModal.source}
          packages={pkgCache[linkModal.source.item_id] || []}
          loading={pkgLoading}
          search={pkgSearch}
          setSearch={setPkgSearch}
          onPick={doLink}
          onClose={() => setLinkModal(null)}
          fmt={fmt}
        />
      )}

      {/* Scroll to top */}
      {showTop && (
        <button
          onClick={scrollTop}
          className="fixed bottom-6 left-6 z-40 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full p-3 shadow-lg transition-colors"
          title="صعود للأعلى"
        >
          <ArrowUp size={20} />
        </button>
      )}
    </div>
  );
}

// منسدلة فلتر المنتج مع حقل بحث
function CategorySelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const needle = search.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options;
  const pick = (v) => { onChange(v); setOpen(false); setSearch(''); };

  return (
    <div ref={ref} className="relative sm:w-64">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
      >
        <Filter size={16} className="text-gray-400 shrink-0" />
        <span className={`flex-1 truncate text-right ${value ? 'text-gray-800' : 'text-gray-500'}`}>{value || 'كل المنتجات'}</span>
        <ChevronDown size={16} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 flex flex-col">
          <div className="p-2 border-b">
            <div className="relative">
              <Search size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث عن منتج..."
                className="w-full border border-gray-300 rounded pr-8 pl-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
            </div>
          </div>
          <ul className="overflow-y-auto">
            <li>
              <button
                type="button"
                onClick={() => pick('')}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm text-right hover:bg-emerald-50 ${!value ? 'text-emerald-700 font-bold' : 'text-gray-700'}`}
              >
                كل المنتجات {!value && <Check size={15} />}
              </button>
            </li>
            {filtered.map((o) => (
              <li key={o}>
                <button
                  type="button"
                  onClick={() => pick(o)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-right hover:bg-emerald-50 ${value === o ? 'text-emerald-700 font-bold' : 'text-gray-700'}`}
                >
                  <span className="truncate">{o}</span>{value === o && <Check size={15} className="shrink-0" />}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-center text-gray-400 text-sm">لا نتائج</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function LinkModal({ group, source, packages, loading, search, setSearch, onPick, onClose, fmt }) {  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? packages.filter((p) => (p.name || '').toLowerCase().includes(needle))
    : packages;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-bold text-gray-800">ربط باقة من: {source.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[380px]">إلى الصف: {group.display_name}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={22} /></button>
        </div>
        <div className="p-3 border-b">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في باقات المصدر..."
              className="w-full border border-gray-300 rounded-lg pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <RefreshCw className="animate-spin-slow text-indigo-500" size={32} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">لا باقات مطابقة.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.slice(0, 300).map((p) => (
                <li key={p.external_ref}>
                  <button
                    onClick={() => onPick(p)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-indigo-50 text-right"
                  >
                    <span className="text-sm text-gray-800 truncate">{p.name || '(بلا اسم)'}</span>
                    <span className="text-sm font-bold text-emerald-700 whitespace-nowrap">₺{fmt(p.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="p-3 border-t text-xs text-gray-400 text-center">
          {filtered.length > 300 ? 'يُعرض أوّل 300 نتيجة — استخدم البحث للتضييق.' : `${filtered.length} باقة`}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// عرض الكونتور (تركسيل/فودافون/افيا): مرتكز على مزوّد افتراضي يختاره المستخدم.
// - عمود الباقة (اسم + رقم الربط) + عمود سعر الافتراضي ← بإطار ملوّن.
// - بقية المزوّدين يُضافون كأعمدة عند الضغط على "+".
// ════════════════════════════════════════════════════════════════════════════
function KontorCompare({ sources, groups, q, catFilter, loading, defaultId, setDefaultId, expanded, setExpanded, fmt }) {
  const others = useMemo(() => sources.filter((s) => s.item_id !== defaultId), [sources, defaultId]);
  const shownOthers = useMemo(() => others.filter((s) => expanded.has(s.item_id)), [others, expanded]);
  const collapsedOthers = useMemo(() => others.filter((s) => !expanded.has(s.item_id)), [others, expanded]);
  const defaultName = sources.find((s) => s.item_id === defaultId)?.name;

  // الصفوف = باقات المزوّد الافتراضي (مع فلتر البحث/النوع).
  const rows = useMemo(() => {
    if (!defaultId) return [];
    const needle = q.trim().toLowerCase();
    return groups.filter((g) => {
      if (!g.prices[defaultId]) return false;
      if (catFilter && g.category !== catFilter) return false;
      if (!needle) return true;
      return (
        (g.display_name || '').toLowerCase().includes(needle) ||
        String(g.external_ref || '').toLowerCase().includes(needle) ||
        (g.category || '').toLowerCase().includes(needle)
      );
    });
  }, [groups, defaultId, q, catFilter]);

  const addCol = (id) => setExpanded((prev) => { const n = new Set(prev); n.add(id); return n; });
  const removeCol = (id) => setExpanded((prev) => { const n = new Set(prev); n.delete(id); return n; });

  // أرخص سعر في الصف بين (الافتراضي + الأعمدة المفتوحة) — لتمييزه.
  const cheapestOf = (g) => {
    let min = null;
    for (const id of [defaultId, ...shownOthers.map((s) => s.item_id)]) {
      const c = g.prices[id];
      if (c && c.available && c.price > 0) min = min == null ? c.price : Math.min(min, c.price);
    }
    return min;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin-slow text-emerald-600" size={40} />
      </div>
    );
  }
  if (sources.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center text-gray-500">
        لا توجد بيانات بعد. اضغط <b>«تحديث الأسعار»</b> لجلب باقات المزوّدين (znet).
      </div>
    );
  }

  return (
    <>
      {/* اختيار المزوّد الافتراضي + أزرار إضافة الأعمدة */}
      <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 text-gray-700 font-bold shrink-0">
          <Star size={18} className="text-amber-500" /> المزوّد الافتراضي
        </div>
        <select
          value={defaultId || ''}
          onChange={(e) => { setDefaultId(e.target.value ? Number(e.target.value) : null); setExpanded(new Set()); }}
          className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 sm:w-64"
        >
          <option value="">— اختر مزوّداً ليكون الأساس —</option>
          {sources.map((s) => <option key={s.item_id} value={s.item_id}>{s.name}</option>)}
        </select>
        {defaultId && collapsedOthers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
            <span className="text-xs text-gray-500">أضف مزوّداً للمقارنة:</span>
            {collapsedOthers.map((s) => (
              <button
                key={s.item_id}
                onClick={() => addCol(s.item_id)}
                className="inline-flex items-center gap-1 text-xs bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-lg px-2 py-1"
              >
                <Plus size={13} /> {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {!defaultId ? (
        <div className="bg-white rounded-xl shadow p-8 text-center text-gray-500">
          اختر <b>المزوّد الافتراضي</b> من القائمة أعلاه لعرض باقاته والمقارنة.
        </div>
      ) : (
        <div className="relative bg-white rounded-xl shadow-lg overflow-auto max-h-[70vh]">
          <table className="w-full min-w-[500px] text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="bg-emerald-600 text-white">
                <th className="py-3 px-3 text-right sticky right-0 z-30 bg-emerald-700 border-l-4 border-amber-400">
                  الباقة <span className="text-emerald-200 font-normal text-xs">(رقم الربط)</span>
                </th>
                <th className="py-3 px-3 text-center whitespace-nowrap bg-emerald-700 border-l-4 border-amber-400">
                  {defaultName} <span className="text-amber-300 text-xs">★ الافتراضي</span>
                </th>
                {shownOthers.map((s) => (
                  <th key={s.item_id} className="py-3 px-3 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <span>{s.name}</span>
                      <button
                        onClick={() => removeCol(s.item_id)}
                        className="text-white/70 hover:text-white hover:bg-white/20 rounded p-0.5"
                        title="إخفاء هذا العمود"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const cheapest = cheapestOf(g);
                const def = g.prices[defaultId];
                const defCheapest = def && cheapest != null && def.available && def.price === cheapest;
                return (
                  <tr key={g.match_key} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-800 sticky right-0 z-10 bg-white border-l-4 border-amber-300">
                      <div className="truncate max-w-[240px]" title={g.display_name}>{g.display_name}</div>
                      <div className="text-xs text-gray-400">
                        {g.external_ref ? `رقم الربط: ${g.external_ref}` : ''}
                        {g.category ? `${g.external_ref ? ' · ' : ''}${g.category}` : ''}
                      </div>
                    </td>
                    <td className={`py-2 px-3 text-center border-l-4 border-amber-300 ${defCheapest ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-amber-50 text-gray-800 font-semibold'}`}>
                      {def && def.available ? fmt(def.price) : '—'}
                    </td>
                    {shownOthers.map((s) => {
                      const cell = g.prices[s.item_id];
                      const isCheapest = cell && cheapest != null && cell.available && cell.price === cheapest;
                      return (
                        <td key={s.item_id} className={`py-2 px-3 text-center ${isCheapest ? 'bg-emerald-100 text-emerald-800 font-bold rounded' : 'text-gray-700'}`}>
                          {cell && cell.available ? fmt(cell.price) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-6 text-center text-gray-400">لا باقات لهذا المزوّد (أو لا نتائج للبحث).</div>
          )}
        </div>
      )}
    </>
  );
}
