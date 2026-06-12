# JRD — نشر Hetzner

ملفات هذا المجلد تُستخدم **حصراً** للنشر على Hetzner.
لا تتأثّر بها بيئة Railway الحالية (تبقى على `Dockerfile` + `railway.toml` + `start.sh`).

---

## المبدأ الذهبي — لا تضيع الجلسات

| ما الذي يُعاد بناؤه؟ | الكود فقط (داخل الحاوية) |
| **ما الذي يبقى دائماً؟** | كل شيء تحت `/srv/jrd/data` على المضيف |
| **وقت الانقطاع الفعلي** | ثوانٍ معدودة (إعادة تشغيل الحاوية فقط) |

- `git pull` → يحدّث الكود فقط.
- `docker compose build` → يبني صورة جديدة.
- `docker compose up -d` → يستبدل الحاوية. المجلد المضيف لا يُمَسّ.
- `reboot` للخادم → الحاوية تُعاد تلقائياً، الجلسات مكانها.

---

## البنية على المضيف

```
/srv/jrd/
├── app/                                ← الكود (هذا المستودع)
│   └── deploy/                         ← هذا المجلد
│       ├── docker-compose.yml
│       ├── Caddyfile
│       ├── deploy.sh
│       ├── backup.sh
│       └── .env                        ← الأسرار (لا تُرفع لـ Git)
└── data/                               ← لا تُمَسّ مع أي deploy
    ├── jrd.db                          ← قاعدة البيانات
    ├── jrd.db-wal  jrd.db-shm
    ├── uploads/                        ← الصور
    ├── auth_sessions/                  ← جلسة واتساب (Baileys)
    ├── browser-data/                   ← جلسات bayi.alayatl.com
    │   └── item-<id>/
    ├── gmsg-browser-data/              ← جلسة Google Messages Web
    ├── tenants/                        ← (يُفعَّل في المرحلة 3+)
    │   └── <tid>/...
    └── backups/                        ← نسخ احتياطية محلية + ترفع لـ Storage Box
        ├── daily/
        └── monthly/
```

---

## الإعداد الأوّلي للخادم (مرّة واحدة)

> **التوصية**: Hetzner Cloud **CCX23** (16 GB RAM، 4 vCPU، 160 GB SSD)، Ubuntu 24.04، منطقة Falkenstein/Helsinki.

### 1) ربط SSH + تحديث

```bash
ssh root@<IP>
apt update && apt upgrade -y
apt install -y curl ca-certificates gnupg ufw sqlite3 cron git rsync
timedatectl set-timezone Europe/Istanbul   # أو حسب رغبتك
```

### 2) جدار حماية

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP (Caddy)
ufw allow 443/tcp    # HTTPS (Caddy)
ufw enable
```

### 3) تثبيت Docker + Compose

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version && docker compose version
```

### 4) إنشاء البنية الدائمة

```bash
mkdir -p /srv/jrd/data/{uploads,auth_sessions,browser-data,gmsg-browser-data,backups/daily,backups/monthly,tenants}
chown -R root:root /srv/jrd
chmod -R 750 /srv/jrd/data
```

### 5) clone للمستودع

```bash
mkdir -p /srv/jrd
cd /srv/jrd
git clone https://github.com/<owner>/<repo>.git app
cd app
```

### 6) إعداد `.env`

```bash
cd /srv/jrd/app/deploy
cp .env.example .env
# ولّد أسراراً قوية لكل CHANGE_ME:
openssl rand -hex 32       # ← INTERNAL_API_KEY
openssl rand -hex 32       # ← BOT_ENCRYPTION_KEY
openssl rand -hex 32       # ← JWT_SECRET
openssl rand -hex 24       # ← SMS_WEBHOOK_SECRET
nano .env                  # الصق القيم
chmod 600 .env
```

### 7) إعداد DNS

أنشئ سجلّ A في إعدادات النطاق:

| النوع | الاسم | القيمة |
|------|------|--------|
| A | `new` | `<IP الخادم>` |

(لاحقاً عند الانتقال الكامل: عدّل A لـ `@` و `www` ليشيرا للخادم، وفعّل البلوك الإضافي في `Caddyfile`.)

### 8) أوّل نشر

```bash
cd /srv/jrd/app/deploy
chmod +x deploy.sh backup.sh
./deploy.sh --full
```

تابع السجلّ:

```bash
docker compose -f /srv/jrd/app/deploy/docker-compose.yml logs -f app
```

افتح: <https://new.ahlacard.net> — يجب أن تظهر الواجهة وشهادة Let's Encrypt صحيحة خلال دقيقة.

---

## النشر اليومي (تحديث الكود)

```bash
cd /srv/jrd/app/deploy
./deploy.sh                # git pull + build app + restart
```

خيارات:
- `./deploy.sh --no-pull` — أعد البناء من الكود الموجود فقط.
- `./deploy.sh --full` — أعد بناء كل الخدمات (app + caddy).

---

## النسخ الاحتياطي (Storage Box)

### إعداد Storage Box (مرّة واحدة)

