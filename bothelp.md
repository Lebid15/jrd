# دليل دمج بوت الواتساب (مرجع لمشروع آخر)

> هذا الملف يلخّص الطريقة التي بنينا بها بوت واتساب multi-tenant في مشروع **جرد الصرافة** (Django + Node + React)، ليُستخدم كمرجع جاهز عند إضافة الميزة لمشروع شحن الألعاب.
> آخر تحديث: 2026-06-03.

---

## 1. الفكرة المعمارية (Big Picture)

ثلاث خدمات منفصلة تتواصل عبر HTTP داخلي + سرّ مشترك:

```
┌──────────────┐         ┌──────────────┐         ┌──────────────────┐
│  Frontend    │  /api   │   Backend    │  HTTP   │   Bot (Node)     │
│  (React)     │◄───────►│  (Django)    │◄───────►│  Baileys + Exp.  │
└──────────────┘         └──────────────┘         └──────────────────┘
       ▲                        ▲                          │
       │ كوكيز/CSRF              │ X-Internal-Api-Key       │ WhatsApp
       │                        │                          ▼
       │                  PostgreSQL                  مجموعات واتساب
```

**القواعد الذهبية:**
- البوت لا يلمس قاعدة البيانات مطلقاً. كل شيء يمرّ عبر Django REST.
- Django يستدعي البوت فقط لإدارة الجلسة (بدء/إيقاف/إرسال). البوت يستدعي Django ليُغذّيه بالرسائل ويسأل عن الأوامر.
- المصادقة بين الخدمتين = `INTERNAL_API_KEY` ثابت في الـ env، يُرسَل في هيدر `X-Internal-Api-Key`.
- جلسة واتساب **مستقلّة لكل مستأجر** (`tenant_id`). كل جلسة في مجلد منفصل على القرص.

---

## 2. مكدّس البوت

| العنصر | السبب |
|--------|------|
| **Node.js 22** (ESM) | أحدث LTS، يدعم `import/export`. |
| **@whiskeysockets/baileys ^6.7.9** | مكتبة WhatsApp Web غير رسمية، الأكثر صيانة. |
| **express ^4.22** | خادم HTTP داخلي بسيط للأوامر من Django. |
| **pino ^9** | logger سريع JSON. |
| **qrcode** | توليد QR كـ data-URL لإرساله للواجهة. |
| **dotenv** | تحميل `.env`. |
| **@sentry/node** | اختياري — مراقبة الأخطاء. |
| **vitest** | اختبارات. |

---

## 3. هيكل مجلد البوت

```
bot/
├── package.json
├── .env                       # لا يُرفع
├── .env.example
├── auth_sessions/             # جلسات Baileys (مشفّرة) — مجلد لكل tenant
│   ├── 1/  creds.json, pre-key-*.json, ...
│   └── 2/
├── scripts/
│   └── migrate-encrypt-sessions.js
└── src/
    ├── index.js               # نقطة الدخول
    ├── config.js              # تحميل env + قيم افتراضية
    ├── logger.js              # pino
    ├── server.js              # Express + authMiddleware
    ├── sessionManager.js      # Map<tenantId, Session> + bootstrap
    ├── session.js             # Session واحدة (Baileys socket)
    ├── djangoClient.js        # fetch إلى Django
    └── encryptedAuthStore.js  # AES-256-GCM لملفات auth
```

---

## 4. مفهوم الجلسة (Session)

كل tenant = كائن `Session` يحوي:

- `tenantId` (string)
- `authDir` (`auth_sessions/<id>/`)
- `state`: `idle | qr | connecting | connected | closed`
- `qrDataUrl`: صورة QR (data:image/png;base64,...) عند الحاجة لمسح جديد
- `phoneNumber`: رقم الجهاز المرتبط بعد المسح
- `sock`: socket Baileys
- `lastMessageAt`: ISO timestamp لآخر رسالة (لرصد فك الربط)

**أحداث Baileys المُلتقطة:**
- `creds.update` → استدعاء `saveCreds()` (يكتب ملفات مشفّرة).
- `connection.update` → يحدّث `state`، يولّد QR، يعيد المحاولة بعد القطع (إلا لو `loggedOut`).
- `messages.upsert` → معالجة كل رسالة.

**SessionManager**:
- `Map<tenantId, Session>` في الذاكرة.
- `bootstrap()` عند الإقلاع: يقرأ `auth_sessions/` ويستأنف **كل** المجلدات الموجودة تلقائياً (لا تحتاج تدخل من المستخدم بعد إعادة التشغيل).
- `start / logout / purge / status / list`.

---

## 5. تشفير ملفات الجلسة (مهم جداً)

Baileys يحفظ مفاتيح JSON خام في القرص. سرقة القرص = سرقة كل حسابات الواتساب.

