import { useState, useEffect } from 'react';
import { DollarSign, Save } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

export default function Currency() {
  const [rate, setRate] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/settings').then(res => {
      setRate(res.data.exchange_rate || '');
      setLoading(false);
    });
  }, []);

  const saveRate = async () => {
    const numRate = parseFloat(rate);
    if (!numRate || numRate <= 0) {
      toast.error('أدخل قيمة صحيحة');
      return;
    }
    try {
      await api.put('/settings/exchange_rate', { value: numRate });
      toast.success('تم حفظ سعر الصرف');
    } catch {
      toast.error('خطأ في الحفظ');
    }
  };

  if (loading) return <div className="text-center py-20 text-gray-400">جاري التحميل...</div>;

  return (
    <div className="animate-fade-in max-w-xl mx-auto">
      <h2 className="text-3xl font-bold text-gray-800 mb-6">العملات</h2>

      <div className="bg-white rounded-xl shadow-lg p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
            <DollarSign className="text-emerald-600" size={24} />
          </div>
          <div>
            <h3 className="font-bold text-lg">سعر صرف الدولار</h3>
            <p className="text-gray-500 text-sm">قيمة الدولار الواحد بالليرة التركية</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-2">1 USD =</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveRate()}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-2xl font-bold text-center focus:outline-none focus:ring-2 focus:ring-emerald-400"
                step="0.01"
                min="0"
              />
              <span className="text-xl font-bold text-gray-500">₺</span>
            </div>
          </div>
        </div>

        <button
          onClick={saveRate}
          className="mt-6 w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg transition-colors font-bold text-lg"
        >
          <Save size={20} />
          حفظ
        </button>

        {rate && parseFloat(rate) > 0 && (
          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-700">
              <strong>مثال:</strong> ₺{Number(parseFloat(rate) * 100).toLocaleString()} = $100.00
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
