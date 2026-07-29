# طريقة الرفع والنشر (Deployment)

> **آخر تحديث**: 12 يونيو 2026 — بدأ النقل من Railway إلى Hetzner.

---

## الحالة الحالية (Migration)

- **Railway**: ما زال يعمل بآخر نسخة منشورة — **GitHub auto-deploy معطَّل** (الـ branch `main` مفصول من إعدادات Railway). أي push جديد لن يؤثّر على Railway.
- **Hetzner**: ✅ تمّ النشر بنجاح على <https://alaya.ahlacard.net> (شهادة Let's Encrypt صحيحة). تمّ إنشاء أوّل admin. جاهز للاختبار وإنشاء المستأجرين.
- **الخطوة التالية**: اختبار شامل على Hetzner ثم نقل بيانات Railway ثم تبديل DNS لـ `ahlacard.net`.

---

## لوحة الإدارة (Hetzner / alaya.ahlacard.net)

| الحقل | القيمة |
|------|--------|
| URL | <https://alaya.ahlacard.net/login> |
| بريد admin | `lebid.hac.alaye@gmail.com` |
| كلمة admin | `Asdf1212asdf!!` |
| دور | `admin` (يرى كل المستأجرين + واجهة إدارة) |

### إعادة تعيين كلمة سرّ admin

```powershell
ssh -i $HOME\.ssh\jrd_hetzner_desktop root@167.233.124.62 "docker exec jrd-app node backend/scripts/create-admin.js --email=lebid.hac.alaye@gmail.com --password='NEW_PASS' --reset"
```

---

## معلومات سيرفر Hetzner (الإنتاج الجديد)

| الحقل | القيمة |
|-------|--------|
| Project name | `jrd` |
| Server name | `jrd-prod` |
| Type | CPX32 (4 vCPU AMD, 8 GB RAM, 160 GB SSD) |
| Location | Falkenstein (FSN1), Germany |
| OS | Ubuntu 24.04 LTS |
| **IPv4** | `167.233.124.62` |
| IPv6 | `2a01:4f8:c014:2f03::1` |
| السعر | ~$16.49/شهر |

### الدخول SSH

```powershell
ssh -i $HOME\.ssh\jrd_hetzner_desktop root@167.233.124.62
```

- مفتاح اللابتوب: `~/.ssh/jrd_hetzner` (بدون passphrase)
- مفتاح المكتبي: `~/.ssh/jrd_hetzner_desktop` (بدون passphrase)
- المفتاح العام للمكتبي محفوظ في [deploy/keys/desktop.pub](deploy/keys/desktop.pub) (يُسحب تلقائياً على الخادم عبر git pull).
- سكربت إصلاح SSH: [deploy/keys/fix-ssh.sh](deploy/keys/fix-ssh.sh) — يعيد بناء `sshd_config` ويصلح الصلاحيات لو تلفت.
- لو نسيت كلمة سرّ root: لوحة Hetzner Cloud → Server → Rescue → Reset root password (أو Console KVM للتعديل اليدوي).

### البنية التحتية الجاهزة على السيرفر

```
/srv/jrd/
├── app/                       ← هنا سيُستنسَخ الكود (git clone)
└── data/                      ← دائم، لا يُمسَح أبداً
    ├── db/                    ← jrd.db (SQLite)
    ├── tenants/               ← جلسات + uploads لكل مستأجر
    └── backups/
        ├── daily/
        └── monthly/
```

### الحزم المثبَّتة

- Docker 29.1.3 + Docker Compose v2.40.3 (active)
- Git, SQLite3, UFW, curl

### الجدار الناري (UFW)

- مسموح: SSH (22), HTTP (80), HTTPS (443)
- ممنوع: كل ما عداه

---

## معلومات Railway (الإنتاج الحالي — مؤقت)

- **مستودع GitHub**: https://github.com/Lebid15/jrd
- **Railway Project**:
  https://railway.com/project/fec70dd5-0c5d-4149-855f-ffac4cc2c932/service/31f32c5e-0f55-42e9-b666-45f81931f38e
- **النطاق الحالي**: `ahlacard.net` (DNS يُوجَّه لـ Railway)
- **حالة الـ deploy**: GitHub branch `main` **مفصول** — لا تحديث تلقائي حتى نُكمل النقل.

> **بعد cutover**: نوقف خدمات Railway ونحوّل DNS لـ Hetzner. التفاصيل في [deploy/cutover-checklist.md](deploy/cutover-checklist.md).

---

## دورة العمل الجديدة (بعد النشر على Hetzner)

> **القاعدة الذهبية**: التحديث يطال الكود فقط. البيانات في `/srv/jrd/data` لا تُمَسّ.

```bash
# على السيرفر (Hetzner):
ssh root@167.233.124.62
cd /srv/jrd/app
git pull
docker compose -f deploy/docker-compose.yml build app
docker compose -f deploy/docker-compose.yml up -d app
```

---

## النشر التلقائي — GitHub Actions ✅

الأتمتة جاهزة في [.github/workflows/deploy.yml](.github/workflows/deploy.yml). عند كل push على `main`:

1. **تحقّق (validate)**: بناء الـ frontend + فحص صيغة كل ملفات JS — يمنع نشر كود مكسور.
2. **نشر (deploy)**: SSH إلى الخادم وتشغيل `deploy/deploy.sh` (git pull + rebuild app + up).
3. **فحص صحّة**: طلب `https://alaya.ahlacard.net/healthz` والتأكّد من HTTP 200.

يمكن أيضاً التشغيل يدوياً من تبويب **Actions → Deploy to Hetzner → Run workflow**
(مع خيار `full` لإعادة بناء `app + caddy`).

### الإعداد لمرّة واحدة (أسرار المستودع)

Settings → Secrets and variables → Actions → **New repository secret**:

| الاسم | القيمة | إلزامي |
|------|--------|:------:|
| `SSH_PRIVATE_KEY` | محتوى المفتاح الخاص كاملاً (مثلاً `cat ~/.ssh/jrd_hetzner_desktop`) | ✅ |
| `SSH_KNOWN_HOSTS` | مخرجات `ssh-keyscan 167.233.124.62` (لتثبيت هوية الخادم) | مُستحسَن |

> المفتاح العام المقابل مثبَّت مسبقاً على الخادم (راجع [deploy/keys/desktop.pub](deploy/keys/desktop.pub)).
> لو لم تُضِف `SSH_KNOWN_HOSTS`، يستخدم الـ workflow `ssh-keyscan` تلقائياً (أقلّ أماناً).

متغيّرات اختيارية (Variables، ليست أسراراً) لتجاوز الافتراضات:
`SSH_HOST` (`167.233.124.62`) · `SSH_USER` (`root`) · `DEPLOY_PATH` (`/srv/jrd/app`) · `HEALTH_URL`.

---

## توزيع المهام

- **Copilot**: يُعدِّل الكود → `git add` → `git commit` → `git push` على `main` → **GitHub Actions ينشر تلقائياً**.
- **النشر اليدوي** (احتياطي): تشغيل `deploy/deploy.sh` على Hetzner، أو زرّ *Run workflow* من تبويب Actions.

---

## أوامر مساعدة سريعة

```powershell
# على جهاز التطوير:
git status
git log --oneline -10
git diff <file>

# على سيرفر Hetzner:
docker compose -f /srv/jrd/app/deploy/docker-compose.yml ps
docker compose -f /srv/jrd/app/deploy/docker-compose.yml logs -f app
df -h /srv/jrd/data
```
