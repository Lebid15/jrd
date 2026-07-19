import fetch from 'node-fetch';

// ════════════════════════════════════════════════════════════════════════════
// مزوّدو أسعار الباقات — يجلبون كتالوج المنتجات + الأسعار (وليس الرصيد فقط).
// كل adapter يُرجع مصفوفة بالشكل الموحّد:
//   { external_ref, name, category, denomination, price, currency, is_available, match_key }
// ════════════════════════════════════════════════════════════════════════════

// ينظّف النصّ من وسوم HTML وكيانات الترميز (بعض باقات znet تحوي HTML في adi).
export function cleanText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.\-–—_|]+/, '')   // نقاط/شرطات زائدة في البداية
    .replace(/[\s.\-–—_|]+$/, '')   // ونهايةً
    .trim();
}

// يبني مفتاح مطابقة موحّد لمقارنة الباقة نفسها عبر عدة مصادر.
// ملاحظة: في znet حقل kupur (denomination) غير موثوق (قد يتكرّر لباقات مختلفة)
// و external_ref ليس ثابتاً بين المواقع. المعرّف الموثوق الوحيد هو الاسم (adi)
// لأن كل مواقع znet تستخدم نفس البرمجية ونفس أسماء الباقات.
export function makeMatchKey({ game, denomination, name }) {
  const base = (name && String(name).trim())
    ? cleanText(name)
    : [cleanText(game), denomination].filter(Boolean).join(' ');
  return String(base)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[^a-z0-9؀-ۿ]+/g, ''); // إزالة كل الفواصل (مسافات/نقاط) → مطابقة ثابتة
}

