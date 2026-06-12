import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Trash2, ArrowDownCircle, ArrowUpCircle, Pencil, Check, X, Activity, ChevronDown, ChevronUp, Play, AlertTriangle, CheckCircle2, MessageSquare, Wifi, WifiOff, Upload, Filter } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

function fmt(n) {
  return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Bank() {
  const [bankItem, setBankItem] = useState(null);          // البند البنكي من items
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');

  // ─── تشخيص webhook ─────
  const [diagOpen, setDiagOpen] = useState(false);
  const [diag, setDiag] = useState(null);
  const [smsLog, setSmsLog] = useState([]);
  const [smsTestText, setSmsTestText] = useState('');
  const [smsTestResult, setSmsTestResult] = useState(null);
  const [smsTestBusy, setSmsTestBusy] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);

  // ─── حالة Google Messages scraper ─────
  const [gmsgStatus, setGmsgStatus] = useState(null);
  const [gmsgBusy, setGmsgBusy] = useState(false);
  const [gmsgSessionInfo, setGmsgSessionInfo] = useState(null);
  const [gmsgUploadBusy, setGmsgUploadBusy] = useState(false);
  const [gmsgUploadProgress, setGmsgUploadProgress] = useState(0);

  // ─── فلترة سجل المعاملات ─────
  const emptyFilters = { from: '', to: '', direction: '', min_amount: '', max_amount: '', q: '' };
  const [filters, setFilters] = useState(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersActive = Object.values(filters).some(v => String(v).trim() !== '');

  // ─── تحميل البيانات ─────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.direction) params.direction = filters.direction;
      if (filters.min_amount) params.min_amount = filters.min_amount;
      if (filters.max_amount) params.max_amount = filters.max_amount;
      if (filters.q && filters.q.trim()) params.q = filters.q.trim();

      const [itemsRes, txRes] = await Promise.all([
        api.get('/items'),
        api.get('/bank/transactions', { params }),
      ]);

      const bank = itemsRes.data.find(i => i.type === 'bank');
      setBankItem(bank || null);
      setTransactions(txRes.data);
    } catch {
      toast.error('خطأ في تحميل بيانات البنك');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadData(); }, [loadData]);

  const resetFilters = () => {
    setFilters(emptyFilters);
  };

  // ─── تشخيص webhook ─────────────────────────────────────────────────────
  const loadDiagnostics = useCallback(async () => {
    setDiagBusy(true);
    try {
      const [d, log] = await Promise.all([
        api.get('/bank/diagnostics'),
        api.get('/bank/sms-log?limit=30'),
      ]);
      setDiag(d.data);
      setSmsLog(Array.isArray(log.data) ? log.data : []);
    } catch {
      toast.error('فشل تحميل تشخيص الـ webhook');
    } finally {
      setDiagBusy(false);
    }
  }, []);

  useEffect(() => {
    if (diagOpen) loadDiagnostics();
  }, [diagOpen, loadDiagnostics]);

  // ─── Google Messages scraper status ─────────────────────────────────────
  const loadGmsgStatus = useCallback(async () => {
    try {
      const [s, info] = await Promise.allSettled([
        api.get('/internal/bank-message/status'),
        api.get('/internal/bank-message/session-info'),
      ]);
      setGmsgStatus(s.status === 'fulfilled' ? s.value.data : { reachable: false, error: 'load_failed' });
      setGmsgSessionInfo(info.status === 'fulfilled' ? info.value.data : null);
    } catch {
      setGmsgStatus({ reachable: false, error: 'load_failed' });
    }
  }, []);

  // زر "تحديث الحالة" — يستدعي /recheck (إن اكتمل الإقران من الواجهة الحيّة
  // ينتقل لـ running فوراً) ثم يجلب الـ status. لا يُظهر تحذير عند الفشل.
  const recheckGmsg = useCallback(async () => {
    try {
      const r = await api.post('/internal/bank-message/recheck');
      if (r.data?.recovered) {
        toast.success('تمّ كشف اكتمال الإقران — يعمل الآن');
      }
    } catch {
      /* تجاهل — نُكمل بجلب الحالة */
    }
    await loadGmsgStatus();
  }, [loadGmsgStatus]);

  useEffect(() => {
    loadGmsgStatus();
    const id = setInterval(loadGmsgStatus, 15000);
    return () => clearInterval(id);
  }, [loadGmsgStatus]);

  const startGmsg = async () => {
    setGmsgBusy(true);
    try {
      await api.post('/internal/bank-message/start');
      toast.success('تم إرسال أمر التشغيل');
      setTimeout(loadGmsgStatus, 2000);
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    } finally {
      setGmsgBusy(false);
    }
  };

  const uploadGmsgSession = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return toast.error('الملف يجب أن يكون .zip');
    }
    setGmsgUploadBusy(true);
    setGmsgUploadProgress(0);
    try {
      const fd = new FormData();
      fd.append('session', file);
      await api.post('/internal/bank-message/upload-session', fd, {
        timeout: 600000,
        onUploadProgress: (e) => {
          if (e.total) setGmsgUploadProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      toast.success('تم رفع الجلسة — السيرفر يُعيد التشغيل…');
      setTimeout(loadGmsgStatus, 3000);
      setTimeout(loadGmsgStatus, 15000);
    } catch (e) {
      toast.error('فشل الرفع: ' + (e.response?.data?.error || e.message));
    } finally {
      setGmsgUploadBusy(false);
      setGmsgUploadProgress(0);
    }
  };

  const runSmsTest = async () => {
    const text = smsTestText.trim();
    if (!text) return toast.error('الصق نص الرسالة أوّلاً');
    setSmsTestBusy(true);
    setSmsTestResult(null);
    try {
      const res = await api.post('/bank/sms-test', { body: text, sender: 'manual-test' });
      setSmsTestResult({ ok: true, data: res.data });
      toast.success('تم — راجع النتيجة أدناه');
      loadData();
      loadDiagnostics();
    } catch (e) {
      setSmsTestResult({ ok: false, status: e.response?.status, data: e.response?.data });
      toast.warn('انتهت المحاولة — راجع التفاصيل');
      loadDiagnostics();
    } finally {
      setSmsTestBusy(false);
    }
  };

  const clearSmsLog = async () => {
    if (!confirm('تفريغ سجلّ webhook بالكامل؟')) return;
    try {
      await api.delete('/bank/sms-log');
      toast.success('تم التفريغ');
      loadDiagnostics();
    } catch { toast.error('فشل التفريغ'); }
  };

  const deleteLogRow = async (id) => {
    try {
      await api.delete(`/bank/sms-log/${id}`);
      loadDiagnostics();
    } catch { toast.error('فشل الحذف'); }
  };

  // ─── تعديل الرصيد يدوياً ─────────────────────────────────────────────────
  const startEdit = () => {
    setBalanceInput(String(bankItem?.try_amount || 0));
    setEditingBalance(true);
  };

  const saveBalance = async () => {
    const val = parseFloat(balanceInput.replace(',', '.'));
    if (isNaN(val)) return toast.error('رقم غير صحيح');
    try {
      await api.put(`/items/${bankItem.id}/values`, { try_amount: val });
      toast.success('تم تحديث الرصيد');
      setEditingBalance(false);
      loadData();
    } catch { toast.error('خطأ في التحديث'); }
  };

  // ─── حذف معاملة ──────────────────────────────────────────────────────────
  const deleteTx = async (tx) => {
    if (!confirm(`حذف معاملة ${tx.direction === 'in' ? 'واردة' : 'صادرة'} بمبلغ ${fmt(tx.amount)} ₺؟\nسيُعدَّل الرصيد تلقائياً.`)) return;
    try {
      await api.delete(`/bank/transactions/${tx.id}`);
      toast.success('تم الحذف وتصحيح الرصيد');
      loadData();
    } catch { toast.error('خطأ في الحذف'); }
  };

  // ─── حسابات ───────────────────────────────────────────────────────────────
  const totalIn  = transactions.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0);
  const totalOut = transactions.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0);

  // ─── واجهة ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <RefreshCw className="animate-spin ml-2" size={20} /> جار التحميل...
    </div>
  );

  if (!bankItem) return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-yellow-50 border border-yellow-300 rounded-xl text-center text-yellow-800" dir="rtl">
      <p className="text-lg font-bold mb-2">لا يوجد حساب بنكي مضاف</p>
      <p className="text-sm">اذهب إلى <strong>الجرد</strong> وأضف بنداً جديداً، ثم اضبط نوعه <code className="bg-yellow-100 px-1 rounded">bank</code> من قاعدة البيانات أو تواصل مع المطوّر.</p>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto" dir="rtl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">🏦 كويت ترك</h1>

      {/* ─── بطاقة مصدر رسائل البنك (Google Messages Web) ─── */}
      <GmsgSourceCard
        status={gmsgStatus}
        sessionInfo={gmsgSessionInfo}
        busy={gmsgBusy}
        onStart={startGmsg}
        onReload={recheckGmsg}
        onUploadSession={uploadGmsgSession}
        uploadBusy={gmsgUploadBusy}
        uploadProgress={gmsgUploadProgress}
      />

      {/* ─── لوحة تشخيص webhook ─── */}
      <DiagnosticsPanel
        open={diagOpen}
        setOpen={setDiagOpen}
        diag={diag}
        smsLog={smsLog}
        smsTestText={smsTestText}
        setSmsTestText={setSmsTestText}
        smsTestResult={smsTestResult}
        smsTestBusy={smsTestBusy}
        runSmsTest={runSmsTest}
        clearSmsLog={clearSmsLog}
        deleteLogRow={deleteLogRow}
        reload={loadDiagnostics}
        busy={diagBusy}
      />

      {/* ─── بطاقة الرصيد ─── */}
      <div className="bg-gradient-to-l from-blue-600 to-blue-800 text-white rounded-2xl p-6 mb-6 shadow-lg">
        <p className="text-blue-200 text-sm mb-1">الرصيد الحالي</p>

        {editingBalance ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              autoFocus
              type="number"
              value={balanceInput}
              onChange={e => setBalanceInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveBalance(); if (e.key === 'Escape') setEditingBalance(false); }}
              className="text-2xl font-bold bg-white/20 text-white rounded-lg px-3 py-1 w-48 outline-none border border-white/50"
            />
            <button onClick={saveBalance} className="p-2 bg-white/20 rounded-lg hover:bg-white/30"><Check size={18} /></button>
            <button onClick={() => setEditingBalance(false)} className="p-2 bg-white/20 rounded-lg hover:bg-white/30"><X size={18} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-3 mt-1">
            <span className="text-4xl font-bold">{fmt(bankItem.try_amount)} ₺</span>
            <button onClick={startEdit} className="p-2 bg-white/20 rounded-lg hover:bg-white/30" title="تعديل يدوي">
              <Pencil size={16} />
            </button>
          </div>
        )}

        <p className="text-blue-200 text-xs mt-3">{bankItem.name}</p>

        {/* إجماليات */}
        <div className="flex gap-6 mt-4 pt-4 border-t border-white/20 text-sm">
          <div>
            <p className="text-blue-200">إجمالي الوارد</p>
            <p className="font-bold text-green-300">+{fmt(totalIn)} ₺</p>
          </div>
          <div>
            <p className="text-blue-200">إجمالي الصادر</p>
            <p className="font-bold text-red-300">−{fmt(totalOut)} ₺</p>
          </div>
          <div>
            <p className="text-blue-200">عدد العمليات</p>
            <p className="font-bold">{transactions.length}</p>
          </div>
        </div>
      </div>

      {/* ─── سجل المعاملات ─── */}
      <div className="bg-white rounded-2xl shadow border border-gray-100">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-700">سجل المعاملات</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFiltersOpen(o => !o)}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                filtersActive
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
              title="فلترة"
            >
              <Filter size={14} />
              فلترة
              {filtersActive && (
                <span className="bg-emerald-600 text-white text-[10px] rounded-full px-1.5 py-0.5 leading-none">
                  {Object.values(filters).filter(v => String(v).trim() !== '').length}
                </span>
              )}
              {filtersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button onClick={loadData} className="text-gray-400 hover:text-gray-600 transition-colors">
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        {filtersOpen && (
          <div className="p-4 border-b border-gray-100 bg-gray-50/50">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="flex flex-col">
                <label className="text-xs text-gray-500 mb-1">من تاريخ</label>
                <input
                  type="date"
                  value={filters.from}
                  onChange={e => setFilters({ ...filters, from: e.target.value })}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-xs text-gray-500 mb-1">إلى تاريخ</label>
                <input
                  type="date"
                  value={filters.to}
                  onChange={e => setFilters({ ...filters, to: e.target.value })}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-xs text-gray-500 mb-1">الاتجاه</label>
                <select
                  value={filters.direction}
                  onChange={e => setFilters({ ...filters, direction: e.target.value })}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                >
                  <option value="">الكل</option>
                  <option value="in">وارد فقط</option>
                  <option value="out">صادر فقط</option>
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-xs text-gray-500 mb-1">أقل مبلغ ₺</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={filters.min_amount}
                  onChange={e => setFilters({ ...filters, min_amount: e.target.value })}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-xs text-gray-500 mb-1">أعلى مبلغ ₺</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={filters.max_amount}
                  onChange={e => setFilters({ ...filters, max_amount: e.target.value })}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  placeholder="∞"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-xs text-gray-500 mb-1">بحث (مرسِل/وصف)</label>
                <input
                  type="text"
                  value={filters.q}
                  onChange={e => setFilters({ ...filters, q: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') loadData(); }}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  placeholder="اسم / كلمة"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={loadData}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-lg text-sm"
              >
                تطبيق
              </button>
              <button
                onClick={resetFilters}
                disabled={!filtersActive}
                className="text-gray-500 hover:text-gray-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                مسح الفلتر
              </button>
              <span className="text-xs text-gray-400 mr-auto">
                {transactions.length} نتيجة
              </span>
            </div>
          </div>
        )}

        {transactions.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">
            {filtersActive
              ? 'لا توجد معاملات تطابق الفلتر الحالي'
              : 'لا توجد معاملات بعد — ستظهر هنا تلقائياً عند استقبال SMS من كويت ترك'}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {transactions.map(tx => (
              <div key={tx.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                {/* أيقونة الاتجاه */}
                <div className={`flex-shrink-0 ${tx.direction === 'in' ? 'text-green-500' : 'text-red-500'}`}>
                  {tx.direction === 'in'
                    ? <ArrowDownCircle size={22} />
                    : <ArrowUpCircle size={22} />
                  }
                </div>

                {/* التفاصيل */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-base ${tx.direction === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.direction === 'in' ? '+' : '−'}{fmt(tx.amount)} ₺
                    </span>
                    {tx.balance_after !== 0 && (
                      <span className="text-xs text-gray-400">← رصيد: {fmt(tx.balance_after)} ₺</span>
                    )}
                  </div>
                  {tx.sender_receiver && (
                    <p className="text-sm text-gray-600 truncate">
                      {tx.direction === 'in' ? 'من: ' : 'إلى: '}{tx.sender_receiver}
                    </p>
                  )}
                  {tx.description && (
                    <p className="text-xs text-gray-400 truncate">ملاحظة: {tx.description}</p>
                  )}
                  <p className="text-xs text-gray-300 mt-0.5">
                    {tx.transaction_time || tx.created_at}
                  </p>
                </div>

                {/* حذف */}
                <button
                  onClick={() => deleteTx(tx)}
                  className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors p-1"
                  title="حذف وتصحيح الرصيد"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── مكوّن لوحة التشخيص ──────────────────────────────────────────────────────
const STATUS_BADGE = {
  applied:      { label: 'تم التطبيق',       color: 'bg-green-50 text-green-700 border-green-200' },
  no_pattern:   { label: 'نمط غير معروف',    color: 'bg-orange-50 text-orange-700 border-orange-200' },
  no_bank_item: { label: 'لا بند بنكي',      color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  unauthorized: { label: 'سر خاطئ',          color: 'bg-red-50 text-red-700 border-red-200' },
  no_body:      { label: 'جسم فارغ',         color: 'bg-gray-50 text-gray-600 border-gray-200' },
};

function DiagnosticsPanel({
  open, setOpen, diag, smsLog,
  smsTestText, setSmsTestText, smsTestResult, smsTestBusy, runSmsTest,
  clearSmsLog, deleteLogRow, reload, busy,
}) {
  const lastLog = diag?.last_webhook_log;
  const lastLogAt = lastLog?.created_at;
  const minutesSince = lastLogAt
    ? Math.round((Date.now() - new Date(lastLogAt + 'Z').getTime()) / 60000)
    : null;

  return (
    <div className="bg-white rounded-2xl shadow border border-gray-100 mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="text-blue-500" size={20} />
          <span className="font-bold text-gray-700">تشخيص استقبال SMS</span>
          {!open && lastLog && (
            <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_BADGE[lastLog.parse_status]?.color || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              آخر طلب: {STATUS_BADGE[lastLog.parse_status]?.label || lastLog.parse_status}
              {minutesSince !== null && ` — قبل ${minutesSince} د`}
            </span>
          )}
          {!open && !lastLog && (
            <span className="text-xs px-2 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-200">
              لم يصل أي طلب بعد
            </span>
          )}
        </div>
        {open ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {/* ───── معلومات الحالة ───── */}
          {diag && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 text-xs mb-1">السر مضبوط</p>
                <p className={diag.secret_configured ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                  {diag.secret_configured ? <CheckCircle2 size={16} className="inline" /> : <AlertTriangle size={16} className="inline" />}
                  {' '}{diag.secret_configured ? 'نعم' : 'لا'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 text-xs mb-1">البنود البنكية</p>
                <p className="font-bold text-gray-700">
                  {(diag.bank_items || []).filter(i => i.is_active).length} / {(diag.bank_items || []).length}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 text-xs mb-1">آخر طلب</p>
                <p className="text-xs text-gray-600">
                  {lastLogAt ? `قبل ${minutesSince} د` : '—'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 text-xs mb-1">آخر معاملة</p>
                <p className="text-xs text-gray-600">
                  {diag.last_transaction?.created_at || '—'}
                </p>
              </div>
            </div>
          )}

          {/* تنبيه: لم يصل طلب منذ فترة طويلة */}
          {minutesSince !== null && minutesSince > 60 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
              <AlertTriangle size={16} className="inline ml-1" />
              لم يصل أي طلب منذ <strong>{minutesSince}</strong> دقيقة. تحقّق من تطبيق <strong>SMS Forwarder</strong> على الهاتف:
              <ul className="list-disc list-inside mt-1 mr-4 text-xs space-y-0.5">
                <li>هل التطبيق ما زال يعمل؟ (افتحه يدوياً)</li>
                <li>هل أزلت توفير البطارية له (Battery optimization → Don't optimize)؟</li>
                <li>هل هو في القائمة المسموح لها بالعمل في الخلفية؟</li>
                <li>جرّب إرسال SMS اختبار من رقم آخر إلى هاتف البنك للتأكّد من الاستقبال.</li>
              </ul>
            </div>
          )}

          {!diag?.secret_configured && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              <AlertTriangle size={16} className="inline ml-1" />
              متغيّر <code className="bg-red-100 px-1 rounded">SMS_WEBHOOK_SECRET</code> غير مضبوط في Railway. الـ webhook يعمل بدون حماية!
            </div>
          )}

          {/* ───── أداة اختبار يدوية ───── */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="font-bold text-gray-700 text-sm mb-2 flex items-center gap-2">
              <Play size={14} /> الصق نص رسالة SMS فعلية للاختبار
            </p>
            <textarea
              value={smsTestText}
              onChange={e => setSmsTestText(e.target.value)}
              placeholder="مثال: Hesabınıza FAST ile 1.500,00 TL para geldi. Gönderen: AHMET. Tutar: 1500,00 TL. İşlem Zamanı: ..."
              rows={4}
              className="w-full text-sm bg-white rounded p-2 border border-blue-300 outline-none focus:border-blue-500 font-mono"
              dir="ltr"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={runSmsTest}
                disabled={smsTestBusy || !smsTestText.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {smsTestBusy ? <RefreshCw size={14} className="inline animate-spin ml-1" /> : <Play size={14} className="inline ml-1" />}
                تشغيل
              </button>
              {smsTestResult && (
                <span className={`text-xs px-2 py-1 rounded ${smsTestResult.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {smsTestResult.ok ? 'نجح' : `فشل (${smsTestResult.status})`}
                </span>
              )}
            </div>
            {smsTestResult && (
              <pre className="mt-2 text-xs bg-white border border-blue-200 rounded p-2 overflow-x-auto" dir="ltr">
                {JSON.stringify(smsTestResult.data, null, 2)}
              </pre>
            )}
          </div>

          {/* ───── سجلّ الطلبات ───── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold text-gray-700 text-sm">سجلّ آخر {smsLog.length} طلب</p>
              <div className="flex items-center gap-2">
                <button onClick={reload} disabled={busy} className="text-gray-400 hover:text-gray-600">
                  <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
                </button>
                {smsLog.length > 0 && (
                  <button onClick={clearSmsLog} className="text-red-400 hover:text-red-600 text-xs">
                    تفريغ السجلّ
                  </button>
                )}
              </div>
            </div>
            {smsLog.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-6 bg-gray-50 rounded">
                لا توجد طلبات بعد. أرسل SMS تجريبية من تطبيق SMS Forwarder للتأكّد من وصولها.
              </p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {smsLog.map(row => {
                  const badge = STATUS_BADGE[row.parse_status] || { label: row.parse_status, color: 'bg-gray-100 text-gray-600 border-gray-200' };
                  return (
                    <div key={row.id} className="flex items-start gap-2 p-2 border border-gray-100 rounded hover:bg-gray-50 text-xs">
                      <span className={`flex-shrink-0 px-2 py-0.5 rounded border text-[10px] ${badge.color}`}>{badge.label}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-500 text-[10px]">
                          {row.created_at} • {row.sender || 'لا مُرسِل'} • {row.ip}
                        </p>
                        {row.error_message && (
                          <p className="text-red-600 text-[11px]">{row.error_message}</p>
                        )}
                        <p className="text-gray-700 break-all line-clamp-2" dir="ltr">{row.raw_body}</p>
                        {row.amount > 0 && (
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {row.direction === 'in' ? '⬇' : '⬆'} {row.amount} ₺
                            {row.transaction_id ? ` • TX #${row.transaction_id}` : ''}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => deleteLogRow(row.id)}
                        className="flex-shrink-0 text-gray-300 hover:text-red-500"
                        title="حذف من السجلّ"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── بطاقة مصدر رسائل البنك (Google Messages Web scraper) ─────────────────
const GMSG_STATE_LABELS = {
  idle:            { label: 'جاهز — اضغط بدء',           color: 'bg-gray-100 text-gray-700 border-gray-200',     icon: WifiOff },
  starting:        { label: 'يبدأ التشغيل ...',           color: 'bg-blue-50 text-blue-700 border-blue-200',      icon: RefreshCw },
  pairing:         { label: 'بحاجة إقران (امسح QR محلياً)', color: 'bg-orange-50 text-orange-700 border-orange-200', icon: AlertTriangle },
  opening_chat:    { label: 'يفتح محادثة KUVEYT TURK ...', color: 'bg-blue-50 text-blue-700 border-blue-200',      icon: RefreshCw },
  running:         { label: 'يعمل — يستطلع كل بضع ثوانٍ', color: 'bg-green-50 text-green-700 border-green-200',   icon: CheckCircle2 },
  session_expired: { label: 'انتهت الجلسة — أعد الإقران',  color: 'bg-orange-50 text-orange-700 border-orange-200', icon: AlertTriangle },
  error:           { label: 'خطأ',                        color: 'bg-red-50 text-red-700 border-red-200',         icon: AlertTriangle },
  stopped:         { label: 'متوقّف',                      color: 'bg-gray-100 text-gray-700 border-gray-200',     icon: WifiOff },
};

function minutesAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 60000);
}

function GmsgSourceCard({ status, sessionInfo, busy, onStart, onReload, onUploadSession, uploadBusy, uploadProgress }) {
  const reachable = !!status?.reachable;
  const state = reachable ? (status?.state || 'idle') : 'offline';
  const cfg = GMSG_STATE_LABELS[state] || { label: state, color: 'bg-gray-100 text-gray-600 border-gray-200', icon: WifiOff };
  const Icon = cfg.icon;

  const lastMsgMin = minutesAgo(status?.last_message_at);
  const lastSeenMin = minutesAgo(status?.last_seen_at);
  const sessionDaysAgo = sessionInfo?.uploaded_at
    ? Math.floor((Date.now() - new Date(sessionInfo.uploaded_at).getTime()) / (24 * 3600 * 1000))
    : null;
  const canStart = reachable && ['idle', 'stopped', 'error'].includes(state);
  const fileInputRef = useRef(null);

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (f) onUploadSession(f);
    e.target.value = ''; // اسمح بإعادة اختيار نفس الملف
  };

  return (
    <div className="bg-white rounded-2xl shadow border border-gray-100 mb-6 p-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="text-blue-600" size={20} />
          <h3 className="font-bold text-gray-700">مصدر الرسائل: Google Messages Web</h3>
        </div>
        <button
          onClick={onReload}
          className="text-gray-400 hover:text-gray-600"
          title="تحديث الحالة"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* شريط الحالة */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded border ${cfg.color} text-sm mb-3`}>
        {reachable
          ? <Icon size={16} className={state === 'starting' || state === 'opening_chat' ? 'animate-spin' : ''} />
          : <WifiOff size={16} />
        }
        <span className="font-bold">
          {reachable ? cfg.label : 'الخدمة غير متاحة'}
        </span>
        {!reachable && status?.error && (
          <span className="text-xs opacity-70 mr-auto">({status.error})</span>
        )}
      </div>

      {/* تفاصيل */}
      {reachable && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600 mb-3">
          <div className="bg-gray-50 rounded p-2">
            <p className="text-gray-400 mb-0.5">جهة الاتصال</p>
            <p className="font-bold text-gray-800">{status.target_contact || '—'}</p>
          </div>
          <div className="bg-gray-50 rounded p-2">
            <p className="text-gray-400 mb-0.5">رسائل معالَجة</p>
            <p className="font-bold text-gray-800">{status.messages_processed_total ?? 0}</p>
          </div>
          <div className="bg-gray-50 rounded p-2">
            <p className="text-gray-400 mb-0.5">آخر استطلاع</p>
            <p className="font-bold text-gray-800">
              {lastSeenMin === null ? '—' : lastSeenMin === 0 ? 'الآن' : `قبل ${lastSeenMin} د`}
            </p>
          </div>
          <div className="bg-gray-50 rounded p-2">
            <p className="text-gray-400 mb-0.5">آخر رسالة جديدة</p>
            <p className="font-bold text-gray-800">
              {lastMsgMin === null ? '—' : lastMsgMin === 0 ? 'الآن' : `قبل ${lastMsgMin} د`}
            </p>
          </div>
        </div>
      )}

      {/* معلومة الجلسة المرفوعة */}
      {sessionInfo?.uploaded_at ? (
        <div className="text-xs text-gray-500 mb-3 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-green-500" />
          آخر تجديد للجلسة: <strong className="text-gray-700">
            {sessionDaysAgo === 0 ? 'اليوم' : `قبل ${sessionDaysAgo} يوم`}
          </strong>
          <span className="text-gray-400">({new Date(sessionInfo.uploaded_at).toLocaleString('ar-EG')})</span>
        </div>
      ) : (
        <div className="text-xs text-orange-700 mb-3 bg-orange-50 border border-orange-200 rounded p-2">
          <AlertTriangle size={14} className="inline ml-1" />
          لم تُرفع جلسة Google Messages بعد على السيرفر. اتّبع الخطوات أدناه.
        </div>
      )}

      {/* تنبيهات */}
      {reachable && state === 'session_expired' && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-800 mb-3">
          <AlertTriangle size={14} className="inline ml-1" />
          جلسة Google Messages انتهت. أعِد التجديد بالخطوات في الأسفل.
        </div>
      )}

      {reachable && state === 'error' && status?.last_error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 mb-3">
          <AlertTriangle size={14} className="inline ml-1" />
          {status.last_error}
        </div>
      )}

      {/* عرض QR Live من شاشة Chromium (للإقران من الواجهة بدون أي ZIP) */}
      {reachable && ['pairing', 'session_expired'].includes(state) && (
        <GmsgPairingQR onReload={onReload} />
      )}

      {/* أزرار */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={onStart}
          disabled={busy || !canStart}
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? <RefreshCw size={14} className="inline animate-spin ml-1" /> : <Play size={14} className="inline ml-1" />}
          بدء / إعادة تشغيل
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={onPickFile}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadBusy}
          className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-40"
        >
          {uploadBusy
            ? <><RefreshCw size={14} className="inline animate-spin ml-1" /> جارٍ الرفع {uploadProgress}%</>
            : <><Upload size={14} className="inline ml-1" /> رفع / تجديد الجلسة (session.zip)</>
          }
        </button>
      </div>

      {/* شريط تقدّم الرفع */}
      {uploadBusy && (
        <div className="w-full bg-gray-100 rounded h-2 mb-3 overflow-hidden">
          <div
            className="bg-green-500 h-full transition-all"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {/* تعليمات التجديد — مطويّة */}
      <details className="text-xs text-gray-600 bg-gray-50 rounded p-2">
        <summary className="cursor-pointer font-bold text-gray-700">
          كيف أُجدّد الجلسة؟ (اتبع الخطوات عند انتهاء الجلسة)
        </summary>
        <ol className="list-decimal list-inside mt-2 mr-2 space-y-1 leading-relaxed">
          <li>على جهازك، افتح PowerShell:
            <pre className="bg-white border border-gray-200 rounded p-2 mt-1" dir="ltr">cd messages-scraper
Remove-Item -Recurse -Force browser-data
npm run spike</pre>
          </li>
          <li>ستفتح نافذة Chromium → سجّل دخول إلى Google → اربط Google Messages بـ QR من جوالك.</li>
          <li>بعد ظهور آخر رسالة في الـ console، اضغط Ctrl+C لإغلاق المتصفّح.</li>
          <li>اضغط المجلد إلى ملف <code className="bg-white border px-1">session.zip</code>:
            <pre className="bg-white border border-gray-200 rounded p-2 mt-1" dir="ltr">.\scripts\pack-session.ps1</pre>
          </li>
          <li>ارجع إلى هذه الصفحة → اضغط <strong>"رفع / تجديد الجلسة"</strong> → اختر <code className="bg-white border px-1">session.zip</code>.</li>
          <li>السيرفر سيستبدل الجلسة ويُعيد التشغيل تلقائياً. خلال ~30 ثانية تتحوّل الحالة لـ <strong>"يعمل"</strong>.</li>
        </ol>
      </details>
    </div>
  );
}

// ─── مكوّن متصفّح تفاعلي عن بُعد (لإتمام تسجيل دخول Google + الإقران) ──────
function GmsgPairingQR({ onReload }) {
  const [tick, setTick] = useState(Date.now());
  const [typing, setTyping] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const imgRef = useRef(null);

  // الـ viewport على السيرفر = 1024x768 (نفس clip في scraper.screenshot)
  const SRV_W = 1024;
  const SRV_H = 768;

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await api.get('/internal/bank-message/interact/url');
        setUrl(r.data?.url || '');
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const handleClick = async (e) => {
    if (busy || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const xRel = (e.clientX - rect.left) / rect.width;
    const yRel = (e.clientY - rect.top) / rect.height;
    const x = Math.round(xRel * SRV_W);
    const y = Math.round(yRel * SRV_H);
    setBusy(true);
    try {
      await api.post('/internal/bank-message/interact/click', { x, y });
      setTimeout(() => setTick(Date.now()), 600); // تحديث الصورة بعد النقر
    } catch (err) {
      toast.error('فشل النقر: ' + (err.response?.data?.error || err.message));
    } finally { setBusy(false); }
  };

  const sendType = async () => {
    if (!typing) return;
    setBusy(true);
    try {
      await api.post('/internal/bank-message/interact/type', { text: typing });
      setTyping('');
      setTimeout(() => setTick(Date.now()), 400);
    } catch (err) {
      toast.error('فشل: ' + (err.response?.data?.error || err.message));
    } finally { setBusy(false); }
  };

  const sendKey = async (key) => {
    setBusy(true);
    try {
      await api.post('/internal/bank-message/interact/key', { key });
      setTimeout(() => setTick(Date.now()), 600);
    } catch (err) {
      toast.error('فشل: ' + (err.response?.data?.error || err.message));
    } finally { setBusy(false); }
  };

  const sendScroll = async (dy) => {
    setBusy(true);
    try {
      await api.post('/internal/bank-message/interact/scroll', { dy });
      setTimeout(() => setTick(Date.now()), 400);
    } catch (err) {
      toast.error('فشل: ' + (err.response?.data?.error || err.message));
    } finally { setBusy(false); }
  };

  const gotoPairing = async () => {
    setBusy(true);
    try {
      // ينقل المتصفّح مباشرة لصفحة الإقران (تجاوُز welcome + تجنّب Google OAuth الذي يُحجب على Chromium)
      await api.post('/internal/bank-message/interact/goto', {
        url: 'https://messages.google.com/web/authentication',
      });
      setTimeout(() => setTick(Date.now()), 1500);
    } catch (err) {
      toast.error('فشل: ' + (err.response?.data?.error || err.message));
    } finally { setBusy(false); }
  };

  const gotoConversations = async () => {
    setBusy(true);
    try {
      await api.post('/internal/bank-message/interact/goto', {
        url: 'https://messages.google.com/web/conversations',
      });
      setTimeout(() => setTick(Date.now()), 1500);
    } catch (err) {
      toast.error('فشل: ' + (err.response?.data?.error || err.message));
    } finally { setBusy(false); }
  };

  const src = `/api/internal/bank-message/screenshot?t=${tick}`;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3" dir="rtl">
      <p className="text-sm font-bold text-blue-800 mb-2">
        🖥️ متصفّح Chromium على السيرفر (انقر على الصورة للتفاعل)
      </p>
      <p className="text-xs text-gray-700 mb-2 leading-relaxed">
        سجّل دخول إلى Google ← انتقل لـ Messages ← أكمِل الإقران (مطابقة الرقم).
        كل نقرة/ضغطة مفتاح تُنفَّذ على السيرفر مباشرة.
      </p>

      {url && (
        <div className="text-[10px] text-gray-500 mb-1 font-mono break-all" dir="ltr">{url}</div>
      )}

      <div className="flex flex-wrap gap-2 mb-2">
        <button onClick={gotoPairing} disabled={busy}
          className="bg-purple-600 text-white px-3 py-1.5 rounded text-sm hover:bg-purple-700 disabled:opacity-40">
          🔗 اذهب لشاشة الإقران (QR)
        </button>
        <button onClick={gotoConversations} disabled={busy}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm hover:bg-indigo-700 disabled:opacity-40">
          💬 افتح المحادثات
        </button>
      </div>

      <div
        className="bg-white border-2 border-blue-300 rounded overflow-hidden cursor-crosshair inline-block"
        style={{ maxWidth: '100%' }}
      >
        <img
          ref={imgRef}
          src={src}
          alt="Chromium remote view"
          onClick={handleClick}
          className="block select-none"
          style={{ maxWidth: '100%', height: 'auto', display: 'block', opacity: busy ? 0.6 : 1 }}
          draggable={false}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={typing}
          onChange={(e) => setTyping(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendType(); }}
          placeholder="اكتب نصاً (ثم Enter للإرسال)"
          className="flex-1 min-w-[180px] border border-blue-300 rounded px-2 py-1 text-sm"
          dir="ltr"
          disabled={busy}
        />
        <button onClick={sendType} disabled={busy || !typing}
          className="bg-blue-600 text-white px-3 py-1 rounded text-sm disabled:opacity-40">
          أرسل النصّ
        </button>
        <button onClick={() => sendKey('Enter')} disabled={busy}
          className="bg-gray-600 text-white px-3 py-1 rounded text-sm disabled:opacity-40">
          Enter
        </button>
        <button onClick={() => sendKey('Tab')} disabled={busy}
          className="bg-gray-600 text-white px-3 py-1 rounded text-sm disabled:opacity-40">
          Tab
        </button>
        <button onClick={() => sendKey('Backspace')} disabled={busy}
          className="bg-gray-600 text-white px-3 py-1 rounded text-sm disabled:opacity-40">
          ⌫
        </button>
        <button onClick={() => sendScroll(300)} disabled={busy}
          className="bg-gray-500 text-white px-2 py-1 rounded text-sm disabled:opacity-40">
          ↓ تمرير
        </button>
        <button onClick={() => sendScroll(-300)} disabled={busy}
          className="bg-gray-500 text-white px-2 py-1 rounded text-sm disabled:opacity-40">
          ↑ تمرير
        </button>
        <button onClick={() => setTick(Date.now())}
          className="text-blue-600 hover:underline text-xs mr-auto">
          تحديث الصورة الآن
        </button>
      </div>

      <p className="text-[11px] text-gray-500 mt-2">
        💡 الصورة تتحدّث تلقائياً كل 3 ثوان. بعد إتمام الإقران، الحالة تتحوّل لـ "يعمل".
      </p>
    </div>
  );
}
