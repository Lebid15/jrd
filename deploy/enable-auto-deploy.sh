#!/usr/bin/env bash
# ============================================================
# JRD — تفعيل النشر التلقائي (يُشغَّل مرّة واحدة على الخادم)
# ------------------------------------------------------------
#   1) يثبّت مهمة cron تفحص كل دقيقتين وتنشر عند تغيّر main.
#   2) يُجري نشراً أوّلياً فوريّاً لمزامنة التطبيق مع آخر main.
# آمن للتكرار (idempotent): تشغيله مجدداً لا يُنشئ مهام مكرّرة.
# ============================================================
set -euo pipefail

REPO_DIR="/srv/jrd/app"
SCRIPT="$REPO_DIR/deploy/auto-deploy.sh"
COMPOSE="$REPO_DIR/deploy/docker-compose.yml"
LOG="/var/log/jrd-auto-deploy.log"

chmod +x "$SCRIPT"

# ثبّت الـ cron (أزل أي سطر قديم لنفس السكربت أوّلاً).
CRON_LINE="*/2 * * * * $SCRIPT >> $LOG 2>&1"
( crontab -l 2>/dev/null | grep -vF "$SCRIPT" || true ; echo "$CRON_LINE" ) | crontab -
echo "✓ تم تفعيل النشر التلقائي (فحص كل دقيقتين). السجل: $LOG"

# نشر أوّلي فوري لمزامنة الحاوية مع آخر كود.
echo "→ نشر أوّلي لمزامنة التطبيق..."
cd "$REPO_DIR"
docker compose -f "$COMPOSE" build app
docker compose -f "$COMPOSE" up -d app
echo "✓ جاهز. أي دمج جديد على main سيُنشر تلقائياً خلال دقيقتين."
