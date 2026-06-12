#!/usr/bin/env bash
# ============================================================
# JRD — Backup script (يُستدعى من cron يومياً)
# ------------------------------------------------------------
# الإستراتيجية:
#   1) snapshot لقاعدة بيانات SQLite عبر `.backup` (آمن أثناء الكتابة).
#   2) ضغط الـ snapshot.
#   3) ضمّ مجلدات الجلسات الحسّاسة (auth_sessions + browser-data + gmsg)
#      في أرشيف tar.gz واحد.
#   4) رفع الكل إلى Hetzner Storage Box عبر rsync فوق SSH.
#   5) retention محلي: آخر 7 أيام يومية + آخر 12 شهراً (الأوّل من كل شهر).
#
# المتطلبات على الخادم:
#   - sqlite3 مثبَّت (apt install sqlite3)
#   - rsync مثبَّت
#   - SSH key للوصول لـ Storage Box (راجع README)
#   - متغيرات البيئة في /srv/jrd/app/deploy/.env
#
# الاستخدام:
#   ./backup.sh             # نسخة كاملة + رفع
#   ./backup.sh --local     # نسخة محلية فقط بدون رفع
#   ./backup.sh --db-only   # DB فقط
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="/srv/jrd/data"
DB_FILE="$DATA_DIR/jrd.db"
BACKUP_DIR="$DATA_DIR/backups"
DATE="$(date +%F)"                  # 2026-06-12
TIME="$(date +%H%M)"                # 0245
TAG="${DATE}_${TIME}"
RETENTION_DAYS=7
RETENTION_MONTHLY=12

# قراءة .env (للوصول لـ STORAGE_BOX_*)
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
	set -a
	# shellcheck disable=SC1090
	. "$ENV_FILE"
	set +a
fi

LOCAL_ONLY=0
DB_ONLY=0
for arg in "$@"; do
	case "$arg" in
		--local)   LOCAL_ONLY=1 ;;
		--db-only) DB_ONLY=1 ;;
	esac
done

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/monthly"

echo "===> JRD backup ($TAG)"

# 1) DB snapshot
DB_OUT="$BACKUP_DIR/daily/jrd-${TAG}.db"
echo "    DB snapshot → $DB_OUT"
if command -v sqlite3 >/dev/null 2>&1; then
	sqlite3 "$DB_FILE" ".backup '$DB_OUT'"
else
	# fallback: نسخ مباشر (آمن مع WAL لكن أقل دقّة)
	cp -a "$DB_FILE" "$DB_OUT"
fi
gzip -9 "$DB_OUT"
DB_GZ="${DB_OUT}.gz"

# 2) أرشيف الجلسات (إن لم تكن --db-only)
SESS_GZ=""
if [ "$DB_ONLY" = "0" ]; then
	SESS_GZ="$BACKUP_DIR/daily/sessions-${TAG}.tar.gz"
	echo "    sessions archive → $SESS_GZ"
	tar -czf "$SESS_GZ" \
		-C "$DATA_DIR" \
		--ignore-failed-read \
		auth_sessions browser-data gmsg-browser-data tenants 2>/dev/null || true
fi

# 3) نسخة شهرية (الأوّل من الشهر)
if [ "$(date +%d)" = "01" ]; then
	cp "$DB_GZ" "$BACKUP_DIR/monthly/jrd-$(date +%Y-%m).db.gz"
	[ -n "$SESS_GZ" ] && cp "$SESS_GZ" "$BACKUP_DIR/monthly/sessions-$(date +%Y-%m).tar.gz"
fi

# 4) رفع إلى Storage Box
if [ "$LOCAL_ONLY" = "0" ] && [ -n "${STORAGE_BOX_USER:-}" ] && [ -n "${STORAGE_BOX_HOST:-}" ]; then
	REMOTE="${STORAGE_BOX_USER}@${STORAGE_BOX_HOST}"
	REMOTE_PATH="${STORAGE_BOX_PATH:-/home/backups/jrd}"
	SSH_PORT="${STORAGE_BOX_PORT:-23}"
	SSH_KEY="${STORAGE_BOX_KEY:-/root/.ssh/storage_box}"

	echo "    rsync → $REMOTE:$REMOTE_PATH (port $SSH_PORT)"
	rsync -az --delete-after \
		-e "ssh -p $SSH_PORT -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
		"$BACKUP_DIR/" \
		"$REMOTE:$REMOTE_PATH/" \
		|| { echo "تحذير: فشل rsync — النسخ المحلية محفوظة."; }
else
	echo "    تخطّي الرفع (LOCAL_ONLY أو STORAGE_BOX_* غير معرَّفة)"
fi

# 5) retention
echo "    تنظيف النسخ القديمة (>${RETENTION_DAYS} يوم)"
find "$BACKUP_DIR/daily"   -type f -mtime "+${RETENTION_DAYS}"            -delete || true
find "$BACKUP_DIR/monthly" -type f -mtime "+$((RETENTION_MONTHLY*31))"    -delete || true

echo "===> done"