الحل في [bot/src/encryptedAuthStore.js](bot/src/encryptedAuthStore.js):
- مفتاح أساسي 32 بايت في env `BOT_ENCRYPTION_KEY` (base64).
- لكل ملف: مفتاح فرعي عبر **HKDF-SHA256** (salt = اسم الملف).
- تشفير **AES-256-GCM**: `magic(4="JRD1") | iv(12) | ciphertext | tag(16)`.
- توافق خلفي: لو الملف غير مشفّر (نصّ JSON قديم) يُقرأ عادياً ويُعاد تشفيره عند أوّل كتابة.
- يحاكي توقيع `useMultiFileAuthState` لـ Baileys بالضبط: يُرجع `{ state, saveCreds }`.

> توليد مفتاح: `npm run gen:key` (= `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

---

## 6. خادم HTTP الداخلي (Bot ← Django)

[bot/src/server.js](bot/src/server.js) — Express يستمع على `BOT_PORT` (افتراضي 3100).

### Auth middleware
مقارنة **آمنة من timing-attack** عبر `crypto.timingSafeEqual` على `X-Internal-Api-Key`.

### Routes

| الطريقة | المسار | الوظيفة |
|--------|--------|---------|
| GET | `/healthz` | فحص حياة + عدد الجلسات |
| GET | `/sessions` | كل الجلسات النشطة |
| GET | `/sessions/:tenantId` | حالة جلسة (state, qr, phone, ...) |
| POST | `/sessions/:tenantId/start` | بدء/استئناف جلسة → يُرجع QR إن لزم |
| POST | `/sessions/:tenantId/logout` | logout عادي |
| DELETE | `/sessions/:tenantId` | حذف نهائي + مسح مجلد auth |
| POST | `/sessions/:tenantId/send` | `{group_id, text}` |
| POST | `/sessions/:tenantId/send-image` | `{group_id, image_b64, mimetype, caption}` (SVG يُرسل كمستند) |

---

## 7. تدفّق الرسائل (Bot → Django)

عند وصول رسالة في `messages.upsert`:

1. **فلترة فورية** — وفّر استدعاءات شبكة لا لزوم لها:
   - تجاهل لو `!msg.message` (لا محتوى).
   - تجاهل لو ليست مجموعة (`remoteJid.endsWith('@g.us')`). *عدّل هذا الشرط حسب حالتك — في مشروع الألعاب قد تريد رسائل خاصة أيضاً.*
   - تجاهل لو `fromMe === true` (وإلا ستُسجّل ردود البوت نفسها كقيود/طلبات جديدة!).
   - تجاهل لو نص فارغ.

2. **استخراج النص** من أحد الحقول:
   ```js
   msg.message.conversation
   || msg.message.extendedTextMessage?.text
   || msg.message.imageMessage?.caption
   || msg.message.videoMessage?.caption
   || ''
   ```

3. **جلب اسم المجموعة** lazily عبر `sock.groupMetadata(remoteJid)` (try/catch).

4. **استدعاء `/api/internal/ingest/`** بـ:
   ```json
   {
     "tenant_id": "1",
     "group_id": "xxx@g.us",
     "group_name": "...",
     "sender": "9665...@s.whatsapp.net",
     "sender_name": "اسم الظاهر",
     "message_id": "ABCD1234",
     "text": "..."
   }
   ```

5. **استدعاء `/api/internal/command/`** لمعرفة هل توجد ردّ يجب إرساله (مثل "مطابقة"، "رصيد"، أو في حالتك "تحقق طلب"، "رصيد المحفظة"...). الردّ:
   ```json
   {
     "command": "RECONCILE",
     "reply": "نصّ الردّ",
     "image": { "image_b64": "...", "mimetype": "image/png", "caption": "..." }   // اختياري
   }
   ```

6. لو `reply` موجود:
   - **تأخير عشوائي** 1.5-4 ثوانٍ (`REPLY_DELAY_MIN_MS`/`MAX_MS`) لمحاكاة إنسان وتقليل خطر حظر الرقم.
   - `sock.sendMessage(remoteJid, { text }, { quoted: msg })` للردّ مع اقتباس الرسالة.
   - لو في `image` → ابعث صورة (`{ image: buffer, mimetype, caption }`) أو مستند للـ SVG.

---

## 8. عميل Django (في البوت)

[bot/src/djangoClient.js](bot/src/djangoClient.js) — `fetch` بسيط:

```js
await request('/api/internal/ingest/', payload);
await request('/api/internal/command/', payload);
await request('/api/internal/reconcile-log/', payload);
```

يضيف هيدر `X-Internal-Api-Key` تلقائياً. أيّ استجابة غير 2xx ترمي خطأ.

---

## 9. عميل البوت (في Django)

[backend/apps/accounts/bot_client.py](backend/apps/accounts/bot_client.py) — يستخدم `urllib.request` فقط (بدون `requests` ليبقى خفيفاً):

```python
start_session(tenant_id)
session_status(tenant_id)
logout_session(tenant_id)
delete_session(tenant_id)
healthz()
send_message(tenant_id, group_jid, text)
send_image(tenant_id, group_jid, image_b64, mimetype, caption)
```

يستدعيه `WhatsAppViewSet` في `apps/accounts/views.py` للنقاط: `whatsapp/connect/`, `whatsapp/status/`, `whatsapp/logout/`.

---

## 10. نقاط Django الداخلية للبوت

محمية بـ `IsInternalApiKey` permission (يقرأ `tenant_id` من البودي ويتحقق من الاشتراك):

| المسار | الغرض |
|--------|------|
| `POST /api/internal/ingest/` | استقبال رسالة جديدة → parse → إنشاء قيد (أو تجاهل صامت لو فشل التحليل) |
| `POST /api/internal/command/` | فحص هل الرسالة أمر (مطابقة/رصيد/...) → يُرجع ردّاً |
| `POST /api/internal/reconcile-log/` | تسجيل ردّ البوت نفسه في الـ ledger كسطر عرض |
| `POST /api/internal/tenants/active/` | البوت يستعلم عن المستأجرين النشطين |

> أهم درس: **التجاهل الصامت** عند فشل parse — لا تكتب في DB قمامة. سجّلها فقط في "غير المطابقة" لو فعّل المستخدم وضع التشخيص.

---

## 11. متغيّرات البيئة

### `bot/.env`
```
DJANGO_URL=http://127.0.0.1:8000
INTERNAL_API_KEY=<طويل وعشوائي — يطابق Django>
BOT_PORT=3100
BOT_HOST=0.0.0.0
LOG_LEVEL=info
REPLY_DELAY_MIN_MS=1500
REPLY_DELAY_MAX_MS=4000
BOT_ENCRYPTION_KEY=<base64 32 bytes — npm run gen:key>
SENTRY_DSN=                 # اختياري
```

### `backend/.env` (الأجزاء المتعلّقة بالبوت)
```
INTERNAL_API_KEY=<نفس قيمة البوت بالضبط>
BOT_URL=http://127.0.0.1:3100
```

> لا تضع `default='change-me'` على هذه القيم في `settings.py` — اجعل الإقلاع يفشل لو غابت.

---

## 12. تشغيل محلي

```powershell
# البوت
cd bot
npm install
npm run gen:key       # ضع الناتج في .env كـ BOT_ENCRYPTION_KEY
npm start             # → http://127.0.0.1:3100

# Django
cd backend
python manage.py runserver  # → http://127.0.0.1:8000
```

ثم من الواجهة: زر **"ربط واتساب"** → يستدعي `whatsapp/connect/` → Django ينادي `POST /sessions/1/start` على البوت → يُرجع QR data-URL → عرضه `<img src={qr}/>` → مسحه من الهاتف → الجلسة تصبح `connected`.

---

## 13. دروس مكتسبة (لا تكرّر هذه الأخطاء)

1. **`fromMe` حماية مزدوجة** — افحصه في بداية معالج الرسائل **وقبل الإرسال**. لو نسيت، البوت سيردّ على نفسه في حلقة لانهائية.
2. **`syncFullHistory: false`** و `markOnlineOnConnect: false` — يقلّل الضوضاء وخطر الحظر.
3. **`browser: ['اسم البوت', 'Chrome', '1.0']`** — يظهر بهذا الاسم في "الأجهزة المرتبطة" في هاتف العميل (مفيد للعميل ليعرف ما يفصل).
4. **تأخير عشوائي قبل الردّ** — أقلّ احتمال للحظر من واتساب.
5. **استخدم `quoted: msg`** عند الردّ — تجربة مستخدم أفضل + سياق للعميل.
6. **`groupMetadata` lazy + try/catch** — يفشل أحياناً (timeout)، لا تجعل ذلك يكسر المعالج.
7. **`useMultiFileAuthState` لا `useSingleFileAuthState`** — الأخير deprecated وغير موثوق.
8. **bootstrap عند الإقلاع** — اقرأ المجلدات الموجودة في `auth_sessions/` وأطلق كل الجلسات بدون انتظار طلب من المستخدم. بدون ذلك بعد كل إعادة تشغيل سيرفر سيُطلب من كل عميل مسح QR جديد.
9. **حدّد حدّاً زمنياً لإعادة الاتصال** بعد `connection: 'close'` (ثانيتان كافيتان)، وانتبه لـ `DisconnectReason.loggedOut` — لا تعد المحاولة لأنه نهائي.
10. **حذف القيود/البيانات يجب أن يحذف مجلد `auth_sessions/<id>/` أيضاً** — وإلا بعد إعادة الإنشاء يستأنف بجلسة قديمة.
11. **`timingSafeEqual` للمقارنة** بدلاً من `===` على المفاتيح السرّية.
12. **اجعل `INTERNAL_API_KEY` غير قابل للتشكيل من الواجهة** — لا تُرجعه أبداً في أيّ response.
13. **رسائل البوت الصادرة (مثل ردّ المطابقة) لا تُحلَّل** — لكن إن أردت **تسجيلها** فقط (عرض في السجل، بدون parse) أضف نقطة منفصلة (`reconcile-log/` كما فعلنا) لا تمرّ على `ingest`.
14. **اعتمد رقم ثانوي للاختبار** — لا تربط رقمك الشخصي بأي بوت Baileys (مخاطرة حظر).

---

## 14. ما يتغيّر في مشروع شحن الألعاب

اعتمد نفس البنية، لكن انتبه:

- **هل تحتاج رسائل خاصة (DM) أم مجموعات فقط؟** في شحن الألعاب الأرجح خاصّة → احذف فلتر `endsWith('@g.us')` أو اعكسه.
- **عوضاً عن "parser محاسبي" ستحتاج موزّع طلبات** — نفس الفكرة، لكن `ingest` يُنشئ `Order` بدل `LedgerEntry`. الفشل الصامت لا يزال صائباً للرسائل العشوائية.
- **الأوامر ستختلف**: `حالة طلبي`، `رصيد`، `أسعار`، `ID لاعب: 123456` — كلها تمرّ عبر `/internal/command/` بنفس الآلية.
- **إرسال إيصالات/صور البطاقات**: استخدم نقطة `send-image` (موجودة بالفعل، اقتبسها كما هي).
- **ميزات Multi-tenant**: لو الموقع لمالك واحد فقط، يمكنك تثبيت `tenant_id=1` ثابتاً ولا تحتاج عزل DB، لكن **احتفظ بنفس بنية المسارات** (`/sessions/1/...`) كي تستطيع التوسّع لاحقاً.
- **2FA على لوحة الإدارة، Throttling على /api/auth/login/، تشفير `auth_sessions/`** — كلها يجب تكرارها يوماً واحداً، ليست اختيارية في الإنتاج.

---

## 15. ملفّات يستحسن نسخها كما هي (تعديل بسيط فقط)

من جذر هذا المشروع إلى مشروعك الجديد:

- [bot/src/encryptedAuthStore.js](bot/src/encryptedAuthStore.js) — انسخه حرفياً.
- [bot/src/session.js](bot/src/session.js) — عدّل `_handleMessage` فقط (الأوامر/الفلاتر).
- [bot/src/sessionManager.js](bot/src/sessionManager.js) — انسخه حرفياً.
- [bot/src/server.js](bot/src/server.js) — انسخه حرفياً.
- [bot/src/config.js](bot/src/config.js) — انسخه حرفياً.
- [bot/src/djangoClient.js](bot/src/djangoClient.js) — عدّل أسماء المسارات حسب backend الجديد (Django/Laravel/Node/Whatever).
- [backend/apps/accounts/bot_client.py](backend/apps/accounts/bot_client.py) — لو backendك Django، انسخه. لو غيره، ترجم نفس الـ 7 دوال.
- `package.json`: نفس التبعيات (Baileys 6.7.9 محدّد بدقّة — قد تكسر إصدارات أحدث).

---

## 16. خلاصة لمساعد الذكاء الاصطناعي في المشروع الآخر

> إن قرأت هذا الملف وأنت تساعد في مشروع شحن الألعاب: ركّز على بناء **خدمة Node منفصلة** بنفس البنية أعلاه. لا تكتب منطق Baileys داخل خادم Backend الرئيسي. اتّبع:
> 1. مفتاح مشترك في env (`X-Internal-Api-Key`) للمصادقة بين الخدمتين.
> 2. جلسة منفصلة لكل عميل في `auth_sessions/<id>/` مع تشفير AES-256-GCM.
> 3. أربع نقاط أساسية على البوت: `start / status / logout / send`.
> 4. ثلاث نقاط داخلية على Backend: `ingest / command / health`.
> 5. تجاهل صامت + سجل اختياري للرسائل غير المطابقة.
> 6. تأخير عشوائي قبل أيّ ردّ + فلترة `fromMe`.
> 7. bootstrap كل الجلسات تلقائياً عند الإقلاع.
> 8. لا تنس قسم "الحقّ في النسيان": حذف الحساب يجب أن يحذف مجلد الجلسة كذلك.
