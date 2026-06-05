import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, LogOut, Smartphone, Wifi, WifiOff, MessageSquare, RotateCcw, Plus, X, Users, Check, Tags, Save, Trash2, Search, ChevronRight, ChevronLeft, Filter } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

const STATE_LABELS = {
  idle: { label: 'غير نشط', color: 'text-gray-400', bg: 'bg-gray-100' },
  connecting: { label: 'جارٍ الاتصال...', color: 'text-yellow-600', bg: 'bg-yellow-50' },
  qr: { label: 'في انتظار المسح', color: 'text-blue-600', bg: 'bg-blue-50' },
  connected: { label: 'متصل ✅', color: 'text-green-600', bg: 'bg-green-50' },
  closed: { label: 'مقطوع', color: 'text-red-500', bg: 'bg-red-50' },
  offline: { label: 'البوت غير متاح', color: 'text-red-500', bg: 'bg-red-50' },
};

export default function WhatsApp() {
  const [status, setStatus] = useState({ state: 'idle' });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [allowedGroups, setAllowedGroups] = useState([]);
  const [waGroups, setWaGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [savingGroups, setSavingGroups] = useState(false);

  // ─── الرسائل: ترقيم + فلترة + اختيار جماعي ───
  const [messages, setMessages] = useState([]);
  const [msgPage, setMsgPage] = useState(1);
  const [msgPageSize, setMsgPageSize] = useState(20);
  const [msgTotal, setMsgTotal] = useState(0);
  const [msgTotalPages, setMsgTotalPages] = useState(1);
  const [financialOnly, setFinancialOnly] = useState(true);
  const [msgQuery, setMsgQuery] = useState('');
  const [msgSearch, setMsgSearch] = useState(''); // قيمة مُرسَلة فعلياً (بعد debounce)
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [msgLoading, setMsgLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // الكلمات المفتاحية
  const [keywords, setKeywords] = useState({ us: [], them: [], try: [], usd: [], ignore: [], admin_token: 'admin' });
  const [kwSaving, setKwSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.get('/internal/whatsapp/status');
      setStatus(res.data);
    } catch {
      setStatus({ state: 'offline' });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async () => {
    setMsgLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(msgPage),
        pageSize: String(msgPageSize),
      });
      if (financialOnly) params.set('financial_only', '1');
      if (msgSearch) params.set('q', msgSearch);
      const res = await api.get(`/internal/whatsapp/messages?${params.toString()}`);
      const data = res.data || {};
      setMessages(Array.isArray(data.items) ? data.items : []);
      setMsgTotal(data.total || 0);
      setMsgTotalPages(data.totalPages || 1);
      // مسح المحدّدات التي لم تعد ظاهرة
      setSelectedIds(prev => {
        const visible = new Set((data.items || []).map(m => m.id));
        const next = new Set();
        for (const id of prev) if (visible.has(id)) next.add(id);
        return next;
      });
    } catch {
      setMessages([]);
      setMsgTotal(0);
      setMsgTotalPages(1);
    } finally {
      setMsgLoading(false);
    }
  }, [msgPage, msgPageSize, financialOnly, msgSearch]);

  const loadAllowedGroups = useCallback(async () => {
    try {
      const res = await api.get('/internal/whatsapp/allowed-groups');
      setAllowedGroups(res.data.groups || []);
    } catch {}
  }, []);

  const loadWaGroups = useCallback(async () => {
    setLoadingGroups(true);
    try {
      const res = await api.get('/internal/whatsapp/all-groups');
      setWaGroups(Array.isArray(res.data) ? res.data : []);
    } catch {
      setWaGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  const saveAllowedGroups = async (groups) => {
    setSavingGroups(true);
    try {
      const res = await api.put('/internal/whatsapp/allowed-groups', { groups });
      setAllowedGroups(res.data.groups || []);
      toast.success('تم الحفظ');
    } catch (e) {
      toast.error(e.response?.data?.error || 'فشل الحفظ');
    } finally {
      setSavingGroups(false);
    }
  };

  const addGroup = (name) => {
    const n = String(name || '').trim();
    if (!n) return;
    if (allowedGroups.some(g => g.toLowerCase() === n.toLowerCase())) {
      toast.info('المجموعة مضافة مسبقاً');
      return;
    }
    saveAllowedGroups([...allowedGroups, n]);
    setNewGroupName('');
  };

  const removeGroup = (name) => {
    saveAllowedGroups(allowedGroups.filter(g => g !== name));
  };

  const loadKeywords = useCallback(async () => {
    try {
      const res = await api.get('/internal/whatsapp/keywords');
      setKeywords({
        us: res.data.us || [],
        them: res.data.them || [],
        try: res.data.try || [],
        usd: res.data.usd || [],
        ignore: res.data.ignore || [],
        admin_token: res.data.admin_token || 'admin',
      });
    } catch {}
  }, []);

  const saveKeywords = async () => {
    setKwSaving(true);
    try {
      await api.put('/internal/whatsapp/keywords', keywords);
      toast.success('تم حفظ الكلمات المفتاحية');
    } catch (e) {
      toast.error(e.response?.data?.error || 'فشل الحفظ');
    } finally {
      setKwSaving(false);
    }
  };

  const updateKwList = (key, value) => {
    const arr = String(value || '').split(/[,،\n]+/).map(s => s.trim()).filter(Boolean);
    setKeywords(prev => ({ ...prev, [key]: arr }));
  };

  useEffect(() => {
    loadStatus();
    loadMessages();
    // تحديث تلقائي كل 5 ثوانٍ لو في حالة QR أو connecting
    const interval = setInterval(() => {
      loadStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  // إعادة تحميل الرسائل عند تغيّر الصفحة/الفلاتر/البحث
  useEffect(() => {
    if (status.state === 'connected') loadMessages();
  }, [loadMessages, status.state]);

  // debounce لمربع البحث: 400ms
  useEffect(() => {
    const t = setTimeout(() => {
      setMsgSearch(msgQuery.trim());
      setMsgPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [msgQuery]);

  // إعادة التهيئة عند تغيّر الفلتر/حجم الصفحة
  useEffect(() => { setMsgPage(1); }, [financialOnly, msgPageSize]);

  // لما تتغير الحالة لـ connected، حمّل البيانات
  useEffect(() => {
    if (status.state === 'connected') {
      loadAllowedGroups();
      loadKeywords();
    }
  }, [status.state, loadAllowedGroups, loadKeywords]);

  // ─── اختيار الرسائل ───
  const allVisibleIds = useMemo(() => messages.map(m => m.id), [messages]);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selectedIds.has(id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisibleIds));
    }
  };

  const deleteOne = async (id) => {
    if (!confirm('حذف هذه الرسالة؟')) return;
    setDeleting(true);
    try {
      await api.delete(`/internal/whatsapp/messages/${id}`);
      toast.success('تم الحذف');
      loadMessages();
    } catch (e) {
      toast.error(e.response?.data?.error || 'فشل الحذف');
    } finally {
      setDeleting(false);
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!confirm(`حذف ${ids.length} رسالة؟`)) return;
    setDeleting(true);
    try {
      await api.post('/internal/whatsapp/messages/delete-bulk', { ids });
      toast.success(`تم حذف ${ids.length} رسالة`);
      setSelectedIds(new Set());
      loadMessages();
    } catch (e) {
      toast.error(e.response?.data?.error || 'فشل الحذف الجماعي');
    } finally {
      setDeleting(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await api.post('/internal/whatsapp/start');
      setStatus(res.data);
      toast.success('تم إرسال طلب الاتصال');
    } catch (e) {
      toast.error(e.response?.data?.error || 'تعذّر الاتصال بالبوت');
    } finally {
      setStarting(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('هل تريد قطع الاتصال بواتساب؟')) return;
    try {
      await api.post('/internal/whatsapp/logout');
      setStatus({ state: 'idle' });
      toast.success('تم قطع الاتصال');
    } catch {
      toast.error('خطأ في قطع الاتصال');
    }
  };

  const handleReset = async () => {
    if (!confirm('إعادة ضبط الجلسة ستحذف بيانات الربط الحالية تماماً. الاستمرار؟')) return;
    setStarting(true);
    try {
      const res = await api.post('/internal/whatsapp/reset');
      setStatus(res.data);
      toast.success('تمت إعادة الضبط — انتظر ظهور QR');
    } catch (e) {
      toast.error(e.response?.data?.error || 'فشلت إعادة الضبط');
    } finally {
      setStarting(false);
    }
  };

  const stateInfo = STATE_LABELS[status.state] || STATE_LABELS.idle;

  return (
    <div className="max-w-2xl mx-auto" dir="rtl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <MessageSquare className="text-green-500" size={28} />
        بوت واتساب
      </h1>

      {/* ─── بطاقة الحالة ─── */}
      <div className="bg-white rounded-2xl shadow border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {status.state === 'connected'
              ? <Wifi className="text-green-500" size={24} />
              : <WifiOff className="text-gray-400" size={24} />
            }
            <div>
              <p className="font-bold text-lg text-gray-800">
                {status.phoneNumber ? `+${status.phoneNumber}` : 'غير مرتبط'}
              </p>
              <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${stateInfo.color} ${stateInfo.bg}`}>
                {stateInfo.label}
              </span>
            </div>
          </div>
          <button onClick={loadStatus} className="text-gray-400 hover:text-gray-600">
            <RefreshCw size={18} />
          </button>
        </div>

        {/* QR Code */}
        {status.state === 'qr' && status.qrDataUrl && (
          <div className="flex flex-col items-center py-4">
            <p className="text-sm text-gray-500 mb-3">افتح واتساب → الأجهزة المرتبطة → ربط جهاز ← امسح الكود</p>
            <img src={status.qrDataUrl} alt="QR Code" className="w-56 h-56 rounded-xl border-4 border-green-200 shadow" />
            <p className="text-xs text-gray-400 mt-2">يتحدث تلقائياً كل 5 ثوانٍ</p>
          </div>
        )}

        {/* أزرار */}
        <div className="flex gap-3 mt-4">
          {status.state !== 'connected' && (
            <button
              onClick={handleStart}
              disabled={starting || status.state === 'connecting' || status.state === 'qr'}
              className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl font-bold transition-colors disabled:opacity-50"
            >
              <Smartphone size={18} />
              {status.state === 'qr' ? 'في انتظار المسح...' : starting ? 'جارٍ...' : 'ربط رقم جديد'}
            </button>
          )}
          {status.state === 'connected' && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2.5 rounded-xl transition-colors"
            >
              <LogOut size={16} />
              قطع الاتصال
            </button>
          )}
          {(status.state === 'connecting' || status.state === 'qr' || status.state === 'closed') && (
            <button
              onClick={handleReset}
              disabled={starting}
              className="flex items-center gap-2 bg-orange-50 hover:bg-orange-100 text-orange-600 px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
              title="امسح بيانات الجلسة وابدأ من جديد"
            >
              <RotateCcw size={16} />
              إعادة الضبط
            </button>
          )}
        </div>
      </div>

      {/* ─── المجموعات المسموح بها (فلتر الرسائل) ─── */}
      {status.state === 'connected' && (
        <div className="bg-white rounded-2xl shadow border border-gray-100 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-700 flex items-center gap-2">
              <Users size={18} className="text-green-600" />
              المجموعات المسموح بها
            </h2>
            <button
              onClick={loadWaGroups}
              disabled={loadingGroups}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {loadingGroups ? 'جارٍ الجلب...' : 'جلب مجموعاتي من واتساب'}
            </button>
          </div>

          <p className="text-xs text-gray-500 mb-3">
            سيتم استقبال الرسائل من هذه المجموعات فقط (مطابقة الاسم بدقّة، غير حسّاس لحالة الأحرف).
          </p>

          {/* القائمة المعتمدة */}
          {allowedGroups.length === 0 ? (
            <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
              ⚠️ لم تُضِف أي مجموعة بعد — جميع الرسائل ستُتجاهَل.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-4">
              {allowedGroups.map(name => (
                <div key={name} className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-1.5 text-sm">
                  <Check size={14} />
                  <span>{name}</span>
                  <button
                    onClick={() => removeGroup(name)}
                    disabled={savingGroups}
                    className="text-green-600 hover:text-red-600 disabled:opacity-50"
                    title="حذف"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* إضافة يدوية */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addGroup(newGroupName)}
              placeholder="اكتب اسم المجموعة كما يظهر في واتساب..."
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-green-400"
              dir="auto"
            />
            <button
              onClick={() => addGroup(newGroupName)}
              disabled={savingGroups || !newGroupName.trim()}
              className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
            >
              <Plus size={16} />
              إضافة
            </button>
          </div>

          {/* اقتراحات من مجموعات الحساب */}
          {waGroups.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500 mb-2">مجموعاتك على واتساب — اضغط للإضافة:</p>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                {waGroups
                  .filter(g => !allowedGroups.some(a => a.toLowerCase() === (g.subject || '').toLowerCase()))
                  .map(g => (
                    <button
                      key={g.id}
                      onClick={() => addGroup(g.subject)}
                      disabled={savingGroups}
                      className="flex items-center gap-1 bg-gray-50 hover:bg-green-50 hover:border-green-300 border border-gray-200 text-gray-700 rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
                    >
                      <Plus size={12} />
                      <span dir="auto">{g.subject}</span>
                      <span className="text-gray-400">({g.size})</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── الكلمات المفتاحية ─── */}
      {status.state === 'connected' && (
        <div className="bg-white rounded-2xl shadow border border-gray-100 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-700 flex items-center gap-2">
              <Tags size={18} className="text-purple-600" />
              الكلمات المفتاحية
            </h2>
            <button
              onClick={saveKeywords}
              disabled={kwSaving}
              className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg text-sm font-bold disabled:opacity-50"
            >
              <Save size={14} />
              {kwSaving ? 'جارٍ الحفظ...' : 'حفظ'}
            </button>
          </div>

          <p className="text-xs text-gray-500 mb-4">
            افصل بين الكلمات بفاصلة أو سطر جديد. غير حسّاس لحالة الأحرف.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <KwField
              label="مرادفات «لنا»"
              hint="عند ورود إحداها → عملية وارد لنا"
              color="green"
              value={keywords.us.join('، ')}
              onChange={v => updateKwList('us', v)}
            />
            <KwField
              label="مرادفات «لكم»"
              hint="عند ورود إحداها → عملية صادر لكم"
              color="blue"
              value={keywords.them.join('، ')}
              onChange={v => updateKwList('them', v)}
            />
            <KwField
              label="مرادفات الليرة التركية"
              hint="تركي، tl، ليرة ..."
              color="orange"
              value={keywords.try.join('، ')}
              onChange={v => updateKwList('try', v)}
            />
            <KwField
              label="مرادفات الدولار"
              hint="دولار، usd، dolar ..."
              color="emerald"
              value={keywords.usd.join('، ')}
              onChange={v => updateKwList('usd', v)}
            />
            <KwField
              label="كلمات التجاهل"
              hint="أيّ رسالة تحوي إحدى هذه الكلمات تُتجاهَل"
              color="red"
              value={keywords.ignore.join('، ')}
              onChange={v => updateKwList('ignore', v)}
            />
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                رمز المسؤول (admin token)
              </label>
              <p className="text-[11px] text-gray-500 mb-1">
                أيّ مرسل يحتوي اسمه على هذه الأحرف <b>بالترتيب</b> = نحن
              </p>
              <input
                type="text"
                value={keywords.admin_token}
                onChange={e => setKeywords(prev => ({ ...prev, admin_token: e.target.value }))}
                placeholder="admin"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-purple-400"
                dir="ltr"
              />
            </div>
          </div>
        </div>
      )}

      {/* ─── أداة اختبار المحلّل ─── */}
      {status.state === 'connected' && (
        <ParserTester allowedGroups={allowedGroups} adminToken={keywords.admin_token} />
      )}

      {/* ─── آخر الرسائل ─── */}
      {status.state === 'connected' && (
        <div className="bg-white rounded-2xl shadow border border-gray-100 mb-6">
          {/* الهيدر: العنوان + الإجراءات */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-700 flex items-center gap-2">
              <MessageSquare size={18} className="text-green-600" />
              الرسائل {financialOnly ? 'المالية' : 'كلّها'}
              <span className="text-xs text-gray-400 font-normal">({msgTotal})</span>
            </h2>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <button
                  onClick={deleteSelected}
                  disabled={deleting}
                  className="flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
                  title="حذف المحدّد"
                >
                  <Trash2 size={14} />
                  حذف ({selectedIds.size})
                </button>
              )}
              <button
                onClick={loadMessages}
                disabled={msgLoading}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                title="تحديث"
              >
                <RefreshCw size={16} className={msgLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* شريط الفلترة */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={financialOnly}
                onChange={e => setFinancialOnly(e.target.checked)}
                className="rounded"
              />
              <Filter size={14} className="text-purple-600" />
              مالية فقط
            </label>

            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={msgQuery}
                onChange={e => setMsgQuery(e.target.value)}
                placeholder="بحث في النص / المرسل / المجموعة..."
                className="w-full pr-8 pl-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-green-400"
                dir="auto"
              />
            </div>

            <select
              value={msgPageSize}
              onChange={e => setMsgPageSize(parseInt(e.target.value))}
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white"
              title="عدد الصفوف"
            >
              <option value={20}>20 / صفحة</option>
              <option value={30}>30 / صفحة</option>
              <option value={50}>50 / صفحة</option>
              <option value={100}>100 / صفحة</option>
            </select>
          </div>

          {/* الجدول */}
          {messages.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">
              {msgLoading ? 'جارٍ التحميل...' : (financialOnly ? 'لا توجد رسائل مالية بعد.' : 'لا توجد رسائل.')}
            </p>
          ) : (
            <>
              {/* صفّ التحديد الجماعي */}
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
                <span>تحديد الكلّ في هذه الصفحة</span>
              </div>

              <div className="divide-y divide-gray-50">
                {messages.map(msg => {
                  const isFinancial = !!msg.tx_id;
                  const isUs = msg.tx_source === 'us';
                  const isLana = msg.tx_direction === 'lana';
                  return (
                    <div
                      key={msg.id}
                      className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${selectedIds.has(msg.id) ? 'bg-blue-50/50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(msg.id)}
                        onChange={() => toggleSelect(msg.id)}
                        className="mt-1 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium truncate max-w-[180px]" dir="auto">
                            {msg.group_name || msg.group_id}
                          </span>
                          <span className="text-xs text-gray-500" dir="auto">{msg.sender_name || msg.sender}</span>
                          {isFinancial && (
                            <>
                              <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${isLana ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                {isLana ? 'لنا' : 'لكم'}
                              </span>
                              <span className="text-[11px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                                {msg.tx_amount} {msg.tx_currency === 'USD' ? '$' : '₺'}
                              </span>
                              <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono ${msg.tx_delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                Δ {msg.tx_delta >= 0 ? '+' : ''}{msg.tx_delta}
                              </span>
                              <span className="text-[11px] text-gray-400">
                                مصدر: {isUs ? 'نحن' : 'هم'}
                              </span>
                              {msg.tx_item_name && (
                                <span className="text-[11px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                                  {msg.tx_item_name}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 break-words" dir="auto">{msg.text}</p>
                        <p className="text-xs text-gray-300 mt-0.5">{msg.created_at}</p>
                      </div>
                      <button
                        onClick={() => deleteOne(msg.id)}
                        disabled={deleting}
                        className="text-gray-300 hover:text-red-600 disabled:opacity-50"
                        title="حذف"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* ترقيم الصفحات */}
              {msgTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm">
                  <div className="text-xs text-gray-500">
                    صفحة {msgPage} من {msgTotalPages} — إجمالي {msgTotal}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setMsgPage(1)}
                      disabled={msgPage === 1 || msgLoading}
                      className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-xs"
                    >
                      الأولى
                    </button>
                    <button
                      onClick={() => setMsgPage(p => Math.max(1, p - 1))}
                      disabled={msgPage === 1 || msgLoading}
                      className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
                      title="السابقة"
                    >
                      <ChevronRight size={14} />
                    </button>
                    <span className="px-3 py-1 bg-green-50 text-green-700 rounded font-bold text-xs">
                      {msgPage}
                    </span>
                    <button
                      onClick={() => setMsgPage(p => Math.min(msgTotalPages, p + 1))}
                      disabled={msgPage >= msgTotalPages || msgLoading}
                      className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
                      title="التالية"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      onClick={() => setMsgPage(msgTotalPages)}
                      disabled={msgPage >= msgTotalPages || msgLoading}
                      className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-xs"
                    >
                      الأخيرة
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* تعليمات ─── */}
      {status.state === 'offline' && (
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
          <p className="font-bold mb-1">⚠️ البوت غير متاح</p>
          {status.error === 'auth_mismatch' ? (
            <p>قيمة <code className="bg-yellow-100 px-1 rounded">INTERNAL_API_KEY</code> في backend لا تطابق قيمة البوت. تأكّد من تطابقهما في Railway.</p>
          ) : (
            <>
              <p>تأكد من تشغيل خدمة البوت وأن متغيّرات البيئة موجودة في Railway:</p>
              <code className="block mt-1 text-xs bg-yellow-100 p-2 rounded">
                BOT_URL=http://localhost:3100<br/>
                INTERNAL_API_KEY=...
              </code>
              {status.error && (
                <p className="text-xs mt-2 text-yellow-700">سبب الفشل: <code>{status.error}</code></p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function KwField({ label, hint, color = 'gray', value, onChange }) {
  const colors = {
    green:   'border-green-200 focus:border-green-400',
    blue:    'border-blue-200 focus:border-blue-400',
    orange:  'border-orange-200 focus:border-orange-400',
    emerald: 'border-emerald-200 focus:border-emerald-400',
    red:     'border-red-200 focus:border-red-400',
    gray:    'border-gray-200 focus:border-gray-400',
  };
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-[11px] text-gray-500 mb-1">{hint}</p>}
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none ${colors[color] || colors.gray}`}
        dir="auto"
      />
    </div>
  );
}

function ParserTester({ allowedGroups }) {
  const [text, setText] = useState('لنا 500 تركي');
  const [senderName, setSenderName] = useState('');
  const [groupName, setGroupName] = useState(allowedGroups[0] || '');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!groupName && allowedGroups[0]) setGroupName(allowedGroups[0]);
  }, [allowedGroups, groupName]);

  const run = async () => {
    setLoading(true);
    try {
      const res = await api.post('/internal/whatsapp/preview-parse', {
        text,
        sender_name: senderName,
        group_name: groupName,
      });
      setResult(res.data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'فشل الاختبار');
    } finally {
      setLoading(false);
    }
  };

  const Row = ({ label, value, ok }) => (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={`font-mono text-xs ${ok === true ? 'text-green-700' : ok === false ? 'text-red-600' : 'text-gray-700'}`}>
        {value == null || value === '' ? '—' : String(value)}
      </span>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl shadow border border-gray-100 p-5 mb-6">
      <h2 className="font-bold text-gray-700 flex items-center gap-2 mb-3">
        🧪 اختبار المحلّل (تشخيص)
      </h2>
      <p className="text-xs text-gray-500 mb-3">
        اكتب رسالة + اسم المرسل + المجموعة لترى كيف سيتعامل النظام معها — بدون إرسال فعلي.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="نصّ الرسالة"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-purple-400"
          dir="auto"
        />
        <input
          type="text"
          value={senderName}
          onChange={e => setSenderName(e.target.value)}
          placeholder="اسم المرسل (مثلاً: Lebid Admin أو Mohamed)"
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-purple-400"
          dir="auto"
        />
        <select
          value={groupName}
          onChange={e => setGroupName(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-purple-400"
        >
          <option value="">-- اختر مجموعة --</option>
          {allowedGroups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <button
          onClick={run}
          disabled={loading || !text}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
        >
          {loading ? 'جارٍ...' : 'اختبار'}
        </button>
      </div>

      {result && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <Row label="المجموعة معتمدة؟" value={result.group_allowed ? '✓' : '✗'} ok={!!result.group_allowed} />
          <Row label="مربوطة ببند" value={result.linked_item?.item_name || '—'} ok={!!result.linked_item} />
          <Row label="المصدر (من الاسم)" value={result.source === 'us' ? 'نحن (admin)' : 'هم'} />
          <Row label="نتيجة التحليل" value={result.parsed ? (result.parsed.ignored ? 'متجاهَلة: ' + result.parsed.reason : `${result.parsed.direction} | ${result.parsed.currency} | ${result.parsed.amount}`) : '✗ لم يُستخرَج شيء'} ok={!!result.parsed && !result.parsed.ignored} />
          <Row label="التغيير على الرصيد (delta)" value={result.delta != null ? (result.delta > 0 ? `+${result.delta}` : result.delta) : '—'} />
          {!result.group_allowed && (
            <p className="text-xs text-red-600 mt-2">
              💡 المجموعة المختارة ليست في قائمة المعتمدة. القائمة الحالية: {result.allowed_groups.join('، ') || '(فارغة)'}
            </p>
          )}
          {result.group_allowed && !result.linked_item && (
            <p className="text-xs text-red-600 mt-2">
              💡 لا يوجد بند مربوط بهذه المجموعة. اذهب إلى إعدادات API واختر نوع "مجموعة واتساب" لبند، ثم اختر هذه المجموعة.
            </p>
          )}
          {result.linked_item && !result.parsed && (
            <p className="text-xs text-orange-600 mt-2">
              💡 الرسالة لا تحوي كلمات كافية (تحتاج: لنا/لكم + عملة + رقم). راجع الكلمات المفتاحية أعلاه.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
