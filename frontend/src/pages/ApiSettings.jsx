import { useState, useEffect } from 'react';
import { Settings, Plus, Save, Trash2, Wifi, TestTube, Bot } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

const PROVIDER_TYPES = [
  { value: 'znet', label: 'Znet', fields: ['base_url', 'kod', 'sifre'] },
  { value: 'barakat', label: 'Barakat / APStore', fields: ['base_url', 'api_token'] },
  { value: 'murat_temiz', label: 'Murat Temiz', fields: ['base_url', 'kod', 'sifre'] },
  { value: 'smm_panel', label: 'SMM Panel (متابعين/مشاهدات)', fields: ['base_url', 'api_token'] },
  { value: 'bayi_alayatl', label: 'روبوت موقع Bayi Alayatl', fields: ['base_url', 'kod', 'sifre'] },
];

const SCRAPER_PROVIDERS = new Set(['bayi_alayatl']);
const isScraper = (providerType) => SCRAPER_PROVIDERS.has(providerType);

export default function ApiSettings() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [config, setConfig] = useState({
    provider_type: 'znet',
    base_url: '',
    api_token: '',
    kod: '',
    sifre: '',
  });
  const [testing, setTesting] = useState(false);

  const load = async () => {
    try {
      const res = await api.get('/items');
      setItems(res.data);
    } catch {
      toast.error('خطأ في التحميل');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const selectItem = async (item) => {
    setSelectedItem(item);
    try {
      const res = await api.get(`/configs/${item.id}`);
      if (res.data) {
        setConfig({
          provider_type: res.data.provider_type || 'znet',
          base_url: res.data.base_url || '',
          api_token: res.data.api_token || '',
          kod: res.data.kod || '',
          sifre: res.data.sifre || '',
        });
      } else {
        setConfig({ provider_type: 'znet', base_url: '', api_token: '', kod: '', sifre: '' });
      }
    } catch {
      setConfig({ provider_type: 'znet', base_url: '', api_token: '', kod: '', sifre: '' });
    }
  };

  const saveConfig = async () => {
    if (!selectedItem) return;
    try {
      await api.put(`/configs/${selectedItem.id}`, config);
      toast.success('تم حفظ الإعدادات');
      load();
    } catch {
      toast.error('خطأ في الحفظ');
    }
  };

  const testConnection = async () => {
    if (!selectedItem) return;
    setTesting(true);
    try {
      const res = await api.post(`/configs/${selectedItem.id}/fetch`);
      toast.success(`نجح الاتصال! الرصيد: ${res.data.balance}`);
    } catch (err) {
      toast.error(`فشل الاتصال: ${err.response?.data?.error || err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const removeConfig = async () => {
    if (!selectedItem) return;
    if (!confirm('هل تريد إزالة إعدادات API لهذا البند؟')) return;
    try {
      await api.delete(`/configs/${selectedItem.id}`);
      toast.success('تم إزالة الإعدادات');
      setSelectedItem(null);
      setConfig({ provider_type: 'znet', base_url: '', api_token: '', kod: '', sifre: '' });
      load();
    } catch {
      toast.error('خطأ');
    }
  };

  const providerInfo = PROVIDER_TYPES.find(p => p.value === config.provider_type);

  if (loading) return <div className="text-center py-20 text-gray-400">جاري التحميل...</div>;

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <h2 className="text-3xl font-bold text-gray-800 mb-6">إعدادات API</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {/* Items List */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-emerald-700 text-white py-3 px-4 font-bold">البنود</div>
          <div className="max-h-[300px] md:max-h-[600px] overflow-y-auto">
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => selectItem(item)}
                className={`flex items-center justify-between p-3 border-b border-gray-100 cursor-pointer transition-colors ${
                  selectedItem?.id === item.id ? 'bg-emerald-50 border-r-4 border-r-emerald-600' : 'hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">{item.name}</span>
                {item.type === 'provider' && (
                  isScraper(item.provider_type)
                    ? <Bot size={14} className="text-blue-600" />
                    : <Wifi size={14} className="text-emerald-600" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Config Form */}
        <div className="md:col-span-2">
          {selectedItem ? (
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Settings size={24} className="text-emerald-600" />
                  <h3 className="font-bold text-xl">{selectedItem.name}</h3>
                </div>
                {selectedItem.type === 'provider' && (
                  <button onClick={removeConfig} className="text-red-500 hover:text-red-700 text-sm flex items-center gap-1">
                    <Trash2 size={14} />
                    إزالة الإعدادات
                  </button>
                )}
              </div>

              {/* Provider Type */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">نوع الجهة</label>
                <select
                  value={config.provider_type}
                  onChange={(e) => setConfig({ ...config, provider_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  {PROVIDER_TYPES.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Base URL */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">رابط الموقع (Base URL)</label>
                <input
                  type="url"
                  value={config.base_url}
                  onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                  placeholder={config.provider_type === 'barakat' ? 'https://api.x-stor.net' : 'https://example.com'}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  dir="ltr"
                />
              </div>

              {/* Znet / Murat Temiz / Bayi Alayatl fields */}
              {(config.provider_type === 'znet' || config.provider_type === 'murat_temiz' || config.provider_type === 'bayi_alayatl') && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {config.provider_type === 'bayi_alayatl' ? 'رقم الجوال' : 'الكود (kod)'}
                    </label>
                    <input
                      type="text"
                      value={config.kod}
                      onChange={(e) => setConfig({ ...config, kod: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      dir="ltr"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {config.provider_type === 'bayi_alayatl' ? 'كلمة السر' : 'كلمة المرور (sifre)'}
                    </label>
                    <input
                      type="password"
                      value={config.sifre}
                      onChange={(e) => setConfig({ ...config, sifre: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      dir="ltr"
                    />
                  </div>
                  {config.provider_type === 'bayi_alayatl' && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                      <Bot size={16} className="inline ml-1" />
                      سيستخدم روبوت لفتح الموقع وجلب رقم <b>Bayi Alacağı</b> (الفرق بين الديون والأرصدة). العملية تستغرق ~30 ثانية.
                    </div>
                  )}
                </>
              )}

              {/* Barakat fields */}
              {(config.provider_type === 'barakat') && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Token</label>
                  <input
                    type="password"
                    value={config.api_token}
                    onChange={(e) => setConfig({ ...config, api_token: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    dir="ltr"
                  />
                </div>
              )}

              {/* SMM Panel fields */}
              {config.provider_type === 'smm_panel' && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">كود API الخاص بحسابك</label>
                    <input
                      type="password"
                      placeholder="Zp9qCzw7..."
                      value={config.api_token}
                      onChange={(e) => setConfig({ ...config, api_token: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      dir="ltr"
                    />
                  </div>
                  <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
                    <Wifi size={16} className="inline ml-1" />
                    يستخدم API رسمي (لا يحتاج روبوت). الرصيد يُحفظ في خانة <b>$ دولار</b>.
                  </div>
                </>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={saveConfig}
                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg transition-colors font-bold"
                >
                  <Save size={18} />
                  حفظ الإعدادات
                </button>
                <button
                  onClick={testConnection}
                  disabled={testing}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  <TestTube size={18} className={testing ? 'animate-pulse' : ''} />
                  اختبار
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-lg p-12 text-center text-gray-400">
              <Settings size={48} className="mx-auto mb-4" />
              <p>اختر بنداً من القائمة لتعديل إعدادات API الخاصة به</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
