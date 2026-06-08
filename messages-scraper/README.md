# messages-scraper — المرحلة 1 (Spike محلّي)

> الغاية الوحيدة من هذا المجلد حالياً: التأكّد عملياً من أن selectors **Google Messages Web** ثابتة بدرجة كافية، قبل بناء الخدمة الكاملة (راجع `plan.md` → البند 3.5).

## ما يفعله `spike.js`
1. يفتح Chromium بـ **Persistent Context** (يحفظ الجلسة في `browser-data/`).
2. يذهب إلى <https://messages.google.com/web>.
3. عند أوّل تشغيل: يطبع رسالة في الـ console ويتركك تمسح QR من جوالك (Messages → Device pairing). بعد الاقتران لا تحتاج تكراره.
4. ينتظر تحميل قائمة المحادثات.
5. يبحث عن محادثة عنوانها يبدأ/يحتوي على `KUVEYT TURK` (قابل للتغيير عبر `TARGET_CONTACT` في `.env`).
6. يفتح المحادثة، يطبع آخر رسالة (نص + وقت) في الـ console، ثم يخرج.

> الـ spike **لا يخزّن شيئاً**، **لا يستدعي backend**، **لا ينشّط polling**. هذا متعمَّد — هدفنا أوّلاً معرفة selectors فقط.

## تشغيل محلّي

```powershell
cd messages-scraper
npm install
npm run install:browser   # تحميل Chromium لـ Playwright (مرّة واحدة)
copy .env.example .env    # ثم عدّل القيم لو احتجت
npm run spike
```

في أوّل تشغيل: ستفتح نافذة Chromium، اذهب لجوالك → تطبيق **Messages** → Device pairing → امسح QR. بعدها سيكمل الـ spike تلقائياً.

التشغيلات اللاحقة تستأنف الجلسة من `browser-data/` بدون QR.

## ماذا نلتقطه من هذه التجربة (Logs)
عندما يعمل بنجاح سنوثّق في `memories/repo/`:
- selector عنصر المحادثة في القائمة الجانبية (`mws-conversation-list-item`?).
- selector لاسم جهة الاتصال داخله.
- selector لآخر فقاعة رسالة وارد (`mws-message-wrapper.incoming`?).
- selector لنصّ الرسالة (`mws-text-message-part`?).
- selector للوقت/الـ timestamp.

عندها فقط ننتقل للمرحلة 2 (Polling + ingest عبر `/api/internal/bank-message/ingest`).

## تنبيهات
- **لا تحذف** `browser-data/` بعد الاقتران (ستضطر لإعادة المسح).
- لا تشارك محتوى `browser-data/` (يحوي جلسة Google).
- `.env` و `browser-data/` مُهمَلان في `.gitignore`.
