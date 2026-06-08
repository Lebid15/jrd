# messages-scraper — Google Messages Web → KUVEYT TURK

> خدمة تقرأ آخر رسائل البنك من محادثة `KUVEYT TURK` على `messages.google.com/web`
> وتُرسلها لـ backend (راجع `plan.md` → البند 3.5).

## كيف يعمل
1. Chromium يعمل بـ Persistent Context على مجلد `browser-data/` (محلياً) أو `/data/gmsg-browser-data` (Railway).
2. يفتح محادثة KUVEYT TURK تلقائياً عند الإقلاع.
3. كل ~12 ثانية يقرأ آخر 20 رسالة، يحذف المكرّر، ويُرسل الجديد لـ backend عبر `POST /api/internal/bank-message/ingest`.
4. backend يعيد استخدام نفس `parseSms` الموجود لـ SMS Forwarder (= صفر مخاطرة على المنطق المالي).

---

## دورة حياة الجلسة

| الحالة | المعنى | الإجراء |
|---|---|---|
| `running` | يعمل ويستطلع | لا شيء |
| `pairing` | بحاجة QR | تجديد الجلسة (انظر أدناه) |
| `session_expired` | الجلسة انتهت (نادر، كل عدّة شهور) | تجديد الجلسة |
| `error` | خطأ تقني | راجع الـ logs على Railway |

---

## 🔄 تجديد الجلسة (الإقران + الرفع)

> اتبع هذه الخطوات **محلياً على جهازك** ثم ارفع الناتج من واجهة ahlacard.net.
> الجلسة الواحدة تدوم عادةً عدّة شهور.

### 1) ضع نفسك في مجلد المشروع
```powershell
cd messages-scraper
```

### 2) احذف الجلسة القديمة وافتح Chromium لمسح QR
```powershell
Remove-Item -Recurse -Force browser-data -ErrorAction SilentlyContinue
npm run spike
```

سيفتح متصفّح Chromium. داخله:
1. سجّل دخول إلى حسابك على Google (لو لم يكن مسجَّلاً).
2. اذهب إلى تطبيق **Messages** على جوالك → اضغط صورتك → **Device pairing** → **New device** → امسح الـ QR الظاهر.
3. انتظر حتى يطبع الـ console آخر رسالة من `KUVEYT TURK`.
4. اضغط `Ctrl+C` في الـ terminal لإغلاق المتصفّح.

### 3) اضغط مجلد الجلسة إلى ZIP
```powershell
.\scripts\pack-session.ps1
```

سيُنشئ ملف `session.zip` في المجلد الحالي.

### 4) ارفع الملف من واجهة ahlacard.net
1. افتح <https://ahlacard.net/bank>.
2. في بطاقة **"مصدر الرسائل: Google Messages Web"** أعلى الصفحة، اضغط زر **"رفع / تجديد الجلسة"**.
3. اختر `session.zip`.
4. السيرفر سيستبدل الجلسة ويُعيد التشغيل تلقائياً. خلال ~30 ثانية تتحوّل الحالة لـ **"يعمل"** ويبدأ التقاط الرسائل.

> ✅ بعد ذلك يمكنك حذف `session.zip` و `browser-data/` من جهازك (الجلسة الآن على السيرفر).

---

## تشغيل محلّي (للتطوير فقط)
```powershell
cd messages-scraper
npm install
npm run install:browser
copy .env.example .env
npm start          # خدمة كاملة على port 3101
```

