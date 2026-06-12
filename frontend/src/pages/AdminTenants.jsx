import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Plus, Pencil, Trash2, RefreshCw, Building2, Power, KeyRound, Copy } from 'lucide-react';
import api from '../api.js';

export default function AdminTenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTenant, setEditTenant] = useState(null);
  const [secretTenant, setSecretTenant] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/tenants');
      setTenants(r.data);
    } catch (e) {
      toast.error('فشل تحميل المستأجرين: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (t) => {
    if (!window.confirm(`حذف المستأجر "${t.name}" وكل بياناته؟ لا يمكن التراجع.`)) return;
    try {
      await api.delete(`/admin/tenants/${t.id}`);
      toast.success('تم الحذف');
      load();
    } catch (e) {
      toast.error('فشل الحذف: ' + (e.response?.data?.error || e.message));
    }
  };

  const toggleActive = async (t) => {
    try {
      await api.patch(`/admin/tenants/${t.id}`, { is_active: !t.is_active });
      load();
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    }
  };

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-emerald-800 flex items-center gap-2">
          <Building2 /> المستأجرون
        </h1>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 bg-white border rounded-lg hover:bg-gray-50 flex items-center gap-1">
            <RefreshCw size={16} /> تحديث
          </button>
          <button onClick={() => setShowCreate(true)} className="px-3 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 flex items-center gap-1">
            <Plus size={16} /> مستأجر جديد
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
                <th className="p-3">الاسم</th>
                <th className="p-3">المُعرّف (slug)</th>
                <th className="p-3 text-center">الحالة</th>
                <th className="p-3 text-center">المستخدمون</th>
                <th className="p-3 text-center">البنود</th>
                <th className="p-3">ملاحظات</th>
                <th className="p-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-gray-600">{t.id}</td>
                  <td className="p-3 font-semibold">{t.name}</td>
                  <td className="p-3 font-mono text-xs text-gray-700">{t.slug}</td>
                  <td className="p-3 text-center">
                    {t.is_active
                      ? <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs">نشط</span>
                      : <span className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs">معطّل</span>}
                  </td>
                  <td className="p-3 text-center">{t.users_count}</td>
                  <td className="p-3 text-center">{t.items_count}</td>
                  <td className="p-3 text-gray-600 truncate max-w-xs">{t.notes || '-'}</td>
                  <td className="p-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => toggleActive(t)} className="p-1.5 hover:bg-amber-100 text-amber-700 rounded" title={t.is_active ? 'تعطيل' : 'تفعيل'}>
                        <Power size={16} />
                      </button>
                      <button onClick={() => setSecretTenant(t)} className="p-1.5 hover:bg-purple-100 text-purple-700 rounded" title="سر webhook SMS">
                        <KeyRound size={16} />
                      </button>
                      <button onClick={() => setEditTenant(t)} className="p-1.5 hover:bg-blue-100 text-blue-700 rounded" title="تعديل">
                        <Pencil size={16} />
                      </button>
                      {t.id !== 1 && (
                        <button onClick={() => remove(t)} className="p-1.5 hover:bg-red-100 text-red-700 rounded" title="حذف">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-gray-500">لا يوجد مستأجرون</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {editTenant && <EditTenantModal tenant={editTenant} onClose={() => setEditTenant(null)} onSaved={() => { setEditTenant(null); load(); }} />}
      {secretTenant && <WebhookSecretModal tenant={secretTenant} onClose={() => setSecretTenant(null)} />}
    </div>
  );
}

function CreateTenantModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [notes, setNotes] = useState('');
  const [createOwner, setCreateOwner] = useState(true);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.warn('الاسم مطلوب');
    setBusy(true);
    try {
      const body = { name: name.trim(), notes: notes.trim() };
      if (slug.trim()) body.slug = slug.trim();
      if (createOwner) {
        if (!ownerEmail.trim() || ownerPassword.length < 8) {
          setBusy(false);
          return toast.warn('يجب إدخال إيميل + كلمة سرّ ≥ 8 أحرف للمالك');
        }
        body.owner_email = ownerEmail.trim();
        body.owner_password = ownerPassword;
      }
      const r = await api.post('/admin/tenants', body);
      toast.success(`أُنشئ "${r.data.tenant.name}"${r.data.owner ? ' + المالك' : ''}`);
      onCreated();
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="مستأجر جديد" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="الاسم *" value={name} onChange={setName} />
        <Field label="المُعرّف slug (اختياري — يُولَّد تلقائياً)" value={slug} onChange={setSlug} placeholder="مثل: acme" mono />
        <Field label="ملاحظات" value={notes} onChange={setNotes} textarea />
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={createOwner} onChange={e => setCreateOwner(e.target.checked)} />
          <span>إنشاء حساب مالك (owner) فوراً</span>
        </label>
        {createOwner && (
          <>
            <Field label="إيميل المالك" value={ownerEmail} onChange={setOwnerEmail} type="email" />
            <Field label="كلمة سرّ المالك (≥ 8 أحرف)" value={ownerPassword} onChange={setOwnerPassword} type="password" />
          </>
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

function EditTenantModal({ tenant, onClose, onSaved }) {
  const [name, setName] = useState(tenant.name);
  const [notes, setNotes] = useState(tenant.notes || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/admin/tenants/${tenant.id}`, { name: name.trim(), notes: notes.trim() });
      toast.success('تم الحفظ');
      onSaved();
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`تعديل: ${tenant.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="الاسم" value={name} onChange={setName} />
        <Field label="ملاحظات" value={notes} onChange={setNotes} textarea />
        <div className="text-sm text-gray-500">المُعرّف (slug): <span className="font-mono">{tenant.slug}</span> — لا يمكن تغييره</div>
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

function Field({ label, value, onChange, type = 'text', placeholder = '', textarea = false, mono = false }) {
  const cls = `w-full border rounded px-3 py-2 ${mono ? 'font-mono text-sm' : ''}`;
  return (
    <div>
      <label className="block text-sm font-semibold mb-1 text-gray-700">{label}</label>
      {textarea
        ? <textarea value={value} onChange={e => onChange(e.target.value)} className={cls} rows={2} placeholder={placeholder} />
        : <input type={type} value={value} onChange={e => onChange(e.target.value)} className={cls} placeholder={placeholder} />}
    </div>
  );
}

function WebhookSecretModal({ tenant, onClose }) {
  const [status, setStatus] = useState(null);
  const [newSecret, setNewSecret] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/admin/tenants/${tenant.id}/webhook-status`)
      .then(r => setStatus(r.data))
      .catch(e => toast.error('فشل: ' + (e.response?.data?.error || e.message)));
  }, [tenant.id]);

  const rotate = async () => {
    if (status?.configured && !window.confirm('تدوير الـ secret يُوقف الـ URL القديم فوراً. هل أنت متأكد؟')) return;
    setBusy(true);
    try {
      const r = await api.post(`/admin/tenants/${tenant.id}/rotate-webhook-secret`);
      setNewSecret(r.data);
      setStatus({ configured: true, last_rotated_at: new Date().toISOString() });
      toast.success('تم التوليد');
    } catch (e) {
      toast.error('فشل: ' + (e.response?.data?.error || e.message));
    } finally {
      setBusy(false);
    }
  };

  const copy = (txt) => {
    navigator.clipboard.writeText(txt).then(
      () => toast.info('نُسخ'),
      () => toast.warn('فشل النسخ — انسخ يدوياً'),
    );
  };

  const baseUrl = window.location.origin;

  return (
    <Modal title={`Webhook SMS — ${tenant.name}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {status === null ? (
          <div className="text-gray-500">جارٍ التحميل…</div>
        ) : status.configured ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
            <div className="font-semibold text-emerald-800">✓ مُعدّ</div>
            <div className="text-xs text-emerald-700 mt-1">
              آخر تدوير: {new Date(status.last_rotated_at).toLocaleString('ar')}
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-amber-800">
            ⚠ لا يوجد secret لهذا المستأجر بعد. اضغط "توليد" أدناه.
          </div>
        )}

        {newSecret && (
          <div className="bg-purple-50 border border-purple-300 rounded p-3 space-y-2">
            <div className="text-purple-900 font-bold">⚠ احفظ الـ URL الآن — لن يظهر ثانية</div>
            <div className="bg-white border rounded p-2 font-mono text-xs break-all">
              {baseUrl + newSecret.webhook_path}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => copy(baseUrl + newSecret.webhook_path)}
                className="px-3 py-1.5 bg-purple-700 text-white rounded text-xs flex items-center gap-1 hover:bg-purple-800"
              >
                <Copy size={14} /> نسخ الـ URL
              </button>
              <button
                type="button"
                onClick={() => copy(newSecret.secret)}
                className="px-3 py-1.5 bg-white border border-purple-300 text-purple-800 rounded text-xs flex items-center gap-1 hover:bg-purple-50"
              >
                <Copy size={14} /> نسخ الـ secret فقط
              </button>
            </div>
            <div className="text-xs text-purple-700">
              ضع هذا الـ URL في تطبيق SMS Forwarder على جوال المستأجر.
            </div>
          </div>
        )}

        <div className="flex justify-between pt-2 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-gray-50">إغلاق</button>
          <button
            onClick={rotate}
            disabled={busy}
            className="px-4 py-2 bg-purple-700 text-white rounded hover:bg-purple-800 disabled:opacity-50 flex items-center gap-1"
          >
            <RefreshCw size={16} /> {status?.configured ? 'تدوير' : 'توليد'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
