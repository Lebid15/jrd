import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Plus, Pencil, Trash2, RefreshCw, Users, Power, KeyRound, LogOut as LogOutIcon } from 'lucide-react';
import api from '../api.js';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [filterTenant, setFilterTenant] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const url = filterTenant ? `/admin/users?tenant_id=${filterTenant}` : '/admin/users';
      const [u, t] = await Promise.all([api.get(url), api.get('/admin/tenants')]);
      setUsers(u.data);
      setTenants(t.data);
    } catch (e) {
      toast.error('فشل التحميل: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filterTenant]);

  const remove = async (u) => {
    if (!window.confirm(`حذف المستخدم "${u.email}"؟`)) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast.success('تم الحذف');
      load();
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active });
      load();
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    }
  };

  const revokeSessions = async (u) => {
    if (!window.confirm(`قطع كل جلسات "${u.email}"؟ سيُجبر على تسجيل الدخول مجدداً.`)) return;
    try {
      const r = await api.post(`/admin/users/${u.id}/revoke-sessions`);
      toast.success(`أُلغيت ${r.data.revoked} جلسة`);
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    }
  };

  return (
    <div dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-bold text-emerald-800 flex items-center gap-2">
          <Users /> المستخدمون
        </h1>
        <div className="flex gap-2 items-center">
          <select value={filterTenant} onChange={e => setFilterTenant(e.target.value)} className="border rounded px-2 py-2 text-sm">
            <option value="">كل المستأجرين</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.name} (#{t.id})</option>
            ))}
          </select>
          <button onClick={load} className="px-3 py-2 bg-white border rounded-lg hover:bg-gray-50 flex items-center gap-1">
            <RefreshCw size={16} /> تحديث
          </button>
          <button onClick={() => setShowCreate(true)} className="px-3 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 flex items-center gap-1">
            <Plus size={16} /> مستخدم جديد
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-8">جارٍ التحميل…</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-emerald-50 text-emerald-900 text-right">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">الإيميل</th>
                <th className="p-3">الدور</th>
                <th className="p-3">المستأجر</th>
                <th className="p-3 text-center">الحالة</th>
                <th className="p-3">آخر دخول</th>
                <th className="p-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-gray-600">{u.id}</td>
                  <td className="p-3 font-semibold">{u.email}</td>
                  <td className="p-3">
                    {u.role === 'admin'
                      ? <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs">admin</span>
                      : <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">owner</span>}
                  </td>
                  <td className="p-3">{u.tenant_name || <span className="text-gray-400">—</span>}</td>
                  <td className="p-3 text-center">
                    {u.is_active
                      ? <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs">نشط</span>
                      : <span className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs">معطّل</span>}
                  </td>
                  <td className="p-3 text-xs text-gray-600">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('ar-EG') : '-'}</td>
                  <td className="p-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => toggleActive(u)} className="p-1.5 hover:bg-amber-100 text-amber-700 rounded" title={u.is_active ? 'تعطيل' : 'تفعيل'}>
                        <Power size={16} />
                      </button>
                      <button onClick={() => setEditUser(u)} className="p-1.5 hover:bg-blue-100 text-blue-700 rounded" title="تعديل">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => revokeSessions(u)} className="p-1.5 hover:bg-orange-100 text-orange-700 rounded" title="قطع الجلسات">
                        <LogOutIcon size={16} />
                      </button>
                      <button onClick={() => remove(u)} className="p-1.5 hover:bg-red-100 text-red-700 rounded" title="حذف">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-gray-500">لا يوجد مستخدمون</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateUserModal tenants={tenants} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSaved={() => { setEditUser(null); load(); }} />}
    </div>
  );
}

function CreateUserModal({ tenants, onClose, onCreated }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('owner');
  const [tenantId, setTenantId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || password.length < 8) return toast.warn('إيميل + كلمة سرّ ≥ 8 أحرف');
    if (role === 'owner' && !tenantId) return toast.warn('اختَر المستأجر للـ owner');
    setBusy(true);
    try {
      const body = { email: email.trim(), password, role };
      if (role === 'owner') body.tenant_id = Number(tenantId);
      await api.post('/admin/users', body);
      toast.success('أُنشئ المستخدم');
      onCreated();
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="مستخدم جديد" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="الإيميل" value={email} onChange={setEmail} type="email" />
        <Field label="كلمة السرّ (≥ 8 أحرف)" value={password} onChange={setPassword} type="password" />
        <div>
          <label className="block text-sm font-semibold mb-1">الدور</label>
          <select value={role} onChange={e => setRole(e.target.value)} className="w-full border rounded px-3 py-2">
            <option value="owner">owner (مالك مستأجر)</option>
            <option value="admin">admin (مدير الموقع)</option>
          </select>
        </div>
        {role === 'owner' && (
          <div>
            <label className="block text-sm font-semibold mb-1">المستأجر</label>
            <select value={tenantId} onChange={e => setTenantId(e.target.value)} className="w-full border rounded px-3 py-2">
              <option value="">— اختر —</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} (#{t.id})</option>)}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200">إلغاء</button>
          <button type="submit" disabled={busy} className="px-4 py-2 bg-emerald-700 text-white rounded hover:bg-emerald-800 disabled:opacity-50">
            {busy ? 'جارٍ…' : 'إنشاء'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onSaved }) {
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {};
      if (email !== user.email) body.email = email.trim();
      if (password) {
        if (password.length < 8) {
          setBusy(false);
          return toast.warn('كلمة السرّ ≥ 8 أحرف');
        }
        body.password = password;
      }
      if (!Object.keys(body).length) {
        setBusy(false);
        return toast.info('لا تغييرات');
      }
      await api.patch(`/admin/users/${user.id}`, body);
      toast.success(password ? 'تم — أُلغيت كل جلسات المستخدم' : 'تم الحفظ');
      onSaved();
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`تعديل: ${user.email}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="الإيميل" value={email} onChange={setEmail} type="email" />
        <Field label="كلمة سرّ جديدة (اتركها فارغة لعدم التغيير)" value={password} onChange={setPassword} type="password" />
        {password && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-2 rounded flex gap-2 items-start">
            <KeyRound size={14} className="mt-0.5 flex-shrink-0" />
            <span>تغيير كلمة السرّ سيُلغي كل جلسات المستخدم النشطة.</span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200">إلغاء</button>
          <button type="submit" disabled={busy} className="px-4 py-2 bg-emerald-700 text-white rounded hover:bg-emerald-800 disabled:opacity-50">
            {busy ? 'جارٍ…' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()} dir="rtl">
        <h2 className="text-xl font-bold text-emerald-800 mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-sm font-semibold mb-1 text-gray-700">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full border rounded px-3 py-2" />
    </div>
  );
}
