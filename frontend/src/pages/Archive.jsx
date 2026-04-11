import { useState, useEffect } from 'react';
import { Calendar, Eye, Trash2, ChevronDown, ChevronUp, Filter } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

export default function Archive() {
  const [inventories, setInventories] = useState([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: '', to: '' });

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      const res = await api.get('/inventory', { params });
      setInventories(res.data.inventories);
      setTotal(res.data.total);
    } catch {
      toast.error('خطأ في تحميل الأرشيف');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleExpand = async (id) => {
    if (expanded === id) {
      setExpanded(null);
      setExpandedData(null);
      return;
    }
    try {
      const res = await api.get(`/inventory/${id}`);
      setExpandedData(res.data);
      setExpanded(id);
    } catch {
      toast.error('خطأ في تحميل التفاصيل');
    }
  };

  const deleteInventory = async (id) => {
    if (!confirm('هل تريد حذف هذا الجرد؟')) return;
    try {
      await api.delete(`/inventory/${id}`);
      toast.success('تم الحذف');
      load();
    } catch {
      toast.error('خطأ في الحذف');
    }
  };

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <h2 className="text-3xl font-bold text-gray-800 mb-6">الأرشيف</h2>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <Filter size={18} className="text-gray-400" />
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">من:</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">إلى:</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          <button onClick={load} className="bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-emerald-700 transition-colors">
            بحث
          </button>
          <button
            onClick={() => { setFilters({ from: '', to: '' }); setTimeout(load, 0); }}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            مسح الفلتر
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">جاري التحميل...</div>
      ) : inventories.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Calendar size={48} className="mx-auto mb-4" />
          <p>لا يوجد جرد محفوظ بعد</p>
        </div>
      ) : (
        <div className="space-y-3">
          {inventories.map((inv) => (
            <div key={inv.id} className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleExpand(inv.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                    <Calendar size={18} className="text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-bold">{inv.date}</p>
                    <p className="text-sm text-gray-500">سعر الصرف: {inv.exchange_rate}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-left">
                    <p className="text-sm text-gray-500">المجموع</p>
                    <p className="font-bold text-emerald-700">${Number(inv.total_converted_usd).toFixed(2)}</p>
                  </div>
                  <div className="text-left">
                    <p className="text-sm text-gray-500">الربح</p>
                    <p className={`font-bold ${inv.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ${Number(inv.profit).toFixed(2)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteInventory(inv.id); }}
                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 size={16} />
                  </button>
                  {expanded === inv.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
              </div>

              {expanded === inv.id && expandedData && (
                <div className="border-t p-4 bg-gray-50">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-right py-1 px-2">الاسم</th>
                        <th className="text-center py-1 px-2">الليرة ₺</th>
                        <th className="text-center py-1 px-2">الدولار $</th>
                        <th className="text-center py-1 px-2">ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expandedData.items?.map((item, i) => (
                        <tr key={i} className="border-t border-gray-200">
                          <td className="py-1 px-2">{item.item_name}</td>
                          <td className="text-center py-1 px-2">{Number(item.try_amount).toLocaleString()}</td>
                          <td className="text-center py-1 px-2">{Number(item.usd_amount).toLocaleString()}</td>
                          <td className="text-center py-1 px-2 text-gray-400">{item.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
