import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, LogOut, Smartphone, Wifi, WifiOff, MessageSquare } from 'lucide-react';
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
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

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
    try {
      const res = await api.get('/internal/whatsapp/messages?limit=30');
      setMessages(res.data);
    } catch {}
  }, []);

  useEffect(() => {
    loadStatus();
    loadMessages();
    // تحديث تلقائي كل 5 ثوانٍ لو في حالة QR أو connecting
    const interval = setInterval(() => {
      loadStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  // لما تتغير الحالة لـ connected، حمّل الرسائل
  useEffect(() => {
    if (status.state === 'connected') loadMessages();
  }, [status.state, loadMessages]);

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
        </div>
      </div>

      {/* ─── آخر الرسائل ─── */}
      {messages.length > 0 && (
        <div className="bg-white rounded-2xl shadow border border-gray-100">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-700">آخر الرسائل الواردة</h2>
            <button onClick={loadMessages} className="text-gray-400 hover:text-gray-600">
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {messages.map(msg => (
              <div key={msg.id} className="px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium truncate max-w-[160px]">
                    {msg.group_name || msg.group_id}
                  </span>
                  <span className="text-xs text-gray-400">{msg.sender_name || msg.sender}</span>
                </div>
                <p className="text-sm text-gray-700 truncate">{msg.text}</p>
                <p className="text-xs text-gray-300 mt-0.5">{msg.created_at}</p>
              </div>
            ))}
          </div>
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
