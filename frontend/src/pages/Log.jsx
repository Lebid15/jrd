import { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

const PAGE = 100;

const FIELD_LABEL = {
  try_amount: '₺ ليرة',
  usd_amount: '$ دولار',
};

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// created_at مخزّن UTC بصيغة "YYYY-MM-DD HH:MM:SS" → نعرضه بالتوقيت المحلي.
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleString('ar', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function Log() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async (offset = 0, append = false) => {
    setLoading(true);
    try {
      const params = { limit: PAGE, offset };
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await api.get('/log', { params });
      const data = res.data || {};
      setTotal(data.total || 0);
      setLogs((prev) => (append ? [...prev, ...(data.logs || [])] : (data.logs || [])));
    } catch {
      toast.error('خطأ في تحميل السجل');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(0, false); }, [load]);

  const clearAll = async () => {
    if (!confirm('هل تريد تفريغ السجل بالكامل؟ لا يمكن التراجع.')) return;
    try {
      await api.delete('/log');
      setLogs([]);
      setTotal(0);
      toast.success('تم تفريغ السجل');
    } catch {
      toast.error('خطأ في تفريغ السجل');
    }
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <History size={26} className="text-emerald-600" />
            السجل
          </h2>
          <p className="text-gray-500 mt-1 text-sm md:text-base">
            سجل تغييرات البنود اليدوية (القيمة السابقة، الجديدة، والفرق) — لا يشمل البنود التلقائية.
          </p>
        </div>
        <button
          onClick={clearAll}
          className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors text-sm"
        >
          <Trash2 size={16} />
          تفريغ السجل
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">من تاريخ</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">إلى تاريخ</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
        <button
          onClick={() => load(0, false)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-colors text-sm"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin-slow' : ''} />
          تحديث
        </button>
        {(from || to) && (
          <button
            onClick={() => { setFrom(''); setTo(''); }}
            className="text-gray-500 hover:text-gray-700 px-2 py-2 text-sm"
          >
            مسح الفلتر
          </button>
        )}
        <div className="ms-auto text-sm text-gray-500 self-center">
          الإجمالي: <span className="font-bold text-gray-700">{total}</span> تغيير
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-lg overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="bg-gray-700 text-white">
              <th className="py-3 px-3 text-right w-8">#</th>
              <th className="py-3 px-3 text-right">البند</th>
              <th className="py-3 px-3 text-center w-24">الحقل</th>
              <th className="py-3 px-3 text-center">القيمة السابقة</th>
              <th className="py-3 px-3 text-center">القيمة الجديدة</th>
              <th className="py-3 px-3 text-center">التغيير</th>
              <th className="py-3 px-3 text-center">التاريخ والوقت</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-10">لا توجد تغييرات مسجّلة بعد</td>
              </tr>
            )}
            {logs.map((row, index) => {
              const up = row.delta > 0;
              return (
                <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-2 px-3 text-gray-400 text-xs">{index + 1}</td>
                  <td className="py-2 px-3 font-medium text-sm md:text-base">{row.item_name}</td>
                  <td className="py-2 px-3 text-center text-sm text-gray-600">{FIELD_LABEL[row.field] || row.field}</td>
                  <td className="py-2 px-3 text-center text-gray-500 text-sm">{fmt(row.old_value)}</td>
                  <td className="py-2 px-3 text-center text-gray-800 font-semibold text-sm">{fmt(row.new_value)}</td>
                  <td className={`py-2 px-3 text-center font-bold text-sm ${up ? 'text-emerald-600' : 'text-red-600'}`}>
                    <span className="inline-flex items-center gap-0.5 justify-center">
                      {up ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                      {up ? '+' : ''}{fmt(row.delta)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center text-gray-500 text-xs whitespace-nowrap" dir="ltr">{fmtDate(row.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {logs.length < total && (
          <div className="p-4 text-center border-t">
            <button
              onClick={() => load(logs.length, true)}
              disabled={loading}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-2 rounded-lg transition-colors text-sm disabled:opacity-50"
            >
              {loading ? 'جارٍ التحميل…' : `تحميل المزيد (${total - logs.length} متبقٍّ)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
