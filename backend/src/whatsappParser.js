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
    // فصل تلقائي بين الحروف والأرقام (لكم1100تركي → لكم 1100 تركي)
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .replace(/\s+/g, ' ')   // أيّ مسافات بيضاء (مسافات/أسطر/تابات) → مسافة واحدة
    .trim();
}

// هل اسم المرسل يحوي كلمة الـ admin؟ (substring، غير حسّاس لحالة الأحرف)
// مثال: "Admin Worker" أو "ahmed-admin" → true ، "Adam Idris Nadir" → false
export function isAdminName(senderName, token = 'admin') {
  if (!senderName || !token) return false;
  return String(senderName).toLowerCase().includes(String(token).toLowerCase());
}

// يبني regex من كلمة مفتاحية يسمح بتكرار أيّ حرف داخلها 1+ مرّات
// مثال: "لنا" → /^ل+ن+ا+$/  (يطابق لنا، لنااا، للللنا، لنــــــــــا)
// لا تُستخدم للرموز القصيرة جداً (₺، $) — نُبقي مطابقة جزئية لها.
const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
function buildElongatedRegex(normWord) {
  if (!normWord) return null;
  // اشطر إلى أحرف Unicode حقيقية (تدعم الـ surrogates)
  const chars = Array.from(normWord);
  const pattern = chars.map(ch => {
    if (ch === ' ') return '\\s+';
    return ch.replace(ESCAPE_RE, '\\$&') + '+';
  }).join('');
  try {
    return new RegExp('^' + pattern + '$', 'u');
  } catch {
    return null;
  }
}

// يبحث عن أيّ كلمة من القائمة في النصّ المُطبّع
// - مطابقة كلمة كاملة (سريع) أوّلاً
// - ثمّ مطابقة مع تمديد أيّ حرف (لنا → لنااا، للللنا)
// - الرموز القصيرة (≤2) تُطابَق كجزء داخل النصّ كله
function containsAny(normalizedText, keywords) {
  if (!keywords?.length) return false;
  const tokens = normalizedText.split(' ');
  const tokenSet = new Set(tokens);

  for (const kw of keywords) {
    const k = normalize(kw);
    if (!k) continue;

    // 1) رموز قصيرة (₺، $، tl): مطابقة جزئية في النصّ كله
    if (k.length <= 2) {
      if (normalizedText.includes(k)) return true;
      continue;
    }

    // 2) مطابقة كلمة كاملة سريعة
    if (tokenSet.has(k)) return true;

    // 3) مطابقة بتمديد الحروف على كلّ token
    const re = buildElongatedRegex(k);
    if (!re) continue;
    for (const t of tokens) {
      if (re.test(t)) return true;
    }
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
