# خطة العمل — المرحلة القادمة (plan2)

> ملف نقاش وتخطيط. القرارات تُسجَّل هنا قبل أي كود.
> المرجع التاريخي: [plan.md](plan.md).
>
> **آخر تحديث**: 12 يونيو 2026

---

## 1) ملخّص الوضع الحالي (Baseline)

### ما يعمل في الإنتاج على Railway ✅
| المنطقة | الحالة |
|---------|--------|
| Backend Node + Express + SQLite (better-sqlite3) | يعمل |
| Frontend React + Vite + Tailwind | يعمل |
| الجرد اليومي (إدخال يدوي + 3 مزودي API: Znet / Barakat / Murat Temiz) | يعمل |
| الجرد الشهري (snapshots + period_profit + PDF) | يعمل |
| روبوت bayi.alayatl.com (Playwright، Persistent Context) | يعمل |
| روبوت SMM (followers-store.com عبر API) | يعمل |
| بوت واتساب (Baileys، AES-256-GCM، QR، استئناف تلقائي) | يعمل |
| استقبال رسائل واتساب + استخراج حركات | يعمل |
| البنك — كويت ترك عبر SMS Forwarder | يعمل |
| البنك — Google Messages Web scraper | يعمل |
| مطابقة الصرافين + غلة العامل + المحلات | يعمل |
| الأرشيف + الصور + الإعدادات | يعمل |

### القيود من المالك
- لا تسجيل دخول حالياً (سيتغيّر).
- بنك واحد فقط (كويت ترك).
- فلترة مطلوبة في صفحات معيّنة.

---

## 2) جميع بنود plan.md الأصلية مكتملة ✅

تمّ إنجاز كل البنود التشغيلية من plan.md (3.5، 5، 6، 7، 9). الوحيد المتبقّي:

| البند | الحالة |
|-------|--------|
| 10 — الأمان والمراقبة + المصادقة | ⏳ سيُعالج ضمن خطة Multi-Tenant أدناه |

---

## 3) سجلّ المُنجَز في هذه الجلسة

### ✅ الفلترة — منجزة (12 يونيو 2026)

**سجل المعاملات في صفحة البنك** ([Bank.jsx](frontend/src/pages/Bank.jsx)):
- لوحة فلترة قابلة للطيّ + عدّاد للفلاتر النشطة.
- الحقول: تاريخ من/إلى، الاتجاه (وارد/صادر/الكل)، أقل مبلغ، أعلى مبلغ، بحث نصّي.
- Backend: `GET /api/bank/transactions` يدعم الآن:
  `item_id, from, to, direction, min_amount, max_amount, q, limit` ([bank.js](backend/src/routes/bank.js)).

**صفحة الجرد الشهري** ([MonthlyArchive.jsx](frontend/src/pages/MonthlyArchive.jsx)):
- لوحة فلترة قابلة للطيّ.
- الحقول: تاريخ من/إلى، ربح الفترة (موجب/خسارة/الكل)، بحث في الملاحظات.
- Backend: `GET /api/monthly` يدعم الآن: `from, to, profit_sign, q, limit, offset` ([monthly.js](backend/src/routes/monthly.js)).

### ✅ المرحلة 1 — ملفات النشر على Hetzner — منجزة (12 يونيو 2026)

[deploy/docker-compose.yml](deploy/docker-compose.yml) + [Caddyfile](deploy/Caddyfile) + [deploy.sh](deploy/deploy.sh) + [backup.sh](deploy/backup.sh) + [.env.example](deploy/.env.example) + [README.md](deploy/README.md).

### ✅ المرحلة 3 — DB Migration متعدّد المستأجرين — منجزة (12 يونيو 2026)

**ما تغيّر في [backend/src/database.js](backend/src/database.js)** (إعادة كتابة كاملة + migration block):

#### جداول جديدة
- **`tenants`** (`id`, `name`, `slug UNIQUE`, `is_active`, `notes`, `created_at`).
- **`users`** (`id`, `tenant_id`, `email UNIQUE`, `password_hash`, `role admin|owner`, `is_active`, `last_login_at`, `created_at`).
- **`auth_sessions`** (`id`, `user_id`, `token_hash UNIQUE`, `user_agent`, `ip`, `expires_at`).

#### عمود `tenant_id` أُضيف لكل الجداول الموجودة
`items`, `current_values`, `api_configs`, `inventories`, `inventory_items`, `photos`, `bank_transactions`, `bank_sms_log`, `whatsapp_transactions`, `monthly_inventories`, `monthly_inventory_items`.

- في القواعد الجديدة (Hetzner): `tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE` — FK مفروض.
- في قاعدة Railway القديمة: `ALTER TABLE ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1` — بدون FK لأن SQLite لا يسمح بـ `REFERENCES + DEFAULT` عبر `ALTER`. الحماية تأتي من middleware في المرحلة 6.

#### جداول أُعيد إنشاؤها (لتغييرات هيكلية)
- **`settings`**: PK تحوّل من `(key)` إلى `(tenant_id, key)` — كل مستأجر له إعداداته الخاصّة (`exchange_rate`، الكلمات المفتاحية، إلخ).
- **`whatsapp_messages.tenant_id`**: تحوّل من `TEXT '1'` إلى `INTEGER 1`.

كلا التحويلَين يتمّان بـ:
1. `PRAGMA foreign_keys=OFF` ضمن transaction.
2. `CREATE TABLE *_new` بالشكل الجديد.
3. `INSERT INTO *_new SELECT ... FROM *` مع COALESCE/CAST لقيم النوع المُحدَّث.
4. `DROP TABLE *` + `ALTER TABLE *_new RENAME TO *`.

#### Indexes
12 index على `tenant_id` لكل جدول + 4 indexes مركّبة `(tenant_id, created_at)` لتسريع الفلترة الزمنية + indexes على `users` و `auth_sessions`.

#### المستأجر الافتراضي
يُنشأ تلقائياً في أوّل تشغيل (`id=1`, `slug='default'`). كل البيانات الموجودة من قبل تنتمي إليه.

#### Idempotency
- كل CREATE → `IF NOT EXISTS`.
- ALTER → فحص `PRAGMA table_info` قبل التنفيذ.
- إعادة إنشاء settings/whatsapp_messages → فحص شكل الجدول قبل الانطلاق.
- seedSetting → فحص وجود الإعداد قبل الإدراج (لا يكسر إعداداً موجوداً).

#### الاختبار
[backend/test/test-multitenant-migration.js](backend/test/test-multitenant-migration.js) — يحاكي قاعدة Railway قديمة + قاعدة Hetzner فارغة، 34/34 فحص ناجح:
- وجود الجداول الجديدة + المستأجر الافتراضي.
- وجود `tenant_id` في كل جدول هدف.
- شكل `settings` و `whatsapp_messages` الجديد.
- حفظ البيانات الموجودة + backfill = 1.
- إعدادات موجودة لا تُستبدل من السيد.
- FK يرفض INSERT بمستأجر غير موجود (للقواعد الجديدة).
- عزل الجداول حسب `tenant_id` (تجربة بإضافة مستأجر 99).
- إعادة تشغيل migration لا تكسر البيانات (Idempotency).

تشغيل: `cd backend && npm run test:migration` (يحتاج Node 20 + بناء better-sqlite3 native).

#### ما **لم** يتغيّر بعد (مقصود — يأتي في المراحل التالية)
- ❌ Routes لا تزال تستعلم بدون `WHERE tenant_id = ?` — كل البيانات الموجودة على tenant 1، فلا فرق سلوكي الآن. → **المرحلة 6**.
- ✅ middleware Auth: منجزة (المرحلة 4).
- ❌ tenant scope على الـ routes. → **المرحلة 6**.
- ❌ لا توجد UI لإدارة المستأجرين. → **المرحلة 7**.
- ❌ بوت/scrapers لا يدعمون عدّة مستأجرين بعد. → **المراحل 8-9**.

النشر على Railway الحالي آمن: الـ migration يضيف الجداول/الأعمدة دون كسر السلوك الحالي (كل INSERT جديد يأخذ `tenant_id=1` تلقائياً عبر DEFAULT).

---

### ✅ المرحلة 4 — Auth Backend (JWT + Cookie + Sessions) — منجزة (12 يونيو 2026)

**الملفات الجديدة/المعدَّلة**:
- [backend/src/auth.js](backend/src/auth.js) — مساعدات JWT + middlewares (`requireAuth`, `requireAdmin`, `optionalAuth`).
- [backend/src/routes/auth.js](backend/src/routes/auth.js) — `POST /login`, `POST /logout`, `GET /me`, `POST /change-password` + rate-limit (5 محاولات فاشلة / 15 دقيقة / IP).
- [backend/scripts/create-admin.js](backend/scripts/create-admin.js) — CLI لإنشاء/إعادة تعيين admin: `node scripts/create-admin.js --email=... --password=... [--reset]`.
- [backend/src/index.js](backend/src/index.js) — تسجيل cookie-parser + authRouter + CORS بـ `credentials: true`.
- [backend/package.json](backend/package.json) — إضافة `bcryptjs`, `cookie-parser`, `jsonwebtoken` + scripts `test:auth`, `admin:create`.

**خصائص التصميم**:
- JWT (HS256) موقّع بـ `JWT_SECRET` (إلزامي ≥ 16 حرف). Payload = `{ uid, tid, role, jti }` — `jti` فريد لكل توكن يضمن hashes مميَّزة.
- التوكن يُحفظ في **cookie httpOnly** اسمها `jrd_token` (SameSite=Lax، Secure تلقائياً في الإنتاج). يقبل أيضاً `Authorization: Bearer ...`.
- نخزّن SHA-256 hash للتوكن في `auth_sessions` → يسمح بـ revocation الفوري (logout، تغيير كلمة سرّ).
- عند كل طلب: نتحقّق من التوقيع + وجود hash في DB + عدم انتهاء الصلاحية + نشاط المستخدم والمستأجر.
- `requireAdmin` يسمح فقط لـ `role='admin'` (tenant_id يكون NULL ويرى كل المستأجرين).
- `requireAuth` يضع `req.user = { id, tenant_id, role, email }` و `req.authToken` — جاهز للاستخدام في المرحلة 6 (tenant scoping).

