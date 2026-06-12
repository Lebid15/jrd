#!/usr/bin/env bash
# ============================================================
# JRD — Hetzner deploy script
# ------------------------------------------------------------
# يُنفَّذ على الخادم (لا محلياً) من داخل /srv/jrd/app/deploy.
# الفلسفة: الكود يُعاد بناؤه — البيانات في /srv/jrd/data لا تُمسّ.
#
# الاستخدام:
#   ./deploy.sh           # git pull + rebuild app + restart
#   ./deploy.sh --no-pull # rebuild من الكود الموجود فقط
#   ./deploy.sh --full    # rebuild كل الخدمات (app + caddy)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="/srv/jrd/data"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

PULL=1
FULL=0
for arg in "$@"; do
	case "$arg" in
		--no-pull) PULL=0 ;;
		--full)    FULL=1 ;;
		*) echo "خيار غير معروف: $arg"; exit 2 ;;
	esac
done

echo "===> JRD deploy"
echo "    repo:    $REPO_DIR"
echo "    data:    $DATA_DIR"
echo "    compose: $COMPOSE_FILE"

# 1) تأكيد أن مجلد البيانات موجود (يجب أن يكون موجوداً مسبقاً)
if [ ! -d "$DATA_DIR" ]; then
	echo "خطأ: $DATA_DIR غير موجود. أنشِئه أوّلاً مع المجلدات الفرعية." >&2
	exit 1
fi

# 2) سحب آخر تحديثات الكود
if [ "$PULL" = "1" ]; then
	echo "===> git pull"
	cd "$REPO_DIR"
	git fetch --all --prune
	git pull --ff-only
fi

# 3) إعادة بناء الحاوية(ات)
cd "$SCRIPT_DIR"
if [ "$FULL" = "1" ]; then
	echo "===> docker compose build (all)"
	docker compose -f "$COMPOSE_FILE" build
else
	echo "===> docker compose build app"
	docker compose -f "$COMPOSE_FILE" build app
fi

# 4) إعادة التشغيل (down ثم up حتى يلتقط الحاوية الجديدة)
echo "===> docker compose up -d"
docker compose -f "$COMPOSE_FILE" up -d

# 5) عرض الحالة
echo "===> docker compose ps"
docker compose -f "$COMPOSE_FILE" ps

echo "===> done. logs: docker compose -f $COMPOSE_FILE logs -f app"
