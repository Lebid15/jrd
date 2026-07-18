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
// المصادر التي تستخدم نفس البرمجية (znet) تُنتج أسماء متطابقة → مطابقة دقيقة.
export function makeMatchKey({ game, denomination, name }) {
  const base = [game, denomination].filter(Boolean).join(' ') || name || '';
  return String(base)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/\b(mobile|global|id|pin|otomatik)\b/gi, ' ')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
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

const PRICE_PROVIDERS = {
  znet: fetchZnetPackages,
  barakat: fetchZdkPackages,
};

// هل يدعم هذا النوع جلب قائمة أسعار؟
export function supportsPriceList(providerType) {
  return Object.prototype.hasOwnProperty.call(PRICE_PROVIDERS, providerType);
}

export async function fetchPackages(providerType, config) {
  const fn = PRICE_PROVIDERS[providerType];
  if (!fn) throw new Error(`المزوّد لا يدعم قائمة الأسعار: ${providerType}`);
  return fn(config);
}
