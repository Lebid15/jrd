import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Save, Trash2, GripVertical, Wifi, Bot, Landmark } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

const SCRAPER_PROVIDERS = new Set(['bayi_alayatl']);
const isScraper = (providerType) => SCRAPER_PROVIDERS.has(providerType);

export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(44.75);
  const [lastInventory, setLastInventory] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [itemsRes, settingsRes, lastInvRes] = await Promise.all([
        api.get('/items'),
        api.get('/settings'),
        api.get('/inventory/last/one'),
      ]);
      setItems(itemsRes.data);
      setExchangeRate(parseFloat(settingsRes.data.exchange_rate || '44.75'));
      setLastInventory(lastInvRes.data);
    } catch (err) {
      toast.error('خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const addItem = async () => {
    if (!newItemName.trim()) return;
    try {
      await api.post('/items', { name: newItemName.trim() });
      setNewItemName('');
      loadData();
      toast.success('تمت الإضافة');
    } catch { toast.error('خطأ في الإضافة'); }
  };

  const updateValue = async (itemId, field, value) => {
    try {
      await api.put(`/items/${itemId}/values`, { [field]: parseFloat(value) || 0 });
    } catch { toast.error('خطأ في التحديث'); }
  };

  const updateNotes = async (itemId, notes) => {
    try {
      await api.put(`/items/${itemId}/values`, { notes });
    } catch { toast.error('خطأ في التحديث'); }
  };

  const deleteItem = async (id, name) => {
    if (!confirm(`هل تريد حذف "${name}"؟`)) return;
    try {
      await api.delete(`/items/${id}`);
      loadData();
      toast.success('تم الحذف');
    } catch { toast.error('خطأ في الحذف'); }
  };

  const fetchAllBalances = async () => {
    setFetching(true);
    try {
      const res = await api.post('/configs/fetch-all');
      const results = res.data;
      const success = results.filter(r => r.success).length;
      const failures = results.filter(r => !r.success);
      if (success > 0) toast.success(`تم جلب ${success} رصيد بنجاح`);
      for (const f of failures) {
        console.error('[fetch-all failure]', f);
        toast.error(`فشل ${f.name}: ${f.error || 'خطأ غير معروف'}`, { autoClose: 8000 });
      }
      loadData();
    } catch { toast.error('خطأ في جلب الأرصدة'); }
    finally { setFetching(false); }
  };

  const fetchSingleBalance = async (itemId) => {
    try {
      const res = await api.post(`/configs/${itemId}/fetch`);
      toast.success(`الرصيد: ${res.data.balance}`);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'خطأ في جلب الرصيد');
    }
  };

  const saveInventory = async () => {
    setSaving(true);
    try {
      const res = await api.post('/inventory', {
        date: new Date().toISOString().split('T')[0]
      });
      toast.success(`تم حفظ الجرد - الربح: $${res.data.profit.toFixed(2)}`);
      loadData();
    } catch { toast.error('خطأ في حفظ الجرد'); }
    finally { setSaving(false); }
  };

  // Calculate totals
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const totalTry = r2(items.reduce((sum, i) => sum + (i.try_amount || 0), 0));
  const totalUsd = r2(items.reduce((sum, i) => sum + (i.usd_amount || 0), 0));
  const tryToUsd = r2(exchangeRate > 0 ? totalTry / exchangeRate : 0);
  const grandTotal = r2(totalUsd + tryToUsd);
  const previousTotal = r2(lastInventory?.total_converted_usd || 0);
  const profit = r2(grandTotal - previousTotal);

  const handleLocalChange = (itemId, field, value) => {
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, [field]: field === 'notes' ? value : value === '' ? '' : parseFloat(value) || 0 } : item
    ));
  };

  const handleFocus = (e) => {
    if (e.target.value === '0') e.target.value = '';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="animate-spin-slow text-emerald-600" size={48} />
      </div>
    );
  }

  const providerItems = items.filter(i => i.type === 'provider' || i.type === 'bank');
  const manualItems = items.filter(i => i.type !== 'provider' && i.type !== 'bank');

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-800">الجرد اليومي</h2>
          <p className="text-gray-500 mt-1 text-sm md:text-base">{new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="flex gap-2 sm:gap-3 w-full sm:w-auto">
          <button
            onClick={fetchAllBalances}
            disabled={fetching}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 md:px-4 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm md:text-base"
          >
            <RefreshCw size={18} className={fetching ? 'animate-spin-slow' : ''} />
            <span className="hidden sm:inline">جلب الأرصدة</span>
            <span className="sm:hidden">جلب</span>
          </button>
          <button
            onClick={saveInventory}
            disabled={saving}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3 md:px-5 py-2 rounded-lg transition-colors disabled:opacity-50 font-bold text-sm md:text-base"
          >
            <Save size={18} />
            <span className="hidden sm:inline">حفظ الجرد</span>
            <span className="sm:hidden">حفظ</span>
          </button>
        </div>
      </div>

      {/* Provider Table (Automatic) */}
      {providerItems.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg overflow-x-auto mb-6">
          <div className="bg-emerald-700 text-white py-2 px-4 font-bold text-sm flex items-center gap-2">
            <Wifi size={16} />
            الجهات المربوطة (تلقائي)
          </div>
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="bg-emerald-600 text-white">
                <th className="py-2 md:py-3 px-2 md:px-4 text-right w-8">#</th>
                <th className="py-2 md:py-3 px-2 md:px-4 text-right">الاسم</th>
                <th className="py-2 md:py-3 px-2 md:px-4 text-center w-28 md:w-44">₺ ليرة</th>
                <th className="py-2 md:py-3 px-2 md:px-4 text-center w-28 md:w-44">$ دولار</th>
                <th className="py-2 md:py-3 px-2 md:px-4 text-center w-24 md:w-40 hidden sm:table-cell">ملاحظات</th>
                <th className="py-2 md:py-3 px-2 md:px-4 text-center w-16 md:w-24">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {providerItems.map((item, index) => (
                <tr
                  key={item.id}
                  className={`border-b border-gray-100 transition-colors bg-emerald-50/50 ${(item.try_amount || 0) < 0 || (item.usd_amount || 0) < 0 ? 'bg-red-50/50' : ''}`}
                >
                  <td className="py-2 px-2 md:px-4 text-gray-400 text-xs md:text-sm">{index + 1}</td>
                  <td className="py-2 px-2 md:px-4 font-medium text-sm md:text-base">
                    <div className="flex items-center gap-1 md:gap-2">
                      {item.type === 'bank'
                        ? <Landmark size={14} className="text-blue-600 shrink-0" />
                        : isScraper(item.api_provider_type || item.provider_type)
                          ? <Bot size={14} className="text-blue-600 shrink-0" />
                          : <Wifi size={14} className="text-emerald-600 shrink-0" />
                      }
                      <span className="truncate max-w-[80px] md:max-w-none">{item.name}</span>
                    </div>
                  </td>
                  <td className="py-2 px-1 md:px-4">
                    <input
                      type="number"
                      value={item.try_amount || ''}
                      onChange={(e) => handleLocalChange(item.id, 'try_amount', e.target.value)}
                      onFocus={handleFocus}
                      onBlur={(e) => updateValue(item.id, 'try_amount', e.target.value)}
                      className={`table-input text-sm md:text-base ${(item.try_amount || 0) < 0 ? 'text-red-600 font-bold' : 'text-gray-700'}`}
                      step="0.01"
                      placeholder="0"
                    />
                  </td>
                  <td className="py-2 px-1 md:px-4">
                    <input
                      type="number"
                      value={item.usd_amount || ''}
                      onChange={(e) => handleLocalChange(item.id, 'usd_amount', e.target.value)}
                      onFocus={handleFocus}
                      onBlur={(e) => updateValue(item.id, 'usd_amount', e.target.value)}
                      className={`table-input text-sm md:text-base ${(item.usd_amount || 0) < 0 ? 'text-red-600 font-bold' : 'text-gray-700'}`}
                      step="0.01"
                      placeholder="0"
                    />
                  </td>
                  <td className="py-2 px-1 md:px-4 hidden sm:table-cell">
                    <input
                      type="text"
                      value={item.notes || ''}
                      onChange={(e) => handleLocalChange(item.id, 'notes', e.target.value)}
                      onBlur={(e) => updateNotes(item.id, e.target.value)}
                      className="table-input text-sm text-gray-500"
                      placeholder="..."
                    />
                  </td>
                  <td className="py-2 px-1 md:px-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => fetchSingleBalance(item.id)}
                        className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
                        title="جلب الرصيد"
                      >
                        <RefreshCw size={15} />
                      </button>
                      <button
                        onClick={() => deleteItem(item.id, item.name)}
                        className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="حذف"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual Table */}
      <div className="bg-white rounded-xl shadow-lg overflow-x-auto">
        <div className="bg-gray-700 text-white py-2 px-4 font-bold text-sm flex items-center gap-2">
          ✏️ البنود اليدوية
        </div>
        <table className="w-full min-w-[500px]">
          <thead>
            <tr className="bg-gray-600 text-white">
              <th className="py-2 md:py-3 px-2 md:px-4 text-right w-8">#</th>
              <th className="py-2 md:py-3 px-2 md:px-4 text-right">الاسم</th>
              <th className="py-2 md:py-3 px-2 md:px-4 text-center w-28 md:w-44">₺ ليرة</th>
              <th className="py-2 md:py-3 px-2 md:px-4 text-center w-28 md:w-44">$ دولار</th>
              <th className="py-2 md:py-3 px-2 md:px-4 text-center w-24 md:w-40 hidden sm:table-cell">ملاحظات</th>
              <th className="py-2 md:py-3 px-2 md:px-4 text-center w-16 md:w-24">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {manualItems.map((item, index) => (
              <tr
                key={item.id}
                className={`border-b border-gray-100 transition-colors hover:bg-gray-50 ${(item.try_amount || 0) < 0 || (item.usd_amount || 0) < 0 ? 'bg-red-50/50' : ''}`}
              >
                <td className="py-2 px-2 md:px-4 text-gray-400 text-xs md:text-sm">{index + 1}</td>
                <td className="py-2 px-2 md:px-4 font-medium text-sm md:text-base">
                  <span className="truncate max-w-[80px] md:max-w-none">{item.name}</span>
                </td>
                <td className="py-2 px-1 md:px-4">
                  <input
                    type="number"
                    value={item.try_amount || ''}
                    onChange={(e) => handleLocalChange(item.id, 'try_amount', e.target.value)}
                    onFocus={handleFocus}
                    onBlur={(e) => updateValue(item.id, 'try_amount', e.target.value)}
                    className={`table-input text-sm md:text-base ${(item.try_amount || 0) < 0 ? 'text-red-600 font-bold' : 'text-gray-700'}`}
                    step="0.01"
                    placeholder="0"
                  />
                </td>
                <td className="py-2 px-1 md:px-4">
                  <input
                    type="number"
                    value={item.usd_amount || ''}
                    onChange={(e) => handleLocalChange(item.id, 'usd_amount', e.target.value)}
                    onFocus={handleFocus}
                    onBlur={(e) => updateValue(item.id, 'usd_amount', e.target.value)}
                    className={`table-input text-sm md:text-base ${(item.usd_amount || 0) < 0 ? 'text-red-600 font-bold' : 'text-gray-700'}`}
                    step="0.01"
                    placeholder="0"
                  />
                </td>
                <td className="py-2 px-1 md:px-4 hidden sm:table-cell">
                  <input
                    type="text"
                    value={item.notes || ''}
                    onChange={(e) => handleLocalChange(item.id, 'notes', e.target.value)}
                    onBlur={(e) => updateNotes(item.id, e.target.value)}
                    className="table-input text-sm text-gray-500"
                    placeholder="..."
                  />
                </td>
                <td className="py-2 px-1 md:px-4 text-center">
                  <button
                    onClick={() => deleteItem(item.id, item.name)}
                    className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                    title="حذف"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Add New Manual Item */}
        <div className="flex items-center gap-3 p-4 bg-gray-50 border-t">
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="اسم البند الجديد..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
          />
          <button
            onClick={addItem}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={18} />
            إضافة
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="bg-emerald-700 text-white py-3 px-6 font-bold text-lg">الملخص</div>
        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <SummaryCard label="مجموع الليرة التركية" value={`₺${formatNumber(totalTry)}`} color="gray" />
            <SummaryCard label="مجموع الدولار" value={`$${formatNumber(totalUsd)}`} color="gray" />
            <SummaryCard label="سعر الصرف" value={exchangeRate} color="blue" />
            <SummaryCard label="الليرة بالدولار" value={`$${formatNumber(tryToUsd)}`} color="blue" />
            <SummaryCard label="المجموع الكلي" value={`$${formatNumber(grandTotal)}`} color="emerald" highlight />
            <SummaryCard label="الجرد السابق" value={`$${formatNumber(previousTotal)}`} color="gray" />
          </div>

          <div className="mt-6 p-4 rounded-xl bg-gradient-to-l from-emerald-500 to-emerald-700 text-white text-center">
            <p className="text-emerald-100 text-sm mb-1">الربح الصافي</p>
            <p className={`text-2xl md:text-4xl font-bold ${profit < 0 ? 'text-red-200' : ''}`}>
              ${formatNumber(profit)}
            </p>
            {lastInventory && (
              <p className="text-emerald-200 text-xs mt-2">
                آخر جرد: {lastInventory.date}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color = 'gray', highlight = false }) {
  const colors = {
    gray: 'bg-gray-50 border-gray-200',
    blue: 'bg-blue-50 border-blue-200',
    emerald: 'bg-emerald-50 border-emerald-300',
  };

  return (
    <div className={`p-4 rounded-lg border ${colors[color]} ${highlight ? 'ring-2 ring-emerald-400' : ''}`}>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-emerald-700' : 'text-gray-800'}`}>{value}</p>
    </div>
  );
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
