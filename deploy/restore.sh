#!/usr/bin/env bash
# ============================================================
# JRD — Restore script
# ------------------------------------------------------------
# يسترجع DB + جلسات من نسخة احتياطية محدّدة.
#
# الاستخدام:
#   ./restore.sh                              # تفاعلي — يعرض النسخ ويسأل
#   ./restore.sh 2026-06-12_0330              # tag محدّد (date_time)
#   ./restore.sh latest                       # آخر يومية متاحة
#   ./restore.sh 2026-06-12_0330 --db-only    # DB فقط بدون sessions
#   ./restore.sh 2026-06--monthly             # شهرية (YYYY-MM)
#   ./restore.sh <tag> --dry-run              # لا يُطبّق فعلاً
#
# الخطوات (بهذا الترتيب الصارم):
#   1) تأكيد من المستخدم.
#   2) إيقاف الـ stack (app فقط — Caddy يبقى ليعرض صفحة صيانة لاحقاً إن أردت).
#   3) نسخ الـ DB الحالي إلى backups/pre-restore-<tag>/ (تأمين).
#   4) فكّ الـ DB ووضعه مكانه.
#   5) فكّ sessions tar في DATA_DIR (إن لم يكن --db-only).
#   6) integrity_check.
#   7) إعادة تشغيل الـ stack.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="/srv/jrd/data"
DB_FILE="$DATA_DIR/jrd.db"
BACKUP_DIR="$DATA_DIR/backups"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

DB_ONLY=0
MONTHLY=0
DRY_RUN=0
TAG=""

for arg in "$@"; do
	case "$arg" in
		--db-only)  DB_ONLY=1 ;;
		--monthly)  MONTHLY=1 ;;
		--dry-run)  DRY_RUN=1 ;;
		--*)        echo "خيار غير معروف: $arg" >&2; exit 2 ;;
		*)          TAG="$arg" ;;
	esac
done

# تفاعلي: لا tag → اعرض النسخ
if [ -z "$TAG" ]; then
	echo "النسخ اليومية المتاحة:"
	ls -1 "$BACKUP_DIR/daily/" 2>/dev/null | grep -E '^jrd-.*\.db\.gz$' | sed 's/^jrd-//; s/\.db\.gz$//' | tail -20
	echo ""
	echo "النسخ الشهرية المتاحة:"
	ls -1 "$BACKUP_DIR/monthly/" 2>/dev/null | grep -E '^jrd-.*\.db\.gz$' | sed 's/^jrd-//; s/\.db\.gz$//'
	echo ""
	read -rp "أدخل tag للاسترجاع (مثلاً 2026-06-12_0330 أو latest): " TAG
	[ -z "$TAG" ] && { echo "تم الإلغاء."; exit 0; }
fi

# fallback: latest
if [ "$TAG" = "latest" ]; then
	TAG="$(ls -1t "$BACKUP_DIR/daily/" | grep -E '^jrd-.*\.db\.gz$' | head -1 | sed 's/^jrd-//; s/\.db\.gz$//')"
	[ -z "$TAG" ] && { echo "لا توجد نسخ يومية." >&2; exit 1; }
	echo "==> آخر يومية: $TAG"
fi

# اختر مجلد الـ backup
if [ "$MONTHLY" = "1" ]; then
	DB_GZ="$BACKUP_DIR/monthly/jrd-${TAG}.db.gz"
	SESS_GZ="$BACKUP_DIR/monthly/sessions-${TAG}.tar.gz"
else
	DB_GZ="$BACKUP_DIR/daily/jrd-${TAG}.db.gz"
	SESS_GZ="$BACKUP_DIR/daily/sessions-${TAG}.tar.gz"
fi

[ -f "$DB_GZ" ] || { echo "الملف غير موجود: $DB_GZ" >&2; exit 1; }
if [ "$DB_ONLY" = "0" ] && [ ! -f "$SESS_GZ" ]; then
	echo "تحذير: لا يوجد sessions tar لهذا التاج. تابع كـ --db-only؟"
	read -rp "(y/N): " ans
	[ "${ans:-}" = "y" ] || exit 1
	DB_ONLY=1
