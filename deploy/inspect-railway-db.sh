#!/bin/bash
DB=/srv/jrd/migration/jrd-railway.db
echo "=== TABLES ==="
sqlite3 "$DB" ".tables"
echo
echo "=== ROW COUNTS ==="
for t in $(sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"); do
  c=$(sqlite3 "$DB" "SELECT COUNT(*) FROM $t;")
  printf "%-30s %s\n" "$t" "$c"
done
echo
echo "=== SCHEMAS (key tables) ==="
for t in items current_values api_configs inventories inventory_items monthly_inventories monthly_inventory_items photos settings bank_transactions bank_sms_log whatsapp_messages whatsapp_transactions; do
  echo "--- $t ---"
  sqlite3 "$DB" ".schema $t" 2>/dev/null || echo "(missing)"
done
