# JRD — Railway → Hetzner Cutover Checklist

قائمة الفحص الشاملة قبل إيقاف Railway نهائياً. **لا تتخطّى أي بند**.

---

## مرحلة 0 — التحضير (قبل أسبوع)

- [ ] Hetzner يعمل على `https://new.ahlacard.net` ومستقرّ ≥ 7 أيام.
- [ ] جميع الاختبارات الخلفية خضراء على Hetzner (154/154).
- [ ] backup.sh يعمل يومياً + 3 نسخ على الأقل في Storage Box.
- [ ] backup-verify.sh نجح آخر مرّة (`integrity_check = ok`).
- [ ] DNS لـ `ahlacard.net` و `www.ahlacard.net` و `new.ahlacard.net` موثّق (TTL مخفّض إلى 300s قبل 24 ساعة من cutover).
- [ ] قائمة المستأجرين الحاليين موثّقة (Railway → DB → `SELECT id, slug FROM tenants;`).
- [ ] إخطار المستأجرين بنافذة الصيانة (15–30 دقيقة).

---

## مرحلة 1 — التجميد (يوم cutover، T-30 دقيقة)

- [ ] أعلن نافذة الصيانة (Slack/WhatsApp للمستأجرين).
- [ ] أوقف بوت واتساب على Railway (لمنع كتابة جديدة):
  ```bash
  # على Railway dashboard: Service → Settings → Restart Policy = "Never" + Stop
  ```
- [ ] تأكّد أن لا scraper يعمل (راجع logs آخر 10 دقائق على Railway).
- [ ] خذ نسخة احتياطية نهائية من Railway:
  ```bash
  # من جهازك المحلي:
  railway login
  railway link <project-id>
  railway run --service backend "sqlite3 /app/data/jrd.db '.backup /tmp/final.db'"
  railway run --service backend "tar -czf /tmp/sessions.tar.gz -C /app/data auth_sessions browser-data gmsg-browser-data uploads 2>/dev/null"
  # نزّلها:
  railway run --service backend "cat /tmp/final.db" > final.db
  railway run --service backend "cat /tmp/sessions.tar.gz" > sessions.tar.gz
  ```
  > **بديل**: إن كان Railway يستخدم volume، انسخها عبر `railway volume` أو SSH إلى الـ shell.

---

## مرحلة 2 — النقل (T-15 دقيقة)

- [ ] انقل `final.db` و `sessions.tar.gz` إلى Hetzner:
  ```bash
  scp final.db          root@<HETZNER_IP>:/srv/jrd/data/backups/daily/jrd-cutover.db
  scp sessions.tar.gz   root@<HETZNER_IP>:/srv/jrd/data/backups/daily/sessions-cutover.tar.gz
  gzip /srv/jrd/data/backups/daily/jrd-cutover.db   # على Hetzner
  ```
- [ ] على Hetzner — استرجاع كامل:
  ```bash
  cd /srv/jrd/app/deploy
  ./restore.sh cutover
  # تأكيد: YES
  ```
- [ ] تحقّق:
  - `curl https://new.ahlacard.net/healthz` → 200
  - افتح الواجهة وسجّل دخول كـ admin
  - افتح Items، Photos، WhatsApp — كل البيانات موجودة
  - عدّ المستأجرين: يجب أن يطابق Railway

---

## مرحلة 3 — DNS Cutover (T-0)

- [ ] في لوحة DNS (Cloudflare/مزوّد النطاق):
  - [ ] غيّر `A` لـ `@` (`ahlacard.net`) من Railway IP إلى Hetzner IP.
  - [ ] غيّر `A` لـ `www` من Railway IP إلى Hetzner IP.
  - [ ] احذف `CNAME` القديم لـ Railway إن وُجد.