fi

# تحقق من سلامة الـ gz
echo "==> فحص سلامة $DB_GZ ..."
gunzip -t "$DB_GZ"
[ "$DB_ONLY" = "0" ] && { echo "==> فحص $SESS_GZ ..."; gzip -t "$SESS_GZ"; }

# عرض ملخّص + تأكيد
echo ""
echo "============================================================"
echo "  سيتمّ استرجاع:"
echo "    DB:       $DB_GZ"
[ "$DB_ONLY" = "0" ] && echo "    Sessions: $SESS_GZ"
echo "  الـ DB الحالي سيُنقَل إلى:"
echo "    $BACKUP_DIR/pre-restore-${TAG}/"
echo "============================================================"
if [ "$DRY_RUN" = "1" ]; then
	echo "[DRY-RUN] لم يُنفَّذ شيء."
	exit 0
fi
read -rp "متأكد؟ اكتب YES للمتابعة: " confirm
[ "$confirm" = "YES" ] || { echo "تم الإلغاء."; exit 0; }

# 1) إيقاف app
echo "==> إيقاف الـ app ..."
docker compose -f "$COMPOSE_FILE" stop app || true

# 2) تأمين الـ DB الحالي
SAFE_DIR="$BACKUP_DIR/pre-restore-${TAG}"
mkdir -p "$SAFE_DIR"
echo "==> نسخ DB الحالي إلى $SAFE_DIR ..."
[ -f "$DB_FILE" ]      && cp -a "$DB_FILE"      "$SAFE_DIR/" || true
[ -f "${DB_FILE}-wal" ] && cp -a "${DB_FILE}-wal" "$SAFE_DIR/" || true
[ -f "${DB_FILE}-shm" ] && cp -a "${DB_FILE}-shm" "$SAFE_DIR/" || true

# 3) امسح WAL/SHM لتجنّب تعارض
rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"

# 4) فكّ الـ DB
echo "==> استرجاع DB ..."
gunzip -c "$DB_GZ" > "$DB_FILE"

# 5) integrity check
echo "==> فحص سلامة DB ..."
if command -v sqlite3 >/dev/null 2>&1; then
	RES="$(sqlite3 "$DB_FILE" 'PRAGMA integrity_check;' 2>&1)"
	if [ "$RES" != "ok" ]; then
		echo "!! فشل integrity_check: $RES" >&2
		echo "   الـ DB القديم في $SAFE_DIR — استرجعه يدوياً."
		exit 1
	fi
	echo "    OK"
fi

# 6) sessions
if [ "$DB_ONLY" = "0" ]; then
	echo "==> استرجاع sessions ..."
	# امسح المجلدات الحالية لتجنّب خلط الجلسات
	rm -rf "$DATA_DIR/auth_sessions" "$DATA_DIR/browser-data" "$DATA_DIR/gmsg-browser-data" "$DATA_DIR/tenants" 2>/dev/null || true
	tar -xzf "$SESS_GZ" -C "$DATA_DIR"
fi

# 7) إعادة تشغيل
echo "==> إعادة تشغيل الـ app ..."
docker compose -f "$COMPOSE_FILE" up -d app

# انتظر healthcheck
echo "==> انتظار healthcheck ..."
for i in $(seq 1 30); do
	sleep 2
	if curl -fsS http://127.0.0.1:3001/healthz >/dev/null 2>&1; then
		echo ""
		echo "✓ تم الاسترجاع بنجاح."
		echo "  النسخة السابقة محفوظة في: $SAFE_DIR"
		exit 0
	fi
	printf '.'
done
echo ""
echo "!! الـ app لم يستجب لـ healthcheck بعد الاسترجاع." >&2
echo "   تحقّق من: docker compose -f $COMPOSE_FILE logs app" >&2
exit 1
