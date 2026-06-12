import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { LogIn, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const from = params.get('from') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setErr('');
    if (!email || !password) {
      setErr('الرجاء إدخال البريد وكلمة السرّ');
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast.success('تم تسجيل الدخول');
      navigate(from, { replace: true });
    } catch (e2) {
      const status = e2?.response?.status;
      const msg = e2?.response?.data?.error || e2?.message || 'فشل تسجيل الدخول';
      if (status === 429) setErr('محاولات كثيرة. حاول بعد قليل.');
      else if (status === 401) setErr('بيانات الدخول غير صحيحة');
      else setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-emerald-100 p-4" dir="rtl">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-l from-emerald-800 to-emerald-700 text-white p-6 text-center">
          <h1 className="text-2xl font-bold">الجرد اليومي</h1>
          <p className="text-emerald-100 text-sm mt-1">نظام إدارة الحسابات</p>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
            <input
              type="email"
              dir="ltr"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">كلمة السرّ</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                dir="ltr"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 pl-10 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          {err && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
            {busy ? 'جارٍ الدخول...' : 'دخول'}
          </button>
        </form>
      </div>
    </div>
  );
}
