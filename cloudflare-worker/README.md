# Cloudflare Worker — وسيط SMM لتجاوز حجب Cloudflare

## لماذا؟
خادم Railway محجوب من Cloudflare عند الوصول لـ `followers-store.com` (HTTP 403).
هذا الـ Worker يعمل **داخل شبكة Cloudflare نفسها**، فلا يُحجب أبداً، ويعيد توجيه طلبات API ويرجّع JSON.

## التكلفة
**مجاني** — خطة Cloudflare Workers Free تعطي 100,000 طلب/يوم. نحن نحتاج < 100/يوم.

---

## خطوات النشر (مرة واحدة فقط)

### 1) افتح لوحة Cloudflare
- اذهب إلى: https://dash.cloudflare.com/
- من القائمة الجانبية: **Workers & Pages** → **Create** → **Workers** → **Create Worker**.

### 2) سَمِّ الـ Worker
- اسم مقترح: `smm-proxy` (سيصبح الرابط: `https://smm-proxy.<your-subdomain>.workers.dev`).
- اضغط **Deploy** (سيُنشئ Worker افتراضي بـ "Hello World").

### 3) استبدل الكود
- اضغط **Edit code** (يفتح محرر).
- احذف كل المحتوى.
- انسخ محتوى الملف [worker.js](worker.js) والصقه بالكامل.
- اضغط **Deploy** (أعلى اليمين).

### 4) (اختياري لكن موصى به) أضف مفتاح حماية
حتى لا يستخدم أحد الـ Worker الخاص بك:
- في صفحة الـ Worker → **Settings** → **Variables and Secrets** → **Add**.
- النوع: **Secret**.
- الاسم: `PROXY_SECRET`.
- القيمة: أي نص عشوائي طويل (مثلاً ولّد UUID).
- احفظ.

### 5) انسخ رابط الـ Worker
- في أعلى صفحة الـ Worker سترى الرابط:
  `https://smm-proxy.<your-subdomain>.workers.dev`
- جرّبه في المتصفح، يجب أن يرى: `{"error":"Missing ?target=<url>"}` ← هذا يعني أنه يعمل.

---

## ربط Railway بالـ Worker

### في Railway
1. افتح خدمة الـ backend:
   https://railway.com/project/fec70dd5-0c5d-4149-855f-ffac4cc2c932/service/31f32c5e-0f55-42e9-b666-45f81931f38e
2. تبويب **Variables** → **New Variable**.
3. أضف:
   - `SMM_PROXY_URL` = `https://smm-proxy.<your-subdomain>.workers.dev`
   - (لو فعّلت الخطوة 4) `SMM_PROXY_SECRET` = نفس القيمة التي وضعتها في Cloudflare.
4. Railway سيُعيد النشر تلقائياً.

---

## اختبار يدوي (من جهازك)
```powershell
curl.exe -X POST "https://smm-proxy.<your-subdomain>.workers.dev/?target=https%3A%2F%2Ffollowers-store.com%2Fapi%2Fv2" `
  -H "Content-Type: application/x-www-form-urlencoded" `
  -H "x-proxy-secret: <SECRET_IF_SET>" `
  --data "key=test&action=balance"
```
المتوقع: `{"error":"The selected key is invalid."}` ← الـ Worker يعمل ويصل للموقع.

---

## إضافة مواقع SMM أخرى لاحقاً
عدّل ملف [worker.js](worker.js) سطر `ALLOWED_HOSTS`:
```js
const ALLOWED_HOSTS = [
  'followers-store.com',
  'another-smm-site.com',  // ← أضف هنا
];
```
ثم انسخ الكود ولصقه في محرر Cloudflare → Deploy.
لا تغيير مطلوب في كود backend.

---

## استكشاف الأخطاء
| الاستجابة | السبب | الحل |
|---|---|---|
| `Host not allowed` | النطاق غير في `ALLOWED_HOSTS` | أضفه في worker.js وأعد النشر |
| `Forbidden` من Worker | `x-proxy-secret` خاطئ أو مفقود | تحقق من `SMM_PROXY_SECRET` في Railway |
| `Missing ?target=` | `SMM_PROXY_URL` خاطئ في Railway | تأكد من الرابط |
| لا يزال 403 من الموقع | الموقع يحجب Cloudflare Workers أيضاً (نادر) | حل بديل (بروكسي مدفوع) |