**اختبار**: [backend/test/test-auth.js](backend/test/test-auth.js) — 38 اختبار:
- Test A (unit): issue/verify/revoke/disabled user/disabled tenant/admin مع tenant_id=NULL.
- Test B (HTTP integration): تطبيق Express حقيقي على port عشوائي — full login → me → logout → me=401 + rate-limit + change-password.
- Test C (admin script): `spawnSync` لاختبار create-admin.js مع/بدون `--reset` وكلمة سرّ قصيرة.

تشغيل: `cd backend && npm run test:auth` (Docker: `docker run --rm -v "${PWD}:/work" -w /work/backend node:20-bookworm-slim sh -c "npm install --omit=dev && npm run test:auth"`).

**النتيجة**: 38/38 نجحت.

---

### ✅ المرحلة 5 — Auth Frontend (Login + Guard + Sidebar User) — منجزة (12 يونيو 2026)

**الملفات الجديدة/المعدَّلة**:
- [frontend/src/api.js](frontend/src/api.js) — `withCredentials: true` + interceptor لإعادة التوجيه عند 401 (عبر `setOn401Handler`).
- [frontend/src/AuthContext.jsx](frontend/src/AuthContext.jsx) — Provider يحقن `user, tenant, loading, login, logout, refresh` + يربط 401 handler بـ navigate.
- [frontend/src/RequireAuth.jsx](frontend/src/RequireAuth.jsx) — حارس routes (يعرض loader أثناء التحقّق، ثم يحوّل لـ `/login?from=...` إن لم يكن مستخدم).
- [frontend/src/pages/Login.jsx](frontend/src/pages/Login.jsx) — صفحة دخول RTL مع show/hide password وإدارة أخطاء (401/429).
- [frontend/src/App.jsx](frontend/src/App.jsx) — قسّم routes إلى `/login` (عام) وغيرها (محمية داخل `<RequireAuth>` + `<ProtectedShell>` الذي يحوي `Sidebar` + الـ pages).
- [frontend/src/components/Sidebar.jsx](frontend/src/components/Sidebar.jsx) — أسفل الشريط يعرض إيميل المستخدم + اسم المستأجر + زرّ "تسجيل الخروج".

**سلوك**:
- عند فتح الموقع → AuthProvider يستدعي `GET /api/auth/me`. لو نجح → يخزّن user/tenant. لو 401 → user=null → guard يحوّل لـ `/login`.
- Login → ينادي `POST /api/auth/login` (cookie HttpOnly يُحفظ تلقائياً عبر `withCredentials`).
- أي طلب لاحق يفشل بـ 401 (مثلاً انتهت الجلسة) → interceptor يصفّر user ويُحوّل لـ `/login?from=<currentPath>`.
- Logout → `POST /api/auth/logout` (يلغي الجلسة في DB) ثم navigate `/login`.

**التحقّق**: `vite build` نجح (1963 module). الاختبار اليدوي عبر المتصفّح متوقف على تشغيل backend مع المرحلة 6 (الـ routes ستبدأ ترفض بدون auth).

> ملاحظة: حجم الـ bundle 952 kB (قبل gzip). تحسين code-splitting مؤجَّل لما بعد الاستقرار.

---

### ✅ المرحلة 6 — Tenant Scoping على كل الـ Routes — منجزة (12 يونيو 2026)

**الفكرة**: كل query يصل إلى DB يجب أن يحمل `tenant_id` صريحاً. لا يكفي الـ FK على مستوى الجدول؛ المنطق نفسه يحتاج فلتر `WHERE tenant_id = ?` في كل SELECT/UPDATE/DELETE، و `tenant_id` صريح في كل INSERT.

**Helper مشترك** ([backend/src/tenantHelpers.js](backend/src/tenantHelpers.js)):
- `tid(req)` — يُرجع `req.user.tenant_id` للمالك، أو يقرأ `X-Tenant-Id` / `?tenant_id=` للأدمن (NULL tenant)، ويرفض 400 إن لم يتوفّر.

**الـ Routes المُحدَّثة**:
- [items.js](backend/src/routes/items.js), [inventory.js](backend/src/routes/inventory.js), [settings.js](backend/src/routes/settings.js), [photos.js](backend/src/routes/photos.js), [apiConfigs.js](backend/src/routes/apiConfigs.js), [bank.js](backend/src/routes/bank.js), [monthly.js](backend/src/routes/monthly.js):
  - كل SELECT / UPDATE / DELETE يفلتر بـ `WHERE tenant_id = ?`.
  - كل INSERT يضمّن `tenant_id` صريحاً.
  - تحقّق ملكية المورد: لو UPDATE/DELETE لم يُغيّر شيئاً → 404.
- **settings**: composite PK جديد `(tenant_id, key)` → كل UPSERT يستخدم `ON CONFLICT(tenant_id, key)`.
- **photos**: الرفع إلى `uploads/t<id>/<uuid>.ext` (عزل filesystem لكل مستأجر).
- **bank**: استُخرج `smsWebhookHandler` كـ named export. سُجِّل في index.js على مساريَن:
  - `POST /api/webhooks/bank-sms/:tenantSecret` — يقرأ المستأجر من `settings.sms_webhook_secret`.
  - `POST /api/bank/sms-webhook` — توافق رجعي مع SMS Forwarder الحالي (tenant=1 افتراضياً، secret من env).
- [internal.js](backend/src/routes/internal.js):
  - مساعد `tidFrom(req)` يقرأ `tenant_id` من body / query، أو يرجع 1 افتراضياً.
  - كل المساعدات (`getAllowedGroups`, `isGroupAllowed`, `getKeywords`, `getAdminToken`, `findItemByGroupName`) تأخذ `tenantId` معاملاً.
  - `POST /ingest` — يقرأ `tenant_id` من body (يُرسله البوت)، يفلتر كل query.
  - `POST /bank-message/ingest` — يقرأ `tenant_id` من body (يُرسله messages-scraper في المرحلة 9).
  - WhatsApp pages routes (`/whatsapp/messages`, `/whatsapp/groups`, `/whatsapp/transactions`, `/whatsapp/keywords`, `/whatsapp/allowed-groups`, إلخ) — تستخدم `tidFrom(req)` من query.
  - `POST /bank-message/upload-session` + `GET /bank-message/session-info` — settings UPSERT scoped بـ tenant.

**index.js** ([backend/src/index.js](backend/src/index.js)):
- ترتيب الـ middleware (مهم جداً): `/api/auth` → `/api/internal` → webhook routes → `app.use('/api', requireAuth)` → باقي الـ routers.
- بهذا الترتيب، الـ public endpoints (login/webhook/internal) لا تمرّ بـ requireAuth، وكل ما عداها محمي.

**التحقّق**:
- Smoke test: كل الـ routers تُحمَّل بدون أخطاء import. tenants table موجود، tenant id=1 موجود.
- اختبارات Auth: **38/38 ناجحة** بدون انحدار (تأكيد أن DB migration و auth flow لا يزالان سليمَين).
- اختبار end-to-end للـ routes يحتاج إنشاء owner عبر سكربت في المرحلة 7.

**ملاحظة أمنية متبقّية**: مسارات `/api/internal/*` (ما عدا `/ingest` و `/bank-message/ingest` المحميّة بـ `internalAuth`) ليست محميّة بـ `requireAuth` حالياً، لكنها تخدم الواجهة. في المرحلة 7 سننقلها لطبقة auth صحيحة (`requireAuth` + `req.user.tenant_id` بدلاً من query param).

---

### ✅ المرحلة 7 — Admin Panel (Tenants + Users CRUD) — منجزة (12 يونيو 2026)

**Backend** ([backend/src/routes/admin.js](backend/src/routes/admin.js) — جديد):
- `GET /api/admin/tenants` — قائمة + عدد users/items لكل مستأجر.
- `POST /api/admin/tenants` — إنشاء مستأجر (+ owner اختيارياً في نفس transaction). يتحقّق من slug فريد بصيغة `^[a-z0-9-]{2,40}$`.
- `PATCH /api/admin/tenants/:id` — تعديل name / is_active / notes (slug غير قابل للتغيير).
- `DELETE /api/admin/tenants/:id` — يرفض id=1 (المستأجر الافتراضي). cascade على كل البيانات عبر FK.
- `GET /api/admin/users?tenant_id=N` — قائمة (مع join على tenant name/slug).
- `POST /api/admin/users` — admin (بدون tenant) أو owner (يجب tenant_id). يرفض إيميل مكرّر، باسوورد < 8.
- `PATCH /api/admin/users/:id` — email/is_active/password. تغيير الباسوورد يُلغي كل الجلسات تلقائياً.
- `DELETE /api/admin/users/:id` — يرفض حذف آخر admin أو حذف الذات.
- `POST /api/admin/users/:id/revoke-sessions` — قطع كل الجلسات (إجباري logout من كل الأجهزة).
- **حمايات**: لا يمكن تعطيل/حذف آخر admin مفعّل (لتجنّب lockout كامل).

**تسجيل في index.js** ([backend/src/index.js](backend/src/index.js)):
```js
app.use('/api', requireAuth);
app.use('/api/admin', requireAdmin, adminRouter);
```

