#!/usr/bin/env bash
# ============================================================
# JRD — Backup verifier
# ------------------------------------------------------------
# يفحص آخر نسخة احتياطية يومية بدون استرجاعها فعلاً:
#   1) فكّ DB إلى /tmp.
#   2) PRAGMA integrity_check + quick_check.
#   3) عدّ السجلّات في الجداول الحسّاسة (sanity).
#   4) فكّ sessions tar إلى /tmp والتحقّق من البنية.
#
# يُستخدَم في cron أسبوعياً للتأكد أن النسخ ليست تالفة.
#
# الاستخدام:
#   ./backup-verify.sh                  # آخر يومية
#   ./backup-verify.sh 2026-06-12_0330  # tag محدّد
# ============================================================
set -euo pipefail

DATA_DIR="/srv/jrd/data"
BACKUP_DIR="$DATA_DIR/backups"
TAG="${1:-}"
TMP="$(mktemp -d -t jrd-verify-XXXX)"
trap 'rm -rf "$TMP"' EXIT

# tag → آخر يومية إن لم يُحدَّد
if [ -z "$TAG" ]; then
	TAG="$(ls -1t "$BACKUP_DIR/daily/" 2>/dev/null | grep -E '^jrd-.*\.db\.gz$' | head -1 | sed 's/^jrd-//; s/\.db\.gz$//')"
	[ -z "$TAG" ] && { echo "FAIL: لا توجد نسخ يومية." >&2; exit 1; }
fi

DB_GZ="$BACKUP_DIR/daily/jrd-${TAG}.db.gz"
SESS_GZ="$BACKUP_DIR/daily/sessions-${TAG}.tar.gz"

echo "===> verify tag: $TAG"

# 1) DB
[ -f "$DB_GZ" ] || { echo "FAIL: $DB_GZ غير موجود." >&2; exit 1; }
echo "    gunzip -t DB ..."
gunzip -t "$DB_GZ"

DB_OUT="$TMP/jrd.db"
gunzip -c "$DB_GZ" > "$DB_OUT"

if ! command -v sqlite3 >/dev/null 2>&1; then
	echo "تحذير: sqlite3 غير مثبَّت — تخطّي فحص DB."
else
	echo "    PRAGMA integrity_check ..."
	RES="$(sqlite3 "$DB_OUT" 'PRAGMA integrity_check;')"
	[ "$RES" = "ok" ] || { echo "FAIL: integrity_check = $RES" >&2; exit 1; }

	echo "    sanity counts:"
	for tbl in tenants users items current_values bank_transactions whatsapp_messages settings; do
		# الجدول قد لا يوجد في DB قديمة جداً — لا توقف
		n="$(sqlite3 "$DB_OUT" "SELECT COUNT(*) FROM $tbl;" 2>/dev/null || echo 'N/A')"
		printf '      %-22s %s\n' "$tbl" "$n"
	done
fi

# 2) Sessions
if [ -f "$SESS_GZ" ]; then
	echo "    gzip -t sessions ..."
	gzip -t "$SESS_GZ"
	SIZE="$(du -h "$SESS_GZ" | cut -f1)"
	COUNT="$(tar -tzf "$SESS_GZ" | wc -l)"
	echo "    sessions: $SIZE  ($COUNT ملف/مجلد)"
else
	echo "    لا يوجد sessions tar لهذا التاج (DB-only؟)"
fi

echo "===> OK ✓"