// znet: pin_listesi.php → JSON { success, result: [ { id, adi, oyun_adi, fiyat, kupur } ] }
export async function fetchZnetPackages(config) {
  const { base_url, kod, sifre } = config;
  const cleanUrl = (base_url || '').replace(/\/+$/, '');
  if (!cleanUrl || !kod || !sifre) {
    throw new Error('Znet: base_url/kod/sifre مفقودة');
  }
  const url = `${cleanUrl}/servis/pin_listesi.php?kod=${encodeURIComponent(kod)}&sifre=${encodeURIComponent(sifre)}`;
  const res = await fetch(url, { timeout: 20000 });
  const text = await res.text();
  if (!text.trim()) {
    throw new Error('Znet: رد فارغ (تحقّق من تفعيل API + IP الثابت)');
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Znet pin_listesi رد غير JSON: ${text.slice(0, 200)}`); }
  if (!data || data.success !== true || !Array.isArray(data.result)) {
    throw new Error(`Znet pin_listesi خطأ: ${data?.error || text.slice(0, 200)}`);
  }
  return data.result.map((p) => {
    const game = cleanText(p.oyun_adi);
    const denomination = p.kupur != null ? String(p.kupur) : '';
    const name = cleanText(p.adi);
    return {
      external_ref: String(p.id ?? ''),
      name,
      category: game,
      denomination,
      price: parseFloat(p.fiyat) || 0,
      currency: 'TRY',
      is_available: 1,
      match_key: makeMatchKey({ game, denomination, name }),
    };
  });
}

// zdk (barakat / apstore): GET /client/api/products مع header api-token → مصفوفة JSON
export async function fetchZdkPackages(config) {
  const { base_url, api_token } = config;
  const cleanUrl = (base_url || 'https://api.barakat-store.com').replace(/\/+$/, '');
  if (!api_token) {
    throw new Error('ZDK: api_token مفقود');
  }
  const url = `${cleanUrl}/client/api/products`;
  const res = await fetch(url, { headers: { 'api-token': api_token }, timeout: 20000 });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`ZDK products رد غير JSON: ${text.slice(0, 200)}`); }
  if (!Array.isArray(data)) {
    throw new Error(`ZDK products خطأ: ${data?.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return data.map((p) => {
    const name = cleanText(p.name);
    const category = cleanText(p.category_name);
    return {
      external_ref: String(p.id ?? ''),
      name,
      category,
      denomination: '',
      price: parseFloat(p.price) || 0,
      currency: 'TRY',
      is_available: p.available ? 1 : 0,
      match_key: makeMatchKey({ game: category, denomination: '', name }),
    };
  });
}

// znet: paket_listesi.php → نصّ خام لباقات الكونتور (الموبايل).
// التنسيق: سجلّات مفصولة بـ `^`، وكل سجلّ 5 حقول مفصولة بـ `|`:
//   OPERATOR | TIP | KUPÜR | FİYAT | اسم الباقة
// مثال: Avea|3gCep|1517|622.00|Mobil WiFi 200 GB ^ Turkcell|Ses|1130|0.00|...
// ملاحظة: يستخدم `bayi_kodu` (وليس `kod`) — على غرار أوامر الكونتور في znet.
// الـ operator (Turkcell/Vodafone/Avea) يحدّده التبويب، فنفلتر الرد عليه.
export async function fetchZnetKontorPackages(config, operator) {
  const { base_url, kod, sifre } = config;
  const cleanUrl = (base_url || '').replace(/\/+$/, '');
  if (!cleanUrl || !kod || !sifre) {
    throw new Error('Znet: base_url/kod/sifre مفقودة');
  }
  const url = `${cleanUrl}/servis/paket_listesi.php?bayi_kodu=${encodeURIComponent(kod)}&sifre=${encodeURIComponent(sifre)}`;
  const res = await fetch(url, { timeout: 20000 });
  const text = await res.text();
  if (!text.trim()) {
    throw new Error('Znet: رد فارغ (تحقّق من تفعيل API + IP الثابت)');
  }
  if (text.trimStart().startsWith('<')) {
    throw new Error(`Znet paket_listesi رد HTML بدل البيانات: ${text.slice(0, 120)}`);
  }
  const wantOp = String(operator || '').toLowerCase();
  const out = [];
  for (const rawRec of text.split('^')) {
    const parts = rawRec.split('|').map((s) => s.trim());
    // إزالة الحقول الفارغة في الطرفين (فاصل `|^` يترك `|` زائدة)
    while (parts.length && parts[0] === '') parts.shift();
    while (parts.length && parts[parts.length - 1] === '') parts.pop();
    if (parts.length < 5) continue;
    const op = parts[0];
    const tip = parts[1];
    const kupur = parts[2];
    const fiyat = parts[3];
    const name = cleanText(parts.slice(4).join(' '));
    if (!op || !name) continue;
    if (wantOp && op.toLowerCase() !== wantOp) continue;
    out.push({
      external_ref: String(kupur || ''),   // رقم الربط (kupür) — يُعرض بجانب الاسم
      name,
      category: cleanText(tip),             // نوع الباقة (3gCep / Ses / ...) — للفلترة
      denomination: String(kupur || ''),
      price: parseFloat(fiyat) || 0,
      currency: 'TRY',
      is_available: 1,
      match_key: makeMatchKey({ name }),    // مطابقة بالاسم عبر مواقع znet (نفس البرمجية)
    });
  }
  return out;
}

const PRICE_PROVIDERS = {
  znet: fetchZnetPackages,
  barakat: fetchZdkPackages,
};

// تبويبات الكونتور → اسم المشغّل في رد znet. الكونتور من znet فقط (لا zdk).
export const KONTOR_OPERATORS = { turkcell: 'Turkcell', vodafone: 'Vodafone', avea: 'Avea' };

// هل يدعم هذا النوع جلب قائمة أسعار لهذا التبويب؟
export function supportsPriceList(providerType, tab = 'games') {
  if (KONTOR_OPERATORS[tab]) return providerType === 'znet'; // كونتور: znet حصراً
  return Object.prototype.hasOwnProperty.call(PRICE_PROVIDERS, providerType);
}

export async function fetchPackages(providerType, config, tab = 'games') {
  const operator = KONTOR_OPERATORS[tab];
  if (operator) {
    if (providerType !== 'znet') return [];
    return fetchZnetKontorPackages(config, operator);
  }
  const fn = PRICE_PROVIDERS[providerType];
  if (!fn) throw new Error(`المزوّد لا يدعم قائمة الأسعار: ${providerType}`);
  return fn(config);
}