**Frontend**:
- [frontend/src/pages/AdminTenants.jsx](frontend/src/pages/AdminTenants.jsx) — جدول + modal للإنشاء (مع خيار إنشاء owner مرفق) + modal للتعديل + تعطيل/تفعيل + حذف.
- [frontend/src/pages/AdminUsers.jsx](frontend/src/pages/AdminUsers.jsx) — جدول + فلتر بـ tenant + إنشاء (admin/owner) + تعديل (email/password) + قطع جلسات + حذف.
- [frontend/src/App.jsx](frontend/src/App.jsx) — routes جديدة `/admin/tenants` و `/admin/users` ملفوفة بـ `<RequireAuth adminOnly>`.
- [frontend/src/components/Sidebar.jsx](frontend/src/components/Sidebar.jsx) — قسم "إدارة الموقع" يظهر فقط لـ admin (أزرق بنفسجي للتمييز).

**اختبار** ([backend/test/test-admin.js](backend/test/test-admin.js)):
- **47/47 ناجحة**.
- يغطّي: auth gates (no token / owner / admin) → tenant CRUD → cascade على حذف → users CRUD → حماية آخر admin → قطع جلسات بعد تغيير الباسوورد → cascade على tenant disable يمنع owner من المرور.
- script في package.json: `npm run test:admin`.

**بناء الواجهة**: `vite build` نجح (1965 module). جاهز للنشر.

---

### ✅ المرحلة 8 — Bot Multi-Tenant — منجزة (12 يونيو 2026)

**النتيجة**: البوت **كان أصلاً multi-tenant بالتصميم**. لم تكن هناك حاجة لتعديل كود البوت نفسه. كل ما لزم: تصحيح backend's internal.js + اختبار smoke.

**التحقّق من تصميم البوت** (بقراءة الكود):
- [bot/src/sessionManager.js](bot/src/sessionManager.js) — `Map<tenantId, Session>` keyed by stringified tenant id. `getOrCreateSession(tenantId)` ينشئ Session واحدة لكل مستأجر.
- [bot/src/session.js](bot/src/session.js) — `Session` constructor يأخذ `tenantId` ويضبط `this.authDir = path.join(config.authDir, String(tenantId))`. كل tenant له مجلد credentials مستقلّ على القرص.
- [bot/src/session.js](bot/src/session.js) — `ingestMessage()` يُرسل `tenant_id: this.tenantId` في كل callback إلى `/api/internal/ingest`.
- [bot/src/sessionManager.js](bot/src/sessionManager.js) — `bootstrap()` يقرأ كل المجلدات في `config.authDir` ويستأنف كل جلسة عند الإقلاع.
- [bot/src/server.js](bot/src/server.js) — كل مسارات الإدارة `/sessions/:tenantId/{start|reset|logout|groups}` مفصولة per-tenant.

**التعديل الفعلي في Backend** ([backend/src/routes/internal.js](backend/src/routes/internal.js)):
- استبدال 5 مواقع `/sessions/1` المُثبَّتة بـ `/sessions/${tidFrom(req)}` (start, reset, logout, status, all-groups).
- `tidFrom(req)` يستعمل `req.user.tenant_id` للمالك (لا يستطيع تعدّيه)، أو يقرأ من query/body للأدمن، أو 1 افتراضياً.
- `app.use('/api/internal', optionalAuth, ...)` في index.js — middleware جديد يقرأ الـ JWT cookie لو موجود (للواجهة)، ويسمح بـ X-Internal-Api-Key (للبوت/scrapers).

**اختبار** ([bot/test/test-multitenant.js](bot/test/test-multitenant.js)):
- **15/15 ناجحة**.
- يغطّي: قراءة AUTH_DIR من env، اشتقاق per-tenant authDir، اكتشاف مجلدات bootstrap-style (مع تجاهل الملفّات غير-مجلّدات)، إرسال `tenant_id` و `X-Internal-Api-Key` من backendClient إلى mock HTTP server.
- لا يستورد `sessionManager.js`/`session.js` لتجنّب الاعتماد على `@whiskeysockets/baileys` (الذي يحتاج git لتنزيله من GitHub).
- script في package.json: `npm run test:multitenant`.

**عدم الانحدار**:
- اختبارات Auth: **38/38 ناجحة** بعد تعديلات internal.js.
- اختبارات Admin: **47/47 ناجحة**.

**ملاحظة تشغيلية**:
- على Hetzner: `AUTH_DIR=/srv/jrd/data/bot-sessions` (دائم خارج الحاوية). البوت سيكتشف تلقائياً كل مجلد tenant موجود ويُقلع جلسته.
- إضافة tenant جديد: لا حاجة لـ deploy جديد. الأدمن يضغط "تشغيل" في الواجهة → POST `/sessions/:tenantId/start` → البوت يُنشئ مجلداً جديداً + يعرض QR.

---

### ✅ المرحلة 9 — Scrapers Multi-Tenant — منجزة (12 يونيو 2026)

**خلاصة القرارات**:
- **bayi scraper** (ephemeral): يبقى نفس الـ binary، يُشغَّل عند الطلب. عُزل filesystem إلى `BROWSER_DATA_ROOT/t<tenantId>/item-<itemId>/`.
- **messages-scraper** (long-running, browser-backed): **process per tenant** بدلاً من Map داخل process واحد. كل instance يحمل `GMSG_TENANT_ID` ويُرسله مع كل ingest. هذا أبسط (لا refactor للـ Scraper class) ويسمح بإعادة تشغيل tenant واحد دون التأثير على غيره.

**التغييرات الفعلية**:

1. [backend/src/scrapers.js](backend/src/scrapers.js) — `runBayiAlayatlScraper(config, { itemId, tenantId })`:
   - المسار الجديد: `BROWSER_DATA_ROOT/t<tenantId>/item-<itemId>/`.
   - `tenantId` افتراضياً 1 (توافق رجعي).
2. [backend/src/providers.js](backend/src/providers.js) — `case 'bayi_alayatl'` يمرّر `opts.tenantId`.
3. [backend/src/routes/apiConfigs.js](backend/src/routes/apiConfigs.js) — كل استدعاءات `fetchBalance(...)` تمرّر `tenantId: t` من `tid(req)`.
4. [messages-scraper/src/config.js](messages-scraper/src/config.js) — `tenantId: int('GMSG_TENANT_ID', 1)`.
5. [messages-scraper/src/backendClient.js](messages-scraper/src/backendClient.js) — `sendToBackend()` يُضمّن `tenant_id: config.tenantId`.

**إصلاح خلل في backend**:
- [backend/src/routes/internal.js](backend/src/routes/internal.js) `POST /bank-message/ingest` — كان يجلب `bankItem` بدون فلتر `tenant_id` (أوّل bank item عالمياً). الآن مُقيَّد بـ `WHERE i.tenant_id = ?`. هذا اختراق أمني للعزل تم سدّه.
- INSERTs للأخطاء في `bank_sms_log` (`no_pattern`, `no_bank_item`) كانت تعتمد على DEFAULT 1 لـ tenant_id. الآن تُمرّر `tId` صراحةً.

**Migration**:
- [backend/src/database.js](backend/src/database.js) — `UNIQUE INDEX` على `bank_transactions.external_id` كان عالمياً. أُسقِط واستُبدِل بـ `(tenant_id, external_id)` مركّب — dedup الآن per-tenant.

**اختبار** ([backend/test/test-scrapers.js](backend/test/test-scrapers.js)):
- **18/18 ناجحة**.
- يغطّي: عزل tenant على ingest (Test A/B)، dedup per-tenant مع UNIQUE الجديد (Test C)، tenant_id الافتراضي (Test D)، tenant_id في `bank_sms_log` الأخطاء (Test E)، tenant بلا bank item → 404 + log صحيح (Test F).
- script في package.json: `npm run test:scrapers`.

**عدم الانحدار**:
- Auth: **38/38**.
- Admin: **47/47**.
- Scrapers: **18/18**.

**ملاحظات نشر**:
- على Hetzner سنُشغّل instance من messages-scraper لكل tenant عبر docker-compose service template أو systemd template — كل instance على port مختلف (3101, 3102, ...) ومجلد `GMSG_BROWSER_DATA=/srv/jrd/data/gmsg-browser-data/t<tid>` مختلف.
- bayi scraper يبقى spawned عند الطلب — لا حاجة لتغيير infrastructure.

---

### ✅ المرحلة 10 — Per-Tenant Webhook Secrets — منجزة (12 يونيو 2026)

**الفكرة**: كل tenant له `sms_webhook_secret` فريد. الـ URL `/api/webhooks/bank-sms/:tenantSecret` يحدّد المستأجر من خلال الـ secret (lookup في `settings` table). الـ secret القديم يتوقّف فوراً عند التدوير.

**ما كان موجوداً قبل المرحلة 10**:
- `smsWebhookHandler` يقرأ `req.params.tenantSecret` ويبحث عنه في settings (موجود من المرحلة 6).
- التوافق الرجعي: `/api/bank/sms-webhook` يستخدم `SMS_WEBHOOK_SECRET` العام مع tenant=1.

**التغييرات في المرحلة 10**:

1. **Migration** ([backend/src/database.js](backend/src/database.js)):
   - إضافة عمود `settings.updated_at TEXT DEFAULT (datetime('now'))` (للقواعد القديمة + الجديدة).

2. **Backend** ([backend/src/routes/admin.js](backend/src/routes/admin.js)):
   - `POST /api/admin/tenants/:id/rotate-webhook-secret` — يولّد secret عشوائي 24-byte base64url ويُسجّله في `settings(tenant_id, 'sms_webhook_secret', secret, datetime('now'))` مع `ON CONFLICT(tenant_id, key) DO UPDATE`. يُعيد الـ secret + الـ webhook_path **مرّة واحدة فقط** (لا يُحفَظ نسخة مشفّرة، فلا يمكن استرجاعه — يجب التدوير لإصدار جديد).
   - `GET /api/admin/tenants/:id/webhook-status` — يخبر هل secret مُسجَّل + `last_rotated_at` (دون كشف الـ secret).

