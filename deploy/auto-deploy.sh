#!/usr/bin/env bash
# ============================================================
# JRD — النشر التلقائي (يُشغّله cron على الخادم)
# ------------------------------------------------------------
# يفحص فرع main على GitHub؛ فإن تغيّر:
#   git pull --ff-only  →  إعادة بناء app  →  up -d
# البيانات في /srv/jrd/data لا تُمَسّ (bind-mount خارج الحاوية).
# flock يمنع تشغيل نشرين متوازيين.
# ============================================================
set -euo pipefail

REPO_DIR="/srv/jrd/app"
COMPOSE="$REPO_DIR/deploy/docker-compose.yml"

# قفل: لو نشر آخر يعمل، اخرج بهدوء.
exec 9>"/tmp/jrd-auto-deploy.lock"
flock -n 9 || exit 0

cd "$REPO_DIR"
git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0   # لا جديد
fi

echo "[$(date -u +%FT%TZ)] تغيير جديد: ${LOCAL:0:7} → ${REMOTE:0:7} — بدء النشر"
git pull --ff-only origin main
docker compose -f "$COMPOSE" build app
docker compose -f "$COMPOSE" up -d app
echo "[$(date -u +%FT%TZ)] اكتمل النشر ✓"
