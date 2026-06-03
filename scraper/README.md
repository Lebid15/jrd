# JRD Scraper — bayi.alayatl.com

سكربت Node + Playwright لجلب أرقام صفحة "البياعون" تلقائياً:
- مجموع الأرصدة (Bakiye Toplamı)
- مجموع الديون (Borc Toplamı)
- الفرق / المستحق (Bayi Alacağı)
- عدد البياعين (Toplam Bayi Sayısı)

## التشغيل لأول مرة

```powershell
cd f:\jrd\scraper
npm install
npm run install:browser
Copy-Item .env.example .env
# عدّل .env ووضع بيانات الاعتماد الصحيحة
npm run fetch
```

في أول تشغيل سيفتح المتصفح ويسجّل دخوله تلقائياً (HEADLESS=false افتراضياً لترى ما يحدث).

## كل تشغيل لاحق

```powershell
npm run fetch
```

سيُعيد استخدام نفس مجلد `browser-data/` (يحوي الكوكيز والجلسة) — لو الجلسة ما زالت صالحة سيدخل مباشرة بدون إعادة كتابة الباسوورد.

لو الجلسة منتهية، سيُكرر سيناريو تسجيل الدخول الكامل تلقائياً.

## ضبط headless

في `.env` اضبط:
```
HEADLESS=true
```

لتشغيل المتصفح في الخلفية بدون نافذة (للإنتاج).

## التشخيص

عند الفشل تُحفظ لقطة شاشة في:
- `debug-error.png` — فشل عام
- `debug-parse.png` — تم الدخول لكن فشل استخراج الأرقام

## النتيجة

السكربت يطبع JSON في آخر سطر بصيغة:
```
RESULT_JSON={"bakiye_toplami":202639.7888,"borc_toplami":384783,"bayi_alacagi":-182143.2112,"toplam_bayi_sayisi":353}
```

سيستخدم الـ backend لاحقاً لقراءة هذا السطر وتحديث القيم في DB.