3. **CLI** ([backend/scripts/rotate-tenant-secret.js](backend/scripts/rotate-tenant-secret.js)):
   - `npm run tenant:rotate-secret <tenant_id>` — توليد/تدوير من سطر الأوامر (مفيد للنشر الأوّلي + scripting).
   - يطبع الـ secret + URL كامل (مع `PUBLIC_BASE_URL` env).

4. **Frontend** ([frontend/src/pages/AdminTenants.jsx](frontend/src/pages/AdminTenants.jsx)):
   - زرّ `<KeyRound>` بجانب كل مستأجر يفتح `WebhookSecretModal`.
   - الـ modal يعرض حالة الـ secret (مُسجَّل / غير مُسجَّل + آخر تدوير) وزرّ "توليد/تدوير".
   - عند التوليد: يعرض URL كامل + secret في صندوق بنفسجي بارز مع زرّ نسخ، ورسالة "احفظه الآن — لن يظهر ثانية".

5. **إصلاح أمني** ([backend/src/routes/bank.js](backend/src/routes/bank.js)):
   - `processSmsRequest` كان يستعمل `tenantId || 0` لتسجيل المحاولات غير المُخوَّلة → FK constraint failure على bank_sms_log. الآن: `tenantId || 1` (يقع log في tenant 1 الافتراضي كملاذ).

**اختبار** ([backend/test/test-webhook-secrets.js](backend/test/test-webhook-secrets.js)):
- **17/17 ناجحة**.
- يغطّي:
  - Test A: rotate يولّد secret + status يُرجع configured/last_rotated_at.
  - Test B: webhook call بـ secret صالح يوجّه لـ tenant الصحيح ولا يلمس غيره.
  - Test C: secret خاطئ → 401.
  - Test D: التدوير يُبطل القديم فوراً (401) + الجديد يعمل (200).
  - Test E: secret tenant B لا يصل لـ bank tenant A (عزل routing).
  - Test F: rotate يتطلّب admin auth (401 بدون token).

**عدم الانحدار**:
- Auth: 38/38 / Admin: 47/47 / Scrapers: 18/18 / Webhook: 17/17 = **120/120**.
- Frontend build: ناجح (973 kB bundle).

**ملاحظة نشر**:
- على Hetzner: بعد إنشاء tenant جديد من admin panel، الـ admin يضغط زرّ "Webhook"، يولّد secret، ينسخ الـ URL، ويرسله للمستأجر لإعداد SMS Forwarder.
- التوافق الرجعي: `/api/bank/sms-webhook` (مع `SMS_WEBHOOK_SECRET` env) يبقى يعمل لـ tenant 1. يُوصى بإلغاؤه بعد نقل كل المستأجرين القدامى إلى الـ URL الجديد.

---

### ✅ المرحلة 11 — Integration Test (end-to-end) — منجزة (12 يونيو 2026)

**الفكرة**: اختبار سيناريو حقيقي شامل يلمس كل المكوّنات معاً (auth + admin + items + webhook + bot ingest + cascade delete).

**اختبار** ([backend/test/test-integration.js](backend/test/test-integration.js)):
- **34/34 ناجحة**.
- 10 خطوات تحاكي رحلة كاملة:
  1. Admin login.
  2. Admin يُنشئ tenant + owner (في transaction واحدة).
  3. Admin يولّد webhook secret.
  4. Owner + owner ثانٍ (tenant آخر) يسجّلون دخول.
  5. Owner يُنشئ bank item — الـ tenant الآخر لا يراه (عزل قراءة).
  6. SMS عبر webhook → balance يتحدّث، الـ tenant الآخر لا يتأثّر (عزل كتابة).
  7. Bot ingest (مع `X-Internal-Api-Key` + `tenant_id`) → `whatsapp_messages` تُحفظ بـ tenant الصحيح.
  8. Owner يقرأ items + SMS log الخاصّ به فقط (count صحيح، entries صحيحة).
  9. Admin يحذف tenant → **6 جداول cascade**: items, current_values, bank_transactions, whatsapp_messages, users, settings — كلها صفر.
  10. Owner المحذوف لا يستطيع تسجيل دخول (401)، لكن tenant آخر ما يزال يعمل (200).

**عدم الانحدار** (إجمالي 5 مجموعات):
- Auth: 38/38 · Admin: 47/47 · Scrapers: 18/18 · Webhook: 17/17 · Integration: 34/34 = **154/154**.

---

### ✅ المرحلة 12 — Backups (Hetzner Storage Box) — منجزة (12 يونيو 2026)

**الفكرة**: نسخ احتياطي يومي تلقائي لكل ما لا يُعاد بناؤه (DB + auth_sessions + browser-data + gmsg-browser-data + tenants/uploads)، مع رفع خارج الخادم إلى Hetzner Storage Box، وأداة استرجاع آمنة.

**سكربتات** (`deploy/`):
- **[backup.sh](deploy/backup.sh)** (موجود مسبقاً): `.backup` snapshot لـ SQLite (آمن أثناء الكتابة) + `tar.gz` للجلسات + rsync إلى Storage Box عبر SSH (بورت 23) + retention (7 يومية + 12 شهرية). نسخة شهرية تلقائية أول يوم من كل شهر.
- **[restore.sh](deploy/restore.sh)** (جديد): سكربت استرجاع آمن — تأكيد `YES` + إيقاف app + نسخ الـ DB الحالي إلى `backups/pre-restore-<tag>/` (شبكة أمان) + فكّ الـ DB + `PRAGMA integrity_check` + استرجاع sessions + إعادة تشغيل + انتظار healthcheck. خيارات: `latest`، `--db-only`، `--monthly`، `--dry-run`، tag تفاعلي.
- **[backup-verify.sh](deploy/backup-verify.sh)** (جديد): فحص دوري بدون استرجاع — `gunzip -t` + `PRAGMA integrity_check` + `quick_check` + عدّ صفوف الجداول الحسّاسة (`tenants`, `users`, `items`, `current_values`, `bank_transactions`, `whatsapp_messages`, `settings`) + فحص بنية الـ tar. يكشف النسخ التالفة قبل الحاجة إليها.

**جدولة cron** (موصى بها):
```cron
30 3 * * *  /srv/jrd/app/deploy/backup.sh        >> /srv/jrd/data/backups/backup.log 2>&1
0  4 * * 0  /srv/jrd/app/deploy/backup-verify.sh >> /srv/jrd/data/backups/verify.log 2>&1
```

**إعداد Storage Box** (موثّق في [deploy/README.md](deploy/README.md) قسم "النسخ الاحتياطي"):
1. Hetzner → Storage Box (BX11 = ~4 €/شهر، 1 TB) → فعّل SSH + External reachability.
2. Sub-account منفصل للنسخ.
3. SSH key: `ssh-keygen -t ed25519 -f /root/.ssh/storage_box` + رفع المفتاح العام.
4. عبّئ `STORAGE_BOX_USER/HOST/PATH/PORT/KEY` في `deploy/.env`.

**الأمان**:
- المفتاح الخاص محصور في `/root/.ssh/` بصلاحيات 600.
- Sub-account معزول عن باقي Storage Box.
- النسخ المحلية في `/srv/jrd/data/backups/` خارج المسار العام.
- `restore.sh` لا يستبدل أي شيء بدون `PRAGMA integrity_check = ok`.

**RTO/RPO**:
- RPO: ≤ 24 ساعة (نسخة يومية 3:30 صباحاً).
- RTO: ~1–3 دقائق (DB-only) إلى ~10 دقائق (DB + sessions كاملة عبر `restore.sh latest`).

---

### ✅ المرحلة 13 — Railway Shutdown (cutover plan) — جاهزة (12 يونيو 2026)

**الفكرة**: خطّة cutover صارمة لإيقاف Railway بدون فقدان بيانات وبأقل انقطاع ممكن (≤ 30 دقيقة)، مع نافذة rollback آمنة 24 ساعة.

**الأدوات** (`deploy/`):
- **[cutover-checklist.md](deploy/cutover-checklist.md)** (جديد): قائمة فحص شاملة بـ 5 مراحل + rollback plan + تحقّقات DNS + جدول زمني T-30 / T-0 / T+15 / T+24h.
- **[railway-export.sh](deploy/railway-export.sh)** (جديد): يصدّر `final.db` + `sessions.tar.gz` من Railway عبر `railway CLI run`، يحسب SHA-256، ويفحص `integrity_check` محلياً قبل النقل.
- **[restore.sh](deploy/restore.sh)** (من المرحلة 12): يستقبل النسخ المنقولة على Hetzner ويُطبّقها بأمان.

**المراحل الخمس** (موثّقة في cutover-checklist.md):
1. **التحضير (T-7 أيام)**: تأكيد 154/154 + 3 نسخ احتياطية ناجحة + إخطار المستأجرين + خفض DNS TTL إلى 300s.
2. **التجميد (T-30 دقيقة)**: إيقاف بوت Railway + scrapers + إعلان الصيانة + `railway-export.sh`.
3. **النقل (T-15 دقيقة)**: `scp` للملفّين إلى Hetzner + `restore.sh cutover` + تحقّق DB.
4. **DNS Cutover (T-0)**: تغيير `A` لـ `ahlacard.net` و `www` إلى Hetzner IP + تفعيل بلوك Caddy للنطاق الرئيسي + `caddy reload`.
5. **التحقّق (T+15)**: healthz + UI + SMS اختباري + WhatsApp اختباري + فحص logs.
6. **الإغلاق (T+24 ساعة)**: حذف خدمات Railway (لكن إبقاء الـ project أسبوعاً) → بعد أسبوع: حذف نهائي + إلغاء الاشتراك.

**Rollback**:
- إن فشل أي فحص في مرحلة 4: إعادة DNS لـ Railway (TTL=300 → 5 دقائق) + تشغيل خدمات Railway. Railway DB لم يُمَسّ.
- **القيد**: أي كتابة جديدة بعد cutover تُفقد إن استُخدم rollback (لذلك التجميد في مرحلة 1 حاسم).

