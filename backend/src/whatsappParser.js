// ─── محلّل رسائل الواتساب للجرد التلقائي ────────────────────────────────────
// يستخرج من نصّ الرسالة: اتجاه (لنا/لكم) + عملة (TRY/USD) + مبلغ.
// المصدر (us/them) يُحدَّد من اسم المرسل (وجود رمز admin).

// تطبيع نصّ عربي/لاتيني: تصغير، إزالة تشكيل، توحيد أحرف.
export function normalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[\u064b-\u0652]/g, '')   // إزالة التشكيل
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s$₺]/gu, ' ') // إزالة الترقيم (مع الإبقاء على الأحرف والأرقام)
    .replace(/\s+/g, ' ')
    .trim();
}

// هل اسم المرسل يحوي أحرف الـ admin بالترتيب؟ (subsequence)
export function isAdminName(senderName, token = 'admin') {
  if (!senderName) return false;
  const n = senderName.toLowerCase();
  const t = token.toLowerCase();
  let i = 0;
  for (const ch of n) {
    if (ch === t[i]) i++;
    if (i === t.length) return true;
  }
  return false;
}

// يبحث عن أيّ كلمة من القائمة في النصّ المُطبّع (مطابقة كاملة للكلمة)
function containsAny(normalizedText, keywords) {
  if (!keywords?.length) return false;
  const tokens = new Set(normalizedText.split(' '));
  for (const kw of keywords) {
    const k = normalize(kw);
    if (!k) continue;
    if (tokens.has(k)) return true;
    // سماح بمطابقة جزء (مثل ₺ أو $) داخل كلمة
    if (k.length <= 2 && normalizedText.includes(k)) return true;
  }
  return false;
}

// استخراج أوّل رقم في النصّ (يقبل الفواصل والكسور)
function extractAmount(text) {
  const m = text.match(/(\d[\d.,]*)/);
  if (!m) return null;
  // إزالة الفواصل (1,500 → 1500) واستبدال الفاصلة العربية
  const cleaned = m[1].replace(/[,٬](?=\d)/g, '').replace(/٫/g, '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * يحلّل الرسالة. يُرجع null لو لم نستطع استخلاص عملية صالحة.
 * keywords = { us: [], them: [], try: [], usd: [], ignore: [] }
 */
export function parseMessage(rawText, keywords) {
  if (!rawText) return null;
  const norm = normalize(rawText);
  if (!norm) return null;

  // تجاهل لو فيها كلمة من قائمة "مطابقة"
  if (containsAny(norm, keywords.ignore || [])) {
    return { ignored: true, reason: 'matched_ignore_keyword' };
  }

  const hasUs    = containsAny(norm, keywords.us   || []);
  const hasThem  = containsAny(norm, keywords.them || []);
  if (hasUs && hasThem) return null;     // غامض
  if (!hasUs && !hasThem) return null;   // لا اتجاه

  const hasTry = containsAny(norm, keywords.try || []);
  const hasUsd = containsAny(norm, keywords.usd || []);
  if (hasTry && hasUsd) return null;     // غامض
  if (!hasTry && !hasUsd) return null;   // لا عملة

  const amount = extractAmount(rawText);
  if (amount == null) return null;

  return {
    direction: hasUs ? 'lana' : 'lakum',
    currency: hasTry ? 'TRY' : 'USD',
    amount,
  };
}

/**
 * يحسب الـ delta (موجب/سالب) ليُطبَّق على الرصيد.
 *  - نحن نكتب "لنا"  → ‒amount   (نحن نقصنا ما عند الجهة لنا)
 *  - نحن نكتب "لكم"  → +amount
 *  - هم  يكتبون "لنا" → +amount   (الجهة أقرّت أن لنا عندها)
 *  - هم  يكتبون "لكم" → ‒amount
 */
export function computeDelta({ direction, amount, source }) {
  if (source === 'us') {
    return direction === 'lana' ? -amount : +amount;
  }
  return direction === 'lana' ? +amount : -amount;
}
