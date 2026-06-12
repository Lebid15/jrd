#!/usr/bin/env bash
# ============================================================
# JRD — Railway data export
# ------------------------------------------------------------
# يُشغَّل من جهازك المحلي (يحتاج railway CLI مُسجَّل دخول).
# يُنزّل:
#   1) snapshot قاعدة بيانات SQLite من Railway.
#   2) tar.gz لمجلدات الجلسات.
#   3) checksum للتحقّق.
#
# الاستخدام:
#   railway login
#   railway link <project-id>
#   ./railway-export.sh                       # خدمة backend افتراضياً
#   ./railway-export.sh --service backend
#   SERVICE=backend ./railway-export.sh
#
# المخرَجات في: ./railway-export-<YYYY-MM-DD_HHMM>/
#   ├── final.db
#   ├── sessions.tar.gz
#   └── checksums.sha256
# ============================================================
set -euo pipefail

SERVICE="${SERVICE:-backend}"
for arg in "$@"; do
	case "$arg" in
		--service) shift; SERVICE="${1:-backend}" ;;
	esac
done

command -v railway >/dev/null 2>&1 || {
	echo "❌ railway CLI غير مثبَّت. ثبّته من: https://docs.railway.app/develop/cli" >&2
	exit 1
}

OUT="./railway-export-$(date +%F_%H%M)"
mkdir -p "$OUT"
echo "===> تصدير من Railway service='$SERVICE' إلى $OUT/"

# 1) snapshot DB (داخل الحاوية)
echo "    [1/3] DB snapshot ..."
railway run --service "$SERVICE" -- bash -lc '
  set -e
  DB="${DB_PATH:-/app/data/jrd.db}"
  [ -f "$DB" ] || DB="/app/backend/data/jrd.db"
  [ -f "$DB" ] || { echo "لم أجد jrd.db" >&2; exit 1; }
  sqlite3 "$DB" ".backup /tmp/final.db"
  ls -lh /tmp/final.db
' || { echo "❌ فشل snapshot DB"; exit 1; }

echo "    تنزيل final.db ..."
railway run --service "$SERVICE" -- cat /tmp/final.db > "$OUT/final.db"

# 2) tar sessions
echo "    [2/3] sessions tar.gz ..."
railway run --service "$SERVICE" -- bash -lc '
  set -e
  cd "${DATA_DIR:-/app/data}" 2>/dev/null || cd /app/backend/data
  tar -czf /tmp/sessions.tar.gz \
    --ignore-failed-read \
    auth_sessions browser-data gmsg-browser-data uploads tenants 2>/dev/null || true
  ls -lh /tmp/sessions.tar.gz
' || { echo "تحذير: فشل tar sessions (قد لا توجد مجلدات)"; }

echo "    تنزيل sessions.tar.gz ..."
railway run --service "$SERVICE" -- cat /tmp/sessions.tar.gz > "$OUT/sessions.tar.gz" 2>/dev/null || true

# 3) checksums
echo "    [3/3] checksums ..."
(cd "$OUT" && sha256sum final.db sessions.tar.gz 2>/dev/null > checksums.sha256)
cat "$OUT/checksums.sha256"

# تنظيف داخل الحاوية
railway run --service "$SERVICE" -- bash -lc 'rm -f /tmp/final.db /tmp/sessions.tar.gz' || true

# فحص محلي
echo ""
echo "===> فحص محلي:"
if command -v sqlite3 >/dev/null 2>&1; then
	RES="$(sqlite3 "$OUT/final.db" 'PRAGMA integrity_check;')"
	echo "    DB integrity: $RES"
	echo "    tenants count: $(sqlite3 "$OUT/final.db" 'SELECT COUNT(*) FROM tenants;' 2>/dev/null || echo N/A)"
	echo "    users count:   $(sqlite3 "$OUT/final.db" 'SELECT COUNT(*) FROM users;'   2>/dev/null || echo N/A)"
	echo "    items count:   $(sqlite3 "$OUT/final.db" 'SELECT COUNT(*) FROM items;'   2>/dev/null || echo N/A)"
fi
[ -f "$OUT/sessions.tar.gz" ] && echo "    sessions size: $(du -h "$OUT/sessions.tar.gz" | cut -f1)"

echo ""
echo "✓ التصدير اكتمل."
echo "  الخطوة التالية (راجع cutover-checklist.md):"
echo "    scp $OUT/final.db        root@HETZNER:/srv/jrd/data/backups/daily/jrd-cutover.db"
echo "    scp $OUT/sessions.tar.gz root@HETZNER:/srv/jrd/data/backups/daily/sessions-cutover.tar.gz"
echo "    ssh root@HETZNER 'gzip /srv/jrd/data/backups/daily/jrd-cutover.db && cd /srv/jrd/app/deploy && ./restore.sh cutover'"