**ما تمّ تجهيزه** (artifacts فقط — التنفيذ على العميل):
- `deploy/cutover-checklist.md` (Markdown شامل).
- `deploy/railway-export.sh` (bash + railway CLI).
- `deploy/restore.sh` (موجود من المرحلة 12).
- توثيق DNS + Caddy reload في README.

**ما لم يُنفَّذ** (يحتاج تنسيقاً مع العميل):
- التنفيذ الفعلي لـ cutover (يتطلّب وصول Railway + Hetzner + DNS).
- إخطار المستأجرين.
- حذف Railway النهائي.

**ملاحظات أمان**:
- النسخة النهائية من Railway تُحفَظ في Storage Box (`cutover-archive/`) للأرشيف.
- لا يُحذف `/srv/jrd/data` تحت أي ظرف.
- المتغيرات الحسّاسة (`JWT_SECRET`, `INTERNAL_API_KEY`, `BOT_ENCRYPTION_KEY`) **لا تُنسَخ** من Railway — تُولَّد جديدة على Hetzner (وُلّدت مسبقاً في المرحلة 1).
- Cloudflare Worker (إن وُجد): يحتاج تحديث `BACKEND_URL` إلى Hetzner بعد cutover.

---

### 🟡 المرحلة 14 — UX/UI fixes للـ admin (مكتشفة من التشغيل المحلي 12 يونيو 2026) — قيد العمل

**السياق**: عند تشغيل المشروع محلياً بحساب `admin` لأوّل مرّة وفتح أي صفحة (Items / Bank / Archive / MonthlyArchive / Photos / Currency / ApiSettings / Inventory) تظهر رسالة "خطأ في تحميل…".

**السبب الجذري** (من backend logs):
```
Error: tenant_id_required: admin must specify X-Tenant-Id header or ?tenant_id= query
  at tid (file:///app/src/tenantHelpers.js:27:15)
  at file:///app/src/routes/items.js:9:13
```
- في المرحلة 6 صمّمنا `tid(req)` ليُجبر admin على تحديد tenant_id صراحةً عبر `X-Tenant-Id` أو `?tenant_id=` (حماية ضد كتابات عمياء على tenant 1).
- لكن الواجهة لا تُرسل header/query عندما يكون المستخدم admin → كل GET request يفشل بـ 400.
- owner عادي لا يتأثر (الـ tenant_id يُؤخَذ من JWT).

**اكتُشف bug إضافي أُصلح فوراً** ([backend/src/database.js](backend/src/database.js)):
- Migration 2.4.1 كان: `addColumn('settings', 'updated_at', "TEXT DEFAULT (datetime('now'))")` — SQLite يرفض DEFAULT غير ثابت في `ALTER TABLE ADD COLUMN`.
- **إصلاح**: ALTER بدون DEFAULT ثم `UPDATE … SET updated_at = datetime('now')`. الـ CREATE TABLE الأصلي يبقى مع DEFAULT (مسموح هناك).
- كان سيظهر على Hetzner عند ترقية أي قاعدة قديمة!

**الخطّة (المرحلة 14)** — تتطلّب جلسة جديدة:

1. **Tenant Switcher في الـ Sidebar للـ admin**:
   - dropdown يعرض كل المستأجرين (`GET /api/admin/tenants`).
   - الاختيار يُخزَّن في `localStorage` ويُرسَل في كل request عبر axios interceptor كـ `X-Tenant-Id`.
   - عند الاختيار، الـ admin يرى/يكتب في tenant معيّن — كأنه owner.
   - خيار "كل المستأجرين" يُعطّل الصفحات التي تحتاج tenant واحد (يظهر تنبيه: "اختر مستأجراً لعرض البيانات").

2. **axios interceptor** ([frontend/src/api.js](frontend/src/api.js)):
   - يقرأ tenant id من localStorage.
   - يضيف `X-Tenant-Id` على كل request إن وُجد.
   - يضيف header فقط إن لم يكن endpoint إدارياً (`/admin/*` لا يحتاجه).

3. **رسائل خطأ أوضح في الواجهة**:
   - بدل "خطأ في التحميل" → "اختر مستأجراً من القائمة العلوية" عند رؤية 400 + `tenant_id_required`.
   - toast من react-toastify بدل alert صامت.

4. **اختبار يدوي**:
   - admin يدخل → يختار tenant 1 → يرى الـ Dashboard العادي.
   - admin يبدّل لـ tenant 2 → البيانات تتبدّل.
   - admin يختار "كل المستأجرين" → الصفحات تعرض رسالة واضحة.

5. **بديل اختياري** (لو أُلغي tenant switcher):
   - جعل admin بدون X-Tenant-Id يرى كل المستأجرين معاً (UNION بـ tenant_id كـ column) — تعقيد كبير، غير محبَّذ.

**ملاحظة**: المشروع يعمل صحيحاً للـ owner. هذه المشكلة تظهر فقط للـ admin role وهي تصميم متعمَّد (المرحلة 6 رفض الكتابة بدون tenant)، تحتاج فقط واجهة لاختياره.

---

## 4) الخطّة — تحويل النظام إلى Multi-Tenant على Hetzner

> **القرارات النهائية من المالك**:
> - **الاستضافة الجديدة**: Hetzner (VPS/Cloud Server) — موارد أكبر وتحكّم كامل.
> - **Railway يبقى يعمل بدون أي تعديل** لأن موقع شحن الألعاب يعتمد عليه للمطابقة. سنُوقفه فقط بعد استقرار Hetzner.
> - **مرحلة "استضافتان معاً"**: نُطلق نسخة Multi-Tenant جديدة كاملة على Hetzner بالتوازي مع استمرار Railway.
> - كل عميل = حساب + بيانات معزولة + بوت واتساب خاص + scrapers خاصة.
> - لا فوترة، لا اشتراكات، لا Landing تسويقي الآن.
> - عدد العملاء المتوقّع في البداية: 5-20 صديق في نفس المجال.
> - حساسية البيانات منخفضة (عمليات حسابية فقط).

---

### 4.1) المبدأ الذهبي للنشر — فصل الكود عن البيانات نهائياً

> **القاعدة**: التحديث يطال **الكود فقط**. البيانات والجلسات والإعدادات **لا تتأثر أبداً** بأي deploy.

#### الإجابة على سؤال المالك: لماذا الجلسات تنقطع على Railway مع كل deploy؟

**السبب باختصار**: حاوية Railway تُبنى من الصفر مع كل push. أي ملف **خارج** المسار `/data` (الـ Volume) يضيع.

في إعداد المشروع الحالي:
- بوت واتساب: `process.env.AUTH_DIR || './auth_sessions'` ([bot/src/config.js](bot/src/config.js))
- Google Messages: `process.env.GMSG_BROWSER_DATA || './browser-data'` ([messages-scraper/src/config.js](messages-scraper/src/config.js))

لو هذه المتغيّرات غير مضبوطة على Railway لتشير إلى `/data/...`، الجلسات تُكتب في الحاوية المؤقتة وتُمسح. هذا هو السبب.

**على Hetzner لن نُكرّر هذا الخطأ** — التصميم أدناه يضمن انفصالاً تامّاً ودائماً.

#### بنية المجلدات على Hetzner

```
/srv/jrd/                                ← يبقى دائماً، لا يُمسّ مع أي deploy
├── app/                                 ← الكود (git clone) — يُحدَّث بـ git pull
│   ├── backend/  bot/  frontend/  scraper/  messages-scraper/
│   ├── Dockerfile  start.sh
│   ├── deploy/
│   │   ├── docker-compose.yml
│   │   ├── Caddyfile
│   │   ├── deploy.sh
│   │   └── backup.sh
│   └── .env                             ← أسرار، مفاتيح
│
└── data/                                ← bind-mounted داخل الحاوية كـ /data
    ├── db/
    │   └── jrd.db                       ← قاعدة بيانات SQLite (واحدة لكل المستأجرين)
    ├── tenants/
    │   ├── 1/                           ← المستأجر الأوّل (أنت)
    │   │   ├── auth_sessions/           ← جلسة Baileys
    │   │   ├── browser-data/            ← جلسات bayi.alayatl.com
    │   │   │   └── item-<id>/
    │   │   ├── gmsg-browser-data/       ← جلسة Google Messages
    │   │   └── uploads/                 ← صور المستأجر
    │   ├── 2/  3/  4/  ...
    │   └── ...
    └── backups/                         ← snapshots دورية (cron)
        └── jrd-2026-06-12.db.gz
```

#### كيف يضمن هذا "لا انقطاع"؟
- **docker-compose** يستخدم `volumes: ['/srv/jrd/data:/data']` (bind mount).
- النشر = `git pull && docker compose build && docker compose up -d`.
- الحاوية تُعاد بناء الكود فقط. مجلد `/data` على المضيف ثابت تماماً ويُعاد ربطه كما هو.
- الجلسات والـ DB والصور = **لا تتأثر إطلاقاً**.
- وقت الانقطاع الفعلي للخدمة = ثوانٍ معدودة (إعادة تشغيل الحاوية فقط).

---

### 4.2) القرارات المعمارية الأساسية

