import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, ArrowDownCircle, ArrowUpCircle, Pencil, Check, X } from 'lucide-react';
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

  // ─── تحميل البيانات ─────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, txRes] = await Promise.all([
        api.get('/items'),
        api.get('/bank/transactions?limit=100'),
      ]);

      const bank = itemsRes.data.find(i => i.type === 'bank');
      setBankItem(bank || null);
      setTransactions(txRes.data);
    } catch {
      toast.error('خطأ في تحميل بيانات البنك');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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
          <button onClick={loadData} className="text-gray-400 hover:text-gray-600 transition-colors">
            <RefreshCw size={18} />
          </button>
        </div>

        {transactions.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">
            لا توجد معاملات بعد — ستظهر هنا تلقائياً عند استقبال SMS من كويت ترك
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
