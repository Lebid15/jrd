import { useState, useEffect, useCallback } from 'react';
import { CalendarRange, Trash2, ChevronDown, ChevronUp, RefreshCw, Plus, TrendingUp, TrendingDown, FileDown } from 'lucide-react';
import { toast } from 'react-toastify';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import api from '../api.js';

function formatMoney(n) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildMonthlyReportHtml(inv) {
  const itemsRows = (inv.items || [])
    .map((it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td class="name">${escapeHtml(it.item_name)}</td>
        <td>${formatMoney(it.try_amount)}</td>
        <td>${formatMoney(it.usd_amount)}</td>
        <td class="note">${escapeHtml(it.notes || '-')}</td>
      </tr>
    `).join('');

  const profitClass = Number(inv.period_profit || 0) >= 0 ? 'profit-positive' : 'profit-negative';

  return `
    <div class="report">
      <style>
        .report { direction: rtl; font-family: Tahoma, Arial, sans-serif; color: #0f172a;
          background: linear-gradient(145deg, #faf5ff, #f3e8ff); border: 1px solid #e9d5ff;
          border-radius: 18px; padding: 28px; }
        .header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
        .title { margin: 0; font-size: 30px; font-weight: 800; color: #6b21a8; }
        .sub { margin: 6px 0 0 0; color: #475569; font-size: 14px; }
        .badge { background: #f3e8ff; color: #6b21a8; padding: 10px 16px; border-radius: 999px;
          font-weight: 700; font-size: 14px; border: 1px solid #e9d5ff; }
        .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 14px 0 20px 0; }
        @media (max-width: 1100px) { .summary { grid-template-columns: repeat(3, 1fr); } }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
        .card .label { color: #64748b; font-size: 12px; margin-bottom: 4px; }
        .card .value { font-size: 20px; font-weight: 700; }
        .profit-positive { color: #15803d; }
        .profit-negative { color: #dc2626; }
        .table-wrap { background: white; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        thead tr { background: #6b21a8; color: white; }
        th, td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; vertical-align: top; }
        tbody tr:nth-child(even) { background: #faf5ff; }
        td.name, td.note { text-align: right; word-break: break-word; }
        .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0 16px 0; }
        .meta .m { background: white; border: 1px dashed #c4b5fd; border-radius: 8px; padding: 8px 10px; font-size: 12px; color: #475569; }
        .meta .m b { color: #6b21a8; }
        .footer { margin-top: 14px; color: #64748b; font-size: 12px; text-align: center; }
      </style>

      <div class="header">
        <div>
          <h1 class="title">تقرير الجرد الشهري</h1>
          <p class="sub">JRD Monthly Report</p>
        </div>
        <div class="badge">${escapeHtml(inv.date)}</div>
      </div>

      <div class="meta">
        <div class="m">عدد الجرود اليومية في الفترة: <b>${inv.daily_count || 0}</b></div>
        <div class="m">بداية الفترة: <b>${escapeHtml(inv.period_from || '—')}</b></div>
        <div class="m">نهاية الفترة: <b>${escapeHtml(inv.period_to || '—')}</b></div>
      </div>

      <div class="summary">
        <div class="card">
          <div class="label">مجموع الليرة التركية</div>
          <div class="value">₺${formatMoney(inv.total_try)}</div>
        </div>
        <div class="card">
          <div class="label">سعر الصرف</div>
          <div class="value">${formatMoney(inv.exchange_rate)}</div>
        </div>
        <div class="card">
          <div class="label">رأس المال (الإجمالي)</div>
          <div class="value">$${formatMoney(inv.total_converted_usd)}</div>
        </div>
        <div class="card">
          <div class="label">الجرد الشهري السابق</div>
          <div class="value">$${formatMoney(inv.previous_total_usd)}</div>
        </div>
        <div class="card">
          <div class="label">ربح الفترة</div>
          <div class="value ${profitClass}">$${formatMoney(inv.period_profit)}</div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>البند</th><th>TRY ₺</th><th>USD $</th><th>ملاحظات</th></tr>
          </thead>
          <tbody>${itemsRows || '<tr><td colspan="5">لا توجد بنود</td></tr>'}</tbody>
        </table>
      </div>

      <div class="footer">Generated by JRD System</div>
    </div>
  `;
}

export default function MonthlyArchive() {
  const [inventories, setInventories] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [exportingId, setExportingId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, prev] = await Promise.all([
        api.get('/monthly?limit=100'),
        api.get('/monthly/preview/next'),
      ]);
      setInventories(list.data.inventories || []);
      setTotal(list.data.total || 0);
      setPreview(prev.data || null);
    } catch {
      toast.error('خطأ في تحميل الجرود الشهرية');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!preview) return;
    const msg = preview.is_first
      ? 'هذا أوّل جرد شهري. سيُحفظ snapshot لرأس المال الحالي فقط (الفترة السابقة فارغة).\n\nتأكيد؟'
      : `سيُحفظ جرد شهري جديد:\n• رأس المال الحالي: $${formatMoney(preview.total_converted_usd)}\n• مجموع أرباح ${preview.daily_count} جرد يومي منذ آخر جرد شهري: $${formatMoney(preview.period_profit)}\n\nتأكيد؟`;
    if (!confirm(msg)) return;

    setCreating(true);
    try {
      const res = await api.post('/monthly');
      toast.success(res.data.is_first
        ? 'تم حفظ أوّل جرد شهري'
        : `تم الحفظ — ربح الفترة: $${formatMoney(res.data.period_profit)}`);
      loadData();
    } catch (e) {
      toast.error(e.response?.data?.error || 'فشل الحفظ');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('حذف هذا الجرد الشهري؟')) return;
    try {
      await api.delete(`/monthly/${id}`);
      toast.success('تم الحذف');
      if (expanded === id) { setExpanded(null); setExpandedData(null); }
      loadData();
    } catch {
      toast.error('فشل الحذف');
    }
  };

  const toggleExpand = async (id) => {
    if (expanded === id) {
      setExpanded(null);
      setExpandedData(null);
      return;
    }
    try {
      const res = await api.get(`/monthly/${id}`);
      setExpanded(id);
      setExpandedData(res.data);
    } catch {
      toast.error('فشل تحميل التفاصيل');
    }
  };

  const exportPdf = async (inv) => {
    setExportingId(inv.id);
    try {
      let detail = inv;
      if (!inv.items) {
        const res = await api.get(`/monthly/${inv.id}`);
        detail = res.data;
      }
      // Render hidden node, screenshot, generate PDF
      const wrap = document.createElement('div');
      wrap.style.position = 'fixed';
      wrap.style.right = '-10000px';
      wrap.style.top = '0';
      wrap.style.width = '900px';
      wrap.style.background = 'white';
      wrap.innerHTML = buildMonthlyReportHtml(detail);
      document.body.appendChild(wrap);
      const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff' });
      document.body.removeChild(wrap);

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - 10;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let position = 5;
      if (imgHeight <= pageHeight - 10) {
        pdf.addImage(imgData, 'PNG', 5, position, imgWidth, imgHeight);
      } else {
        // multi-page
        let remaining = imgHeight;
        let sourceY = 0;
        const ratio = canvas.width / imgWidth;
        while (remaining > 0) {
          const pageImgHeight = Math.min(pageHeight - 10, remaining);
          const sourceH = pageImgHeight * ratio;
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = sourceH;
          const ctx = pageCanvas.getContext('2d');
          ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceH, 0, 0, canvas.width, sourceH);
          pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 5, 5, imgWidth, pageImgHeight);
          remaining -= pageImgHeight;
          sourceY += sourceH;
          if (remaining > 0) pdf.addPage();
        }
      }
      pdf.save(`monthly-${detail.date}-${detail.id}.pdf`);
    } catch (e) {
      console.error(e);
      toast.error('فشل تصدير PDF');
    } finally {
      setExportingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="animate-spin-slow text-purple-600" size={48} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-5xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <CalendarRange className="text-purple-600" size={28} />
            الجرد الشهري
          </h2>
          <p className="text-gray-500 mt-1 text-sm">{total} جرد محفوظ</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm"
          >
            <RefreshCw size={16} />
            تحديث
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-bold disabled:opacity-50"
          >
            <Plus size={18} />
            {creating ? 'جارٍ...' : 'إنشاء جرد شهري'}
          </button>
        </div>
      </div>

      {/* Preview card */}
      {preview && (
        <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 border border-purple-200 rounded-2xl p-5 mb-6 shadow-sm">
          <h3 className="font-bold text-purple-900 mb-3 flex items-center gap-2">
            🔮 معاينة الجرد الشهري التالي
            {preview.is_first && (
              <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-normal">
                أوّل مرّة
              </span>
            )}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <PreviewCard label="رأس المال الحالي" value={`$${formatMoney(preview.total_converted_usd)}`} />
            <PreviewCard label="الجرد الشهري السابق" value={`$${formatMoney(preview.previous_total_usd)}`} />
            <PreviewCard
              label={`أرباح ${preview.daily_count} جرد يومي`}
              value={`$${formatMoney(preview.period_profit)}`}
              positive={preview.period_profit >= 0}
              showSign
            />
            <PreviewCard label="عدد البنود" value={preview.items_count} />
          </div>
          {preview.is_first && (
            <p className="text-xs text-purple-700 mt-3 bg-purple-100/50 rounded-lg px-3 py-2">
              💡 لا يوجد جرد شهري سابق — أوّل حفظ سيكون snapshot لرأس المال فقط، وربح الفترة = 0.
            </p>
          )}
        </div>
      )}

      {/* List */}
      {inventories.length === 0 ? (
        <div className="bg-white rounded-2xl shadow border border-gray-100 p-10 text-center">
          <CalendarRange className="mx-auto text-gray-300 mb-3" size={48} />
          <p className="text-gray-500">لا توجد جرود شهرية بعد. اضغط "إنشاء جرد شهري" للبدء.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {inventories.map(inv => {
            const isOpen = expanded === inv.id;
            const profit = Number(inv.period_profit || 0);
            const isPos = profit >= 0;
            return (
              <div key={inv.id} className="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <button
                    onClick={() => toggleExpand(inv.id)}
                    className="flex items-center gap-2 text-purple-700 hover:text-purple-900"
                    title="تفاصيل"
                  >
                    {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  <div className="flex-1 min-w-[140px]">
                    <div className="font-bold text-gray-800">{inv.date}</div>
                    <div className="text-xs text-gray-400">{inv.created_at}</div>
                  </div>
                  <Stat label="رأس المال" value={`$${formatMoney(inv.total_converted_usd)}`} />
                  <Stat label="السابق" value={`$${formatMoney(inv.previous_total_usd)}`} />
                  <Stat
                    label="ربح الفترة"
                    value={`${isPos ? '+' : ''}$${formatMoney(profit)}`}
                    color={isPos ? 'text-emerald-700' : 'text-rose-700'}
                    icon={isPos ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  />
                  <Stat label="جرود مضمَّنة" value={inv.daily_count} />
                  <button
                    onClick={() => exportPdf(inv)}
                    disabled={exportingId === inv.id}
                    className="text-indigo-500 hover:text-indigo-700 disabled:opacity-50"
                    title="تصدير PDF"
                  >
                    <FileDown size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(inv.id)}
                    className="text-gray-300 hover:text-red-600"
                    title="حذف"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {isOpen && expandedData?.id === inv.id && (
                  <div className="border-t border-gray-100 bg-gray-50/30 p-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
                      <Meta label="سعر الصرف" value={formatMoney(expandedData.exchange_rate)} />
                      <Meta label="مجموع ₺" value={formatMoney(expandedData.total_try)} />
                      <Meta label="مجموع $" value={formatMoney(expandedData.total_usd)} />
                      <Meta label="الفترة" value={`${expandedData.period_from?.slice(0, 10) || '—'} ← ${expandedData.period_to?.slice(0, 10) || '—'}`} />
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-purple-50 text-purple-900 text-xs">
                          <tr>
                            <th className="py-2 px-3 text-right">#</th>
                            <th className="py-2 px-3 text-right">البند</th>
                            <th className="py-2 px-3 text-center">TRY ₺</th>
                            <th className="py-2 px-3 text-center">USD $</th>
                            <th className="py-2 px-3 text-right">ملاحظات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(expandedData.items || []).map((it, i) => (
                            <tr key={it.id} className="border-t border-gray-100">
                              <td className="py-1.5 px-3 text-gray-400">{i + 1}</td>
                              <td className="py-1.5 px-3 font-medium">{it.item_name}</td>
                              <td className="py-1.5 px-3 text-center font-mono">{formatMoney(it.try_amount)}</td>
                              <td className="py-1.5 px-3 text-center font-mono">{formatMoney(it.usd_amount)}</td>
                              <td className="py-1.5 px-3 text-xs text-gray-500">{it.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = 'text-gray-800', icon }) {
  return (
    <div className="text-center min-w-[90px]">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className={`text-sm font-bold flex items-center gap-1 justify-center ${color}`}>
        {icon}{value}
      </div>
    </div>
  );
}

function PreviewCard({ label, value, positive, showSign }) {
  const color = showSign
    ? (positive ? 'text-emerald-700' : 'text-rose-700')
    : 'text-purple-900';
  return (
    <div className="bg-white rounded-xl border border-purple-100 p-3">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className="font-mono text-gray-700">{value}</div>
    </div>
  );
}
