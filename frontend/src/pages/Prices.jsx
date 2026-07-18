import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Tags, Search, Server, AlertCircle, Link2, X } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

const TABS = [
  { key: 'games', label: 'ألعاب', enabled: true },
  { key: 'turkcell', label: 'تركسيل', enabled: false },
  { key: 'vodafone', label: 'فودافون', enabled: false },
  { key: 'avea', label: 'افيا', enabled: false },
];

export default function Prices() {
  const [tab, setTab] = useState('games');
  const [sources, setSources] = useState([]);
  const [groups, setGroups] = useState([]);
  const [compareSources, setCompareSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');

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
    if (!needle) return groups;
    return groups.filter((g) =>
      (g.display_name || '').toLowerCase().includes(needle) ||
      (g.category || '').toLowerCase().includes(needle) ||
      (g.denomination || '').toLowerCase().includes(needle)
    );
  }, [groups, q]);

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

  const doLink = async (externalRef) => {
    if (!linkModal) return;
    try {
      await api.post('/prices/link', {
        tab,
        match_key: linkModal.group.match_key,
        source_item_id: linkModal.source.item_id,
        external_ref: externalRef,
      });
      setLinkModal(null);
      toast.success('تم الربط');
      await load(tab);
    } catch (err) {
      toast.error(err.response?.data?.error || 'خطأ في الربط');
    }
  };

  const doUnlink = async (group, source) => {
    try {
      await api.delete('/prices/link', { data: { tab, match_key: group.match_key, source_item_id: source.item_id } });
      toast.success('تم إلغاء الربط');
      await load(tab);
    } catch (err) {
      toast.error(err.response?.data?.error || 'خطأ في إلغاء الربط');
    }
  };

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
        {sources.length === 0 ? (
          <div className="flex items-start gap-2 text-amber-700 bg-amber-50 rounded-lg p-3 text-sm">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span>لا توجد مصادر مدعومة. أضف مزوّد <b>znet</b> أو <b>barakat</b> من إعدادات API ليظهر هنا.</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sources.map((s) => (
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
      <div className="relative mb-4">
        <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="بحث عن باقة..."
          className="w-full border border-gray-300 rounded-lg pr-10 pl-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
        />
      </div>

      {/* Comparison table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="animate-spin-slow text-emerald-600" size={40} />
        </div>
      ) : compareSources.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center text-gray-500">
          لا توجد بيانات بعد. اضغط <b>«تحديث الأسعار»</b> لجلب الباقات من المصادر.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-lg overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="bg-emerald-600 text-white">
                <th className="py-3 px-3 text-right sticky right-0 bg-emerald-600">الباقة</th>
                {compareSources.map((s) => (
                  <th key={s.item_id} className="py-3 px-3 text-center whitespace-nowrap">{s.name}</th>
                ))}
                <th className="py-3 px-3 text-center whitespace-nowrap">الأرخص</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((g) => (
                <tr key={g.match_key} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium text-gray-800 sticky right-0 bg-white">
                    <div className="truncate max-w-[220px]" title={g.display_name}>{g.display_name}</div>
                    {g.category && <div className="text-xs text-gray-400">{g.category}</div>}
                  </td>
                  {compareSources.map((s) => {
                    const cell = g.prices[s.item_id];
                    const isCheapest = cell && g.cheapest_price != null && cell.available && cell.price === g.cheapest_price;
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
                    {g.cheapest_price != null ? `₺${fmt(g.cheapest_price)}` : '—'}
                  </td>
                </tr>
              ))}
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
    </div>
  );
}

function LinkModal({ group, source, packages, loading, search, setSearch, onPick, onClose, fmt }) {
  const needle = search.trim().toLowerCase();
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
                    onClick={() => onPick(p.external_ref)}
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
