# JRD — نظام الجرد اليومي

نظام جرد يومي للحسابات بواجهة عربية، يدعم:
- إدخال يدوي للبنود
- مزودي API (Znet, Barakat, Murat Temiz)
- روبوت تصفّح (Playwright) لمواقع لا تملك API — حالياً [bayi.alayatl.com](http://bayi.alayatl.com)
- أرشيف الجرد + تصدير PDF
- إدارة الصور والمستندات
- (قريباً) بوت واتساب + جرد شهري + مطابقة صرافين

## البنية

```
jrd/
├── backend/      Node + Express + SQLite (better-sqlite3)
├── frontend/     React + Vite + Tailwind
├── scraper/      Node + Playwright (Chromium، Persistent Context)
├── Dockerfile    multi-stage: frontend build + backend + scraper + Chromium
└── railway.toml  Railway deploy config
```

## التشغيل المحلي

### Backend
```powershell
cd backend
npm install
npm run dev    # http://localhost:3001
```

### Frontend
```powershell
cd frontend
npm install
npm run dev    # http://localhost:5173
```

### Scraper (اختبار مستقل)
```powershell
cd scraper
npm install
npm run install:browser
Copy-Item .env.example .env
# عدّل .env ببياناتك
npm run fetch
```

## Docker (محلي)

```powershell
docker build -t jrd .
docker run -p 3001:3001 -v jrd-data:/data jrd
# افتح http://localhost:3001
```

## النشر على Railway

1. ربط الـ repo بمشروع Railway جديد.
2. Railway سيكتشف [Dockerfile](Dockerfile) و [railway.toml](railway.toml) تلقائياً.
3. **مهم**: أضف **Volume** في إعدادات Railway مُلحَق بالمسار `/data` — لتخزين قاعدة البيانات والصور وجلسة المتصفح بشكل دائم بين عمليات النشر.
4. متغيرات البيئة المطلوبة:
   - `DATA_DIR=/data` (الافتراضي في Dockerfile)
   - `NODE_ENV=production`
   - `PORT` — يضبطها Railway تلقائياً.

## بنية البيانات الدائمة (`DATA_DIR`)

```
/data/
├── jrd.db                  قاعدة بيانات SQLite
├── uploads/                صور المستخدم المرفوعة
└── browser-data/
    └── item-<id>/          جلسة Chromium لكل بند scraper
```

## Endpoints رئيسية

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | فحص حياة الخدمة |
| GET | `/api/items` | كل البنود مع قيمها الحالية |
| POST | `/api/inventory` | حفظ جرد يومي جديد |
| GET | `/api/inventory` | قائمة الجرد (أرشيف) |
| POST | `/api/configs/fetch-all` | جلب أرصدة كل المزودين والروبوتات |
| POST | `/api/configs/:itemId/fetch` | جلب رصيد بند واحد |

## التوثيق الإضافي

- [plan.md](plan.md) — خطة التطوير الكاملة (روبوتات، واتساب، جرد شهري، إلخ).
- [bothelp.md](bothelp.md) — مرجع بناء بوت واتساب (للمستقبل).