1. من لوحة Hetzner: **Storage Box → New Storage Box** (BX11 يكفي، ~4 €/شهر، 1 TB).
2. فعّل **SSH support** و **External reachability**.
3. أنشئ Sub-account للنسخ (مستخدم منفصل بمسار محدّد).
4. على الخادم:
   ```bash
   ssh-keygen -t ed25519 -f /root/.ssh/storage_box -N ''
   # ارفع المفتاح العام إلى Storage Box (من لوحة Hetzner أو):
   ssh-copy-id -i /root/.ssh/storage_box.pub -p 23 u123456-sub1@u123456.your-storagebox.de
   ```
5. عبّئ `STORAGE_BOX_*` في `deploy/.env`.

### إعداد cron يومي

```bash
crontab -e
# أضف:
30 3 * * *  /srv/jrd/app/deploy/backup.sh        >> /srv/jrd/data/backups/backup.log 2>&1
0  4 * * 0  /srv/jrd/app/deploy/backup-verify.sh >> /srv/jrd/data/backups/verify.log 2>&1
```

السطر الثاني يفحص آخر نسخة كل أحد الساعة 4 صباحاً ويسجّل النتيجة (`integrity_check` + sanity counts).

### استرجاع — الطريقة الموصى بها (سكربت)

```bash
cd /srv/jrd/app/deploy
chmod +x restore.sh backup-verify.sh

# تفاعلي — يعرض النسخ ويسأل
./restore.sh

# مباشر
./restore.sh 2026-06-12_0330
./restore.sh latest                 # آخر يومية
./restore.sh latest --db-only       # DB فقط (الجلسات تبقى)
./restore.sh 2026-06 --monthly      # شهرية

# تجربة بدون تنفيذ
./restore.sh latest --dry-run
```

السكربت يقوم بـ: تأكيد + إيقاف app + نسخ DB الحالي إلى `backups/pre-restore-<tag>/` + استرجاع + `PRAGMA integrity_check` + إعادة تشغيل + انتظار healthcheck. إذا فشل أي فحص، الـ DB الأصلي محفوظ في مجلد التأمين.

### استرجاع يدوي (للحالات الطارئة)

```bash
cd /srv/jrd/data
docker compose -f /srv/jrd/app/deploy/docker-compose.yml stop app
cp jrd.db jrd.db.bak-$(date +%s)
rm -f jrd.db-wal jrd.db-shm
gunzip -c backups/daily/jrd-2026-06-12_0330.db.gz > jrd.db
tar -xzf backups/daily/sessions-2026-06-12_0330.tar.gz -C /srv/jrd/data
docker compose -f /srv/jrd/app/deploy/docker-compose.yml start app
```

### التحقّق الدوري من سلامة النسخ

```bash
./backup-verify.sh                  # آخر يومية
./backup-verify.sh 2026-06-12_0330  # tag محدّد
```

---

## الفحص الذاتي بعد كل نشر

```bash
# الخدمة شغّالة؟
docker compose -f /srv/jrd/app/deploy/docker-compose.yml ps
# healthcheck؟
curl -fsS https://new.ahlacard.net/healthz
# Caddy استلم الشهادة؟
docker compose -f /srv/jrd/app/deploy/docker-compose.yml logs caddy | tail -50
# مساحة القرص؟
df -h /srv/jrd
du -sh /srv/jrd/data/*
```

---

## استكشاف الأخطاء

| العَرَض | الفحص |
|--------|------|
| الواجهة لا تفتح | `docker compose logs -f app` — هل بدأ backend؟ |
| HTTPS لا يعمل | `docker compose logs -f caddy` — DNS صحيح؟ بورت 80/443 مفتوح في UFW؟ |
| بوت واتساب يطلب QR كلّ مرّة | تحقّق من `ls -la /srv/jrd/data/auth_sessions` — يجب أن يحوي ملفات Baileys. |
| Google Messages لا يستقبل | `ls -la /srv/jrd/data/gmsg-browser-data` — موجود؟ راجع `docker compose logs app` بحثاً عن `[gmsg]`. |
| القرص ممتلئ | `du -sh /srv/jrd/data/*` + احذف نسخاً قديمة من `backups/daily/`. |

---

## ما هو **محظور** فعله

- ❌ `docker compose down -v` على خدمة app — لا يحذف bind mount لكن قد يحذف volumes أخرى مستقبلاً. استخدم `down` فقط.
- ❌ تعديل ملفات في `/srv/jrd/data/` يدوياً أثناء تشغيل الحاوية (DB locks).
- ❌ تشغيل `docker system prune --volumes` بدون فهم — قد يحذف caddy_data (الشهادات).
- ❌ رفع ملف `.env` إلى Git.
- ❌ تعديل `Dockerfile` أو `start.sh` أو `railway.toml` بشكل يكسر Railway قبل إيقافه.

---

## المراحل القادمة

راجع [../plan2.md](../plan2.md) القسم 4.8 — هذه المرحلة 1. المرحلة 2 = تجهيز الخادم فعلياً والنشر الأوّل.