| الموضوع | القرار |
|---------|--------|
| **الاستضافة** | Hetzner Cloud (نبدأ بـ CCX13 أو CCX23 — 8-16 GB RAM) |
| **التشغيل** | Docker Compose واحد على المضيف، لا Kubernetes |
| **قاعدة البيانات** | تبقى **SQLite** (better-sqlite3) — كافية حتى مئات الآلاف من الصفوف لـ 20 مستأجر. هجرة لـ PostgreSQL لاحقاً عند الحاجة. |
| **عزل البيانات** | عمود `tenant_id` في كل جدول + middleware يفلتر تلقائياً |
| **المصادقة** | JWT في cookie httpOnly + bcrypt للكلمات السرّية |
| **التسجيل** | لا تسجيل ذاتي — أنت (admin) تنشئ الحسابات من لوحة Admin |
| **بوت واتساب** | جلسة لكل مستأجر في `/data/tenants/<tid>/auth_sessions/` — تبقى مفتوحة دائماً |
| **scraper bayi** | جلسة لكل مستأجر في `/data/tenants/<tid>/browser-data/item-<id>/` — يعمل **عند الطلب** فقط |
| **scraper Google Messages** | جلسة لكل مستأجر في `/data/tenants/<tid>/gmsg-browser-data/` — يبقى مفتوحاً |
| **الرفع/الصور** | `/data/tenants/<tid>/uploads/` |
| **النطاقات** | نطاق واحد، تمييز المستأجر بالحساب المسجَّل (لا subdomains الآن) |
| **الأدوار** | `admin` (أنت) + `owner` (كل عميل) |
| **HTTPS** | Caddy reverse proxy (شهادة Let's Encrypt تلقائياً) |
| **النسخ الاحتياطي** | cron يومي إلى `/srv/jrd/data/backups/` + رفع لـ Hetzner Storage Box (اختياري) |
| **المراقبة** | logs عبر `docker compose logs` + healthcheck endpoint موجود |

---

### 4.3) Schema الجديد — التغييرات على قاعدة البيانات

#### جداول جديدة
```sql
CREATE TABLE tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('admin','owner')),
  is_active INTEGER DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

#### تعديل الجداول الموجودة
نُضيف `tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` + index لكل من:
`items`, `current_values`, `api_configs`, `inventories`, `inventory_items`, `monthly_inventories`, `monthly_inventory_items`, `photos`, `settings`, `bank_transactions`, `bank_sms_log`, `whatsapp_messages`, `whatsapp_transactions`.

> **الهجرة على Hetzner**: نبدأ بـ DB فارغة + tenant_id=1 لك. لاحقاً يمكن استيراد بيانات Railway إن أردت.

---

### 4.4) Backend — التغييرات

#### Middleware جديد
```
auth.js          → يقرأ JWT من cookie، يستخرج user → req.user = { id, tenant_id, role }
tenantScope.js   → كل query في الـ routes تُفلتر بـ tenant_id تلقائياً
adminOnly.js     → يحمي مسارات /api/admin/*
```

#### Routes جديدة
```
POST   /api/auth/login         → email+password → cookie + user info
POST   /api/auth/logout        → يمسح الـ cookie
GET    /api/auth/me            → معلومات المستخدم الحالي

GET    /api/admin/tenants      → قائمة المستأجرين (admin فقط)
POST   /api/admin/tenants      → إنشاء مستأجر + مستخدم owner
PATCH  /api/admin/tenants/:id  → تفعيل/تعطيل/تعديل
DELETE /api/admin/tenants/:id  → حذف (مع كل بياناته ومجلداته)
POST   /api/admin/users/:id/reset-password
```

#### تعديل routes الموجودة
كل query تُضيف `WHERE tenant_id = ?` و `INSERT` يُضيف `tenant_id` تلقائياً عبر helper.
Webhooks (`/api/bank/sms-webhook`, `/api/internal/ingest`) تحتاج معرفة المستأجر:
- الحلّ المقترح: **مفتاح خاص لكل مستأجر** في الـ URL: `/api/bank/sms-webhook/<tenant_secret>`
- المستأجر يضع هذا الـ URL في تطبيق SMS Forwarder على جواله.

---

### 4.5) البوت والـ Scrapers — التعديلات

#### بوت الواتساب
- `SessionManager` يدير `Map<tenantId, Session>`.
- bootstrap عند بدء البوت: يقرأ كل المستأجرين النشطين ويفتح جلساتهم تلقائياً.
- المسار الجديد: `/data/tenants/<tid>/auth_sessions/`.
- المتغيّر `AUTH_DIR` يتحوّل من ثابت إلى دالّة `getAuthDir(tenantId)`.

#### scraper bayi
- كل بند `bayi_alayatl` لكل مستأجر → مجلد جلسة منفصل.
- المسار: `/data/tenants/<tid>/browser-data/item-<id>/`.
- يُشغَّل عند الطلب فقط، ينتهي بعد جلب الرصيد.

#### scraper Google Messages
- جلسة لكل مستأجر تربط رقمه.
- المسار: `/data/tenants/<tid>/gmsg-browser-data/`.
- يبقى مفتوحاً (يستهلك RAM، لكن لازم لاستقبال الرسائل الفورية).

---

### 4.6) Frontend — التغييرات

#### صفحات جديدة
- **`/login`** — نموذج (email + password).
- **`/admin/tenants`** — لوحة Admin فقط: إنشاء/تعطيل/إعادة تعيين كلمة سر.
- **`/admin/system`** (اختياري) — حالة الخدمات (بوت، scrapers، DB، disk).

#### تعديلات
- **AuthContext** يحفظ user/role ويعرض الصفحات تبعاً.
- **Sidebar**: تظهر "إدارة المستأجرين" لـ admin فقط.
- **زرّ "تسجيل خروج"** + اسم المستأجر في الـ header.
- **Axios interceptor**: عند 401 → redirect إلى `/login`.

---

### 4.7) البنية التحتية على Hetzner — التفاصيل العملية

#### المكوّنات
1. **Hetzner Cloud Server** — Ubuntu 24.04 (CCX13: 2 vCPU، 8 GB RAM، 80 GB SSD، ~13 €/شهر).
2. **Docker + Docker Compose** — التشغيل.
3. **Caddy** — reverse proxy + HTTPS تلقائي.
4. **النطاق**: نطاق جديد للمنصّة (مثلاً `jrd.example.com`). Railway يبقى على `ahlacard.net`.
5. **Hetzner Storage Box** (اختياري، ~4 €/شهر) — للنسخ الاحتياطي خارج الخادم.

#### ملفات جديدة نضيفها للمستودع
```
deploy/
├── docker-compose.yml      ← يصف خدمتين: jrd-app + caddy
├── Caddyfile               ← إعداد reverse proxy + HTTPS
├── deploy.sh               ← سكربت "git pull + rebuild + restart"
├── backup.sh               ← cron يومي لـ /data → /data/backups/
├── .env.example            ← قائمة بكل المتغيّرات المطلوبة
└── README.md               ← خطوات الإعداد الأوّل + الاستخدام اليومي
```

> **مهم**: لا نُعدِّل `Dockerfile` و `start.sh` و `railway.toml` الحاليين. يعملون مع Railway كما هما. ملفات `deploy/` الجديدة للـ Hetzner فقط، **لا تؤثّر على Railway إطلاقاً**.

#### docker-compose (مختصر)
```yaml
services:
  app:
    build: ..
    restart: unless-stopped
    environment:
      DATA_DIR: /data
      NODE_ENV: production
      JWT_SECRET: ${JWT_SECRET}
      INTERNAL_API_KEY: ${INTERNAL_API_KEY}
      BOT_ENCRYPTION_KEY: ${BOT_ENCRYPTION_KEY}
    volumes:
      - /srv/jrd/data:/data        # ← bind mount: البيانات لا تموت
    expose:
      - "3001"
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
volumes:
  caddy_data:
  caddy_config:
```

#### Caddyfile
```
jrd.example.com {
  reverse_proxy app:3001
}
```

#### دورة النشر اليومية
```bash
ssh root@hetzner
cd /srv/jrd/app
git pull
docker compose -f deploy/docker-compose.yml build app
docker compose -f deploy/docker-compose.yml up -d app
# انتهى — البيانات في /srv/jrd/data ثابتة
```

---

### 4.8) مراحل التنفيذ — بالترتيب

> كل مرحلة مستقلّة وقابلة للنشر. Railway يبقى يعمل خلال كل المراحل.

| # | المرحلة | المخرَجات |
|---|---------|-----------|
| 1 | **ملفات النشر على Hetzner** | `deploy/docker-compose.yml` + `Caddyfile` + `deploy.sh` + `backup.sh` + README. اختبار محلي بـ Docker. |
| 2 | **إعداد خادم Hetzner** | Ubuntu + Docker + clone للمستودع + ضبط UFW + NTP. تشغيل تجريبي بالنسخة الحالية (قبل multi-tenant) لتأكيد البنية. |
| 3 | **DB Migration** | إضافة `tenants`/`users`/`auth_sessions` + `tenant_id` لكل جدول. tenant_id=1 للبيانات الموجودة. |
| 4 | **Auth Backend** | login/logout/me + JWT + bcrypt + middlewares. |
| 5 | **Auth Frontend** | `/login` + AuthContext + حماية الصفحات + تسجيل خروج. |
| 6 | **Tenant Scoping** | كل route ينفّذ queries مقيّدة بـ tenant_id الخاص بـ req.user. |
| 7 | **Admin Panel** | `/admin/tenants` + APIs الإدارة. تستطيع إنشاء عملاء. |
| 8 | **عزل البوت** | SessionManager لكل tenant + مسارات جلسات منفصلة + bootstrap. |
| 9 | **عزل الـ Scrapers** | bayi + gmsg لكل مستأجر في مجلدات منفصلة. |
| 10 | **عزل الـ Webhooks** | tenant_secret في URL: `/sms-webhook/<secret>`. |
| 11 | **اختبار شامل** | إنشاء مستأجر تجريبي + ربط واتسابه + بنوكه + جرد كامل. |
| 12 | **النسخ الاحتياطي + المراقبة** | cron + healthcheck + log rotation. |
| 13 | **إيقاف Railway** | بعد ≥ أسبوعين من استقرار Hetzner. |

---

### 4.9) أسئلة سريعة أحتاج إجاباتك عليها قبل البدء بالمرحلة 1

1. **خادم Hetzner**: هل لديك حساب جاهز؟ هل لديك تفضيل في المنطقة (Falkenstein / Helsinki / Nuremberg)؟ هل تريد البدء بـ **CCX13** (8 GB RAM، ~13 €/شهر) أم **CCX23** (16 GB RAM، ~26 €/شهر، أفضل للنموّ)؟
2. **النطاق**: ما النطاق الذي ستستخدمه للمنصّة الجديدة؟ (سأحتاجه لإعداد Caddyfile و DNS)
3. **slug المستأجر**: نستخدم اسماً نظيفاً (مثل `ahmed-store`)؟ من يختاره — أنت عند الإنشاء أم نولّده تلقائياً من الاسم؟
4. **كلمة السر الأولى للعميل**: أنت تختارها، أم النظام يولّد عشوائية؟
5. **استرجاع كلمة السر**: عند نسيانها → admin يعيد تعيينها يدوياً (لا email)؟ مقبول؟
6. **النسخ الاحتياطي**: هل تريد رفع النسخ إلى **Hetzner Storage Box** (~4 €/شهر، آمن خارج الخادم) أم محلياً فقط على نفس الخادم؟
7. **بيانات Railway الحالية**: هل تريد لاحقاً **نقلها إلى Hetzner** (كـ tenant_id=1) أم نبدأ Hetzner بقاعدة بيانات فارغة جديدة؟
8. **إدارة الخادم**: هل لديك SSH key جاهز؟ هل تريدني أن أكتب دليلاً تفصيلياً للإعداد الأوّلي للخادم (خطوة بخطوة)؟

---

### 4.10) القرارات النهائية من المالك (12 يونيو 2026)

| # | السؤال | القرار |
|---|--------|--------|
| 1 | **عائلة الخادم** | **CCX** (Dedicated vCPU) — التوصية: **CCX23** (16 GB RAM، 4 vCPU، 160 GB SSD، ~26 €/شهر). السبب: كل مستأجر يستهلك ~300-500 MB لكل جلسة Chrome (bayi + Google Messages) + جلسة واتساب. مع 5-20 مستأجر، 8 GB ضيّقة. CCX13 ممكنة لاحقاً عند الحاجة فقط. |
| 2 | **النطاق** | يبقى **`ahlacard.net`** هو النطاق الرئيسي. <br>**أثناء التشغيل المزدوج**: نستخدم نطاقاً فرعياً مؤقّتاً على Hetzner مثل **`new.ahlacard.net`** (أو `v2.ahlacard.net`). Railway يبقى على `ahlacard.net`. <br>**بعد الاستقرار**: نُبدّل DNS لـ `ahlacard.net` → IP Hetzner ونوقف Railway. النطاق الفرعي يبقى أو يُحذف. |
| 3 | **إنشاء العملاء** | يدوياً عبر admin فقط. لا تسجيل ذاتي. لا توليد آلي. <br>المالك يحدّد: اسم المستأجر + email المستخدم + كلمة السر + slug. <br>لاحقاً (إن أراد المالك)، نضيف زرّ "توليد كلمة سرّ قوية" كاختيار، لكن الافتراضي = إدخال يدوي. |
| 4 | **النسخ الاحتياطي** | **Hetzner Storage Box** منفصل (~4 €/شهر، 1 TB، خارج الخادم). <br>الآلية: cron يومي → snapshot لقاعدة البيانات + ضغط + رفع عبر `rsync` فوق SSH أو `borg` إلى Storage Box. retention: آخر 30 يوماً يومياً + آخر 12 شهراً شهرياً. |
| 5 | **استمرار الجلسات** *(نقطة المالك المضافة)* | **شرط جوهري**: جلسات واتساب وبنك (Google Messages) و scrapers (bayi.alayatl.com) **لا تضيع أبداً** عند: <br>• `git pull` و `docker compose build`. <br>• `docker compose down/up` (إعادة تشغيل الحاوية). <br>• إعادة تشغيل الخادم نفسه (`reboot`). <br>**الضمان**: كل هذه الجلسات تُكتب داخل `/srv/jrd/data/` على المضيف (bind mount). الحاوية تُبنى من جديد لكن المجلد على المضيف لا يُمَسّ. هذا مذكور في 4.1 كمبدأ ذهبي ومُلزَم به في كل ملفات `deploy/`. |
| 6 | **بنود مؤجَّلة للحوار** | (3) slug، (5) استرجاع كلمة السر، (7) نقل بيانات Railway، (8) دليل إعداد الخادم — تُعالَج في مراحلها (3 و 4 و 7 و 2 على التوالي). افتراضات مبدئية: <br>• slug: يولَّد تلقائياً من الاسم + يُسمَح بتحريره يدوياً. <br>• استرجاع: admin يعيد التعيين، لا email. <br>• بيانات Railway: نبدأ Hetzner فارغاً، نُقرّر النقل لاحقاً بعد اختبار النظام. <br>• دليل الخادم: سيُكتب في `deploy/README.md` كاملاً. |

---

> **ابتداءً من هذه النقطة**، أبدأ المرحلة 1 (ملفات النشر في `deploy/`) ثم المرحلة 2 (إعداد الخادم) ثم باقي المراحل بالترتيب.

---
---

# الجزء 13: التنفيذ الفعلي على Hetzner (2026-06-12)

> هذا القسم يوثّق ما تم تنفيذه فعلياً بعد كتابة الخطة، مع كل الأوامر والملفات الجديدة والحلول للمشاكل التي ظهرت.

## 13.1) إنشاء السيرفر على Hetzner Cloud

- **اسم الخادم**: `jrd-prod`
- **النوع**: CCX (8 GB RAM، Dedicated vCPU)
- **النظام**: Ubuntu 24.04 LTS
- **الموقع**: Falkenstein, Germany (FSN1)
- **IP**: `167.233.124.62`
- **كلمة سرّ root**: `cXnLKrrJPiFq` (تعمل فقط في Hetzner Console KVM)
- **SSH**: لا يقبل كلمة المرور — مفاتيح فقط

### تركيب SSH key من سطح المكتب

- **اسم المفتاح**: `~/.ssh/jrd_hetzner_desktop` / `jrd_hetzner_desktop.pub`
- **النوع**: ed25519
- **Fingerprint**: `SHA256:PZll0VaENSeBCR3YLy5VdbYraztT7ZGcjJTBIGk/3I8`

#### المشكلة 1: لصق المفتاح في Hetzner Console يفسد الأحرف
Hetzner Console استبدلت `_` بـ `-` و `0` بـ `O`، فلم يُقبل المفتاح.

#### الحل: دفع المفتاح عبر git pull
ملف جديد: `deploy/keys/desktop.pub`

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINjmT9Lrh0cbzacmLJ4D5l1yDeaM15nvc8ZvXh/t3YvU jrd-hetzner-desktop
```

ثم على الخادم (عبر Console):

```bash
cd /srv/jrd/app && git pull
mkdir -p /root/.ssh && chmod 700 /root/.ssh
cp deploy/keys/desktop.pub /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

#### المشكلة 2: `/etc/ssh/sshd_config` مفقود
الخادم بدون `sshd_config` (الموجود فقط `/usr/share/openssh/sshd_config`).

#### الحل: سكربت `deploy/keys/fix-ssh.sh`

```bash
#!/usr/bin/env bash
set -e
[ -f /etc/ssh/sshd_config ] || cp /usr/share/openssh/sshd_config /etc/ssh/sshd_config
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-jrd-root-key.conf <<EOF
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
EOF
sshd -t && systemctl restart ssh
```

بعد ذلك SSH يعمل من سطح المكتب:

```powershell
ssh -i $HOME\.ssh\jrd_hetzner_desktop -o IdentitiesOnly=yes root@167.233.124.62
```

---

## 13.2) نشر Docker stack

### نسخ المشروع وبناء الصور

```bash
mkdir -p /srv/jrd
cd /srv/jrd
git clone https://github.com/Lebid15/jrd.git app
cd app/deploy
cp .env.example .env
# توليد الأسرار
sed -i "s|^INTERNAL_API_KEY=.*|INTERNAL_API_KEY=$(openssl rand -hex 32)|" .env
sed -i "s|^BOT_ENCRYPTION_KEY=.*|BOT_ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^SMS_WEBHOOK_SECRET=.*|SMS_WEBHOOK_SECRET=$(openssl rand -hex 32)|" .env
chmod 600 .env
docker compose up -d --build
```

### الحاويات الجارية

- **`jrd-app`**: العقدة الرئيسية، تستمع على 3001 داخلياً.
- **`jrd-caddy`**: reverse proxy، يستمع 80/443، شهادة Let's Encrypt تلقائياً.

### تعديل النطاق

`deploy/Caddyfile` تم تغييره من `new.ahlacard.net` إلى `alaya.ahlacard.net`.

### تعديل `deploy/.env.example`

`WEBHOOK_BASE_URL` تم تحديثه إلى `https://alaya.ahlacard.net`.

---

## 13.3) DNS على Cloudflare

| Record | Type | Value | Proxy |
|--------|------|-------|-------|
| `alaya.ahlacard.net` | A | `167.233.124.62` | DNS only (رمادي) |
| `ahlacard.net` | CNAME | `3j5ti2rp.up.railway.app` | (لا يزال Railway) |

> Proxy رمادي وليس برتقالي، لكي يحصل Caddy على شهادة Let's Encrypt مباشرة.

شهادة HTTPS صدرت تلقائياً من Caddy + Let's Encrypt على `alaya.ahlacard.net`.

---

## 13.4) إنشاء المسؤول الأول (admin)

استخدمنا السكربت الموجود `backend/scripts/create-admin.js`:

```bash
ssh -i ~/.ssh/jrd_hetzner_desktop root@167.233.124.62 \
  "docker exec jrd-app node backend/scripts/create-admin.js \
   --email=lebid.hac.alaye@gmail.com --password='Asdf1212asdf!!'"
```

النتيجة:
- `id=1`, `role=admin`, `tenant_id=NULL`
- البريد: `lebid.hac.alaye@gmail.com`
- كلمة السرّ: `Asdf1212asdf!!`

### ملاحظة عن واجهة الأدمن
الأدمن يدخل من نفس صفحة `/login` ثم ينتقل إلى `/admin/tenants`. أي صفحة أخرى تُعيد 400 لأن المسارات تتطلب `tenant_id` (وهو `NULL` للأدمن) — هذا متوقّع.

---

## 13.5) إنشاء أول مستأجر (ziyad)

من واجهة `/admin/tenants` كأدمن:

- **اسم المستأجر**: `ziyad`
- **Slug**: `ziyad`
- **`tenant_id`**: `2`
- **المالك**: `Zeyadmo.Business@gmail.com` / `7766Alaya`

تم التحقق من تسجيل الدخول كمالك بنجاح.

---

## 13.6) ترحيل بيانات Railway إلى مستأجر زياد

### المشكلة
Railway CLI غير مُثبّت محلياً، وكل خدمات الرفع المجانية (file.io, transfer.sh, 0x0.st, bashupload) لم تعمل.

### الحل: استخدام واجهة Railway HTTP نفسها كقناة نقل
الخدمة تخدم `/uploads` بشكل عام بدون مصادقة، فاستعملناها كقناة نقل مؤقتة.

#### في Railway Console

```bash
# 1) نسخة نظيفة من DB (تدمج WAL)
cd /app/backend && node -e "
const D=require('better-sqlite3');
const s=new D('/app/backend/data/jrd.db',{readonly:true});
s.exec(\"VACUUM INTO '/tmp/jrd-railway.db'\");
console.log('OK', require('fs').statSync('/tmp/jrd-railway.db').size);
"

# 2) ضع الملف في /uploads ليكون متاحاً عبر HTTP
cp /tmp/jrd-railway.db /app/backend/data/uploads/jrd-railway.db
```

#### على Hetzner

```bash
mkdir -p /srv/jrd/migration
curl -fsSL https://ahlacard.net/uploads/jrd-railway.db -o /srv/jrd/migration/jrd-railway.db
sha256sum /srv/jrd/migration/jrd-railway.db
# 834b47d8788d71ea01803a2be7bcf0ecf19e902091d12cc61075b141625e3a37
```

### اكتشاف مهم
قاعدة Railway كانت **مُحدَّثة بالفعل** بـ multi-tenant schema (كل الجداول فيها عمود `tenant_id` بقيمة `1`). الخطّة الأصلية افترضت schema قديم بدون tenant_id، لكن الواقع أبسط: مجرد نسخ الصفوف وتحويل `tenant_id` من `1` إلى `2`.

### ملف جديد: `backend/scripts/migrate-railway-to-tenant.js`

- يستخدم `better-sqlite3` لفتح المصدر (read-only) والهدف (عبر `database.js` الحالي).
- ينسخ كل الجداول الـ 13 (items, current_values, api_configs, inventories, inventory_items, monthly_inventories, monthly_inventory_items, photos, settings, bank_transactions, bank_sms_log, whatsapp_messages, whatsapp_transactions).
- يحوّل `tenant_id = 1 → target`.
- يحافظ على الـ IDs الأصلية، ويحدّث `sqlite_sequence` للجداول AUTOINCREMENT.
- يستخدم `INSERT OR REPLACE` لجدول `settings` (مفتاح مركّب `tenant_id+key`).
- يدعم `--dry-run` (يعمل كل شيء في transaction ثم rollback).
- كل العملية داخل transaction واحدة — أي خطأ → rollback كامل.

### ملف مساعد: `backend/scripts/list-tenants.js`
يعرض كل المستأجرين والمستخدمين من DB الحيّة عبر `better-sqlite3` (لأن WAL لا يُقرأ بـ `sqlite3` CLI أثناء عمل التطبيق).

### ملف مساعد: `deploy/inspect-railway-db.sh`
يعرض schemas وعدد صفوف كل جدول من نسخة Railway.

### خطوات النقل الفعلية

```bash
# 1) backup
cp /srv/jrd/data/jrd.db     /srv/jrd/data/jrd.db.pre-migration-$(date +%s)
cp /srv/jrd/data/jrd.db-wal /srv/jrd/data/jrd.db-wal.pre-migration-$(date +%s)

# 2) نسخ السكربت والـ DB داخل الحاوية
docker cp /srv/jrd/app/backend/scripts/migrate-railway-to-tenant.js \
          jrd-app:/app/backend/scripts/migrate-railway-to-tenant.js
docker exec jrd-app mkdir -p /data/migration
docker cp /srv/jrd/migration/jrd-railway.db jrd-app:/data/migration/jrd-railway.db

# 3) dry-run
docker exec jrd-app node backend/scripts/migrate-railway-to-tenant.js \
  --source=/data/migration/jrd-railway.db --target-tenant=2 --dry-run

# 4) النقل الفعلي
docker exec jrd-app node backend/scripts/migrate-railway-to-tenant.js \
  --source=/data/migration/jrd-railway.db --target-tenant=2
```

### نتيجة النقل (10,170 صف)

| Table | Rows |
|-------|-----:|
| items | 50 |
| current_values | 50 |
| api_configs | 13 |
| inventories | 29 |
| inventory_items | 673 |
| monthly_inventories | 2 |
| monthly_inventory_items | 40 |
| photos | 1 |
| settings | 9 |
| bank_transactions | 48 |
| bank_sms_log | 9,115 |
| whatsapp_messages | 106 |
| whatsapp_transactions | 34 |
| **المجموع** | **10,170** |

المستأجر زياد يرى الآن كل بياناته القديمة من Railway على `https://alaya.ahlacard.net`.

---

## 13.7) الحلول التقنية المُكتشفة

### المشكلة: `sqlite3` CLI داخل الحاوية يقرأ DB فارغة
الحاوية لا تحوي `sqlite3`. و WAL يحفظ كل الكتابات الحديثة، فلا تظهر في `sqlite3` CLI من على الـ host.

### الحل
استعمال `node -e` مع `better-sqlite3` الموجود فعلاً في الحاوية، أو `VACUUM INTO` لإنشاء نسخة نظيفة.

### المشكلة: PowerShell يفسد الأوامر المُرسلة عبر SSH
PowerShell يوسّع `$()` و `$variable` محلياً قبل إرسالها، وعلامات الاقتباس المُختلطة تنكسر.

### الحل
- استخدام single-quoted strings في PowerShell عند إرسال أوامر معقدة عبر SSH.
- كتابة سكربتات `.sh` و `.js` ودفعها عبر `git pull` بدلاً من سطر-أوامر طويل.
- `scp` للملفات المعقّدة بدل eval.

---

## 13.8) الملفات الجديدة في هذه الجلسة

| الملف | الغرض |
|------|------|
| `deploy/keys/desktop.pub` | Public key لسطح المكتب |
| `deploy/keys/fix-ssh.sh` | إصلاح `sshd_config` المفقود |
| `deploy/inspect-railway-db.sh` | فحص schema وعدد صفوف Railway DB |
| `backend/scripts/list-tenants.js` | قائمة المستأجرين والمستخدمين من DB الحيّة |
| `backend/scripts/migrate-railway-to-tenant.js` | السكربت الرئيسي لنقل بيانات Railway |

## 13.9) الملفات المُعدّلة

| الملف | التغيير |
|------|--------|
| `deploy/Caddyfile` | `new.ahlacard.net` → `alaya.ahlacard.net` |
| `deploy/.env.example` | `WEBHOOK_BASE_URL` → alaya |
| `info.md` | تحديث بيانات Hetzner + بيانات الأدمن |

---

## 13.10) حالة الإنتاج الحالية (نهاية الجلسة)

### يعمل
- `https://alaya.ahlacard.net` على Hetzner مع HTTPS.
- admin: `lebid.hac.alaye@gmail.com` / `Asdf1212asdf!!`.
- owner زياد: `Zeyadmo.Business@gmail.com` / `7766Alaya` — يرى بياناته القديمة.
- النسخة الاحتياطية للـ DB قبل النقل: `/srv/jrd/data/jrd.db.pre-migration-*`.

### Railway لا يزال يعمل
- `https://ahlacard.net` (CNAME → Railway) ولم يُغلق بعد.
- GitHub auto-deploy على Railway: **مُعطّل**.
- **لا تضغط زر `Deploy` في Railway dashboard** — يوجد تغيير معلّق سيُحدّثه للكود الجديد ويخرّب DB القديمة.

### المتبقّي

1. **DNS cutover**: تحويل `ahlacard.net` من Railway إلى Hetzner.
2. **Cron backup**: جدولة نسخ احتياطي يومي/ساعي خارج الخادم.
3. **نقل صور uploads**: ملف واحد `1e9fcc47-2041-4eb2-9d0b-658d8a254fbe.png` (`mlogo10.png`) من Railway → Hetzner.
4. **إيقاف Railway**: بعد التأكد من استقرار Hetzner لعدة أيام.

---

## 13.11) أوامر تشغيلية مرجعية

### الاتصال

```powershell
ssh -i $HOME\.ssh\jrd_hetzner_desktop -o IdentitiesOnly=yes root@167.233.124.62
```

### حالة الحاويات

```bash
cd /srv/jrd/app/deploy && docker compose ps
docker compose logs -f --tail=100
```

### تحديث الكود

```bash
cd /srv/jrd/app && git pull && cd deploy && docker compose up -d --build
```

### نسخة احتياطية يدوية

```bash
cp /srv/jrd/data/jrd.db /srv/jrd/data/backups/jrd.db.$(date +%Y%m%d-%H%M%S)
```

### قائمة المستأجرين

```bash
docker cp /srv/jrd/app/backend/scripts/list-tenants.js jrd-app:/app/backend/scripts/list-tenants.js
docker exec jrd-app node backend/scripts/list-tenants.js
```