- [ ] فعّل البلوك الإضافي في [Caddyfile](Caddyfile) للنطاق الرئيسي:
  ```bash
  nano /srv/jrd/app/deploy/Caddyfile
  # أضف بلوك ahlacard.net + www.ahlacard.net (موجود معلَّق)
  docker compose -f /srv/jrd/app/deploy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
  ```
- [ ] انتظر propagation (5–10 دقائق مع TTL=300):
  ```bash
  dig +short ahlacard.net @1.1.1.1
  dig +short ahlacard.net @8.8.8.8
  # كلاهما يجب أن يُرجع Hetzner IP
  ```

---

## مرحلة 4 — التحقّق (T+15 دقيقة)

- [ ] `curl -fsS https://ahlacard.net/healthz` → 200.
- [ ] الواجهة تفتح على `https://ahlacard.net` (شهادة Let's Encrypt صحيحة).
- [ ] سجّل دخول كـ owner لتجربة فعلية → تجاوز اختبار العزل.
- [ ] أرسل SMS اختباري عبر webhook → الرصيد يتحدّث.
- [ ] أرسل رسالة WhatsApp في مجموعة مسموحة → تُحفَظ في DB.
- [ ] افحص logs آخر 5 دقائق:
  ```bash
  docker compose -f /srv/jrd/app/deploy/docker-compose.yml logs --tail=200 app | grep -iE 'error|fail'
  ```

---

## مرحلة 5 — إغلاق Railway (T+24 ساعة)

> **لا تستعجل!** اترك Railway يعمل لكن **متجمّداً** 24 ساعة على الأقل كـ rollback insurance.

بعد 24 ساعة من cutover ناجح:

- [ ] خذ نسخة أخيرة (للأرشيف) من Railway → احفظها محلياً + Storage Box في مجلد `cutover-archive/`.
- [ ] أوقف الخدمات على Railway:
  - Backend service: Settings → Delete
  - Bot service: Settings → Delete
  - Scrapers services: Delete
  - **لا تحذف** الـ project نفسه بعد — اتركه أسبوعاً للتحقّق.
- [ ] في cron الخارجية (إن وُجدت تستدعي Railway): أعد توجيهها لـ Hetzner.
- [ ] أزل أي webhook خارجي يشير لـ `*.railway.app`.
- [ ] حدّث المتغيرات في Cloudflare Worker (إن استُخدم) لتشير لـ Hetzner.

بعد أسبوع إضافي:
- [ ] احذف Railway project نهائياً.
- [ ] ألغِ الاشتراك في Railway.
- [ ] أعد TTL للـ DNS إلى قيمته الطبيعية (3600 أو Auto).

---

## Rollback (إذا فشل أي بند في مرحلة 4)

```bash
# 1) أعد DNS لـ Railway IPs (لوحة DNS — TTL=300 يعني 5 دقائق).
# 2) شغّل Railway services من الـ dashboard.
# 3) Railway DB لم يُمَسّ — كل شيء كما كان.
# 4) لا تحذف /srv/jrd/data على Hetzner — اتركه لمحاولة لاحقة.
```

> **مهم**: أي كتابة جديدة على Hetzner بعد cutover **لن** تُنقَل تلقائياً إلى Railway. الـ rollback يفقد التحديثات بين T-0 و وقت الـ rollback. لذلك:
> - في مرحلة 1 جمّدنا كل شيء على Railway قبل النقل.
> - في مرحلة 4 إن فشل شيء، rollback يكون فورياً (دقائق).

---

## بعد cutover — موارد الـ docs الخارجية

حدّث:
- [ ] README الرئيسي للمستودع: غيّر "Railway" → "Hetzner".
- [ ] أي وثائق للعملاء تذكر `*.railway.app`.
- [ ] أي API docs لمستهلكي webhook (الـ URL الجديد).
- [ ] backup للأكواد القديمة المتعلّقة بـ Railway: احتفظ بـ `Dockerfile`, `start.sh`, `railway.toml` في الـ repo (للتاريخ) لكن لا تحدّثها.
