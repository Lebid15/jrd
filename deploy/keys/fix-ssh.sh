#!/usr/bin/env bash
# diagnose + fix SSH key auth on Hetzner.
# Run as root:   bash /srv/jrd/app/deploy/keys/fix-ssh.sh
#
# يُركّب أي ملف *.pub موجود في هذا المجلد على /root/.ssh/authorized_keys
# (مع إزالة المكرّر) — لذلك إضافة جهاز جديد = git add deploy/keys/<name>.pub + git push.
set -u

OUT=/tmp/ssh-diag.txt
KEYS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTH_FILE=/root/.ssh/authorized_keys

: > "$OUT"
exec > >(tee -a "$OUT") 2>&1

echo "===== 1) /root + .ssh permissions ====="
ls -ld /root
ls -ld /root/.ssh 2>/dev/null || echo "no /root/.ssh"
ls -la /root/.ssh 2>/dev/null || true

echo
echo "===== 2) install authorized_keys from repo (all *.pub) ====="
mkdir -p /root/.ssh
chmod 700 /root/.ssh
chown root:root /root/.ssh

PUB_FILES=("$KEYS_DIR"/*.pub)
if [ ! -e "${PUB_FILES[0]}" ]; then
  echo "ERROR: no .pub files found in $KEYS_DIR. run: cd /srv/jrd/app && git pull"
else
  # نحافظ على المفاتيح الموجودة، نضيف الجديدة، ونُزيل المكرّر
  TMP=$(mktemp)
  [ -f "$AUTH_FILE" ] && cat "$AUTH_FILE" >> "$TMP"
  for f in "${PUB_FILES[@]}"; do
    echo "+ $f"
    cat "$f" >> "$TMP"
  done
  # تنظيف: سطر فارغ + dedup مع الحفاظ على الترتيب
  awk 'NF && !seen[$0]++' "$TMP" > "$AUTH_FILE"
  rm -f "$TMP"
  chmod 600 "$AUTH_FILE"
  chown root:root "$AUTH_FILE"
  echo "wrote $AUTH_FILE — keys installed:"
  ssh-keygen -lf "$AUTH_FILE" || true
fi
ls -la /root/.ssh

echo
echo "===== 3) sshd process + config in use ====="
ps -ef | grep -E "sshd" | grep -v grep
SSHD_BIN=$(command -v sshd)
echo "sshd binary: $SSHD_BIN"
echo "--- sshd -T (effective config, filtered) ---"
$SSHD_BIN -T 2>&1 | grep -iE "permitroot|pubkey|authorizedkeys|passwordauth|usepam|authenticationmethods" || true

echo
echo "===== 4) sshd config files present ====="
for f in /etc/ssh/sshd_config /usr/share/openssh/sshd_config; do
  if [ -f "$f" ]; then echo "FOUND: $f"; else echo "MISSING: $f"; fi
done
ls -la /etc/ssh/sshd_config.d/ 2>/dev/null || echo "no /etc/ssh/sshd_config.d/"

echo
echo "===== 5) if no /etc/ssh/sshd_config, recreate from package default ====="
if [ ! -f /etc/ssh/sshd_config ]; then
  if [ -f /usr/share/openssh/sshd_config ]; then
    cp /usr/share/openssh/sshd_config /etc/ssh/sshd_config
    echo "copied default config to /etc/ssh/sshd_config"
  else
    echo "reinstalling openssh-server to restore configs..."
    DEBIAN_FRONTEND=noninteractive apt-get install --reinstall -y openssh-server
  fi
fi

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-jrd-root-key.conf <<'EOF'
# allow root login with key, no password
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
AuthorizedKeysFile .ssh/authorized_keys
EOF
echo "wrote /etc/ssh/sshd_config.d/00-jrd-root-key.conf"

echo
echo "===== 6) test + restart sshd ====="
$SSHD_BIN -t && echo "config OK" || { echo "BAD CONFIG, aborting"; exit 1; }
systemctl restart ssh
sleep 1
systemctl is-active ssh
$SSHD_BIN -T 2>&1 | grep -iE "permitroot|pubkey|authorizedkeys|passwordauth" || true

echo
echo "===== DONE. log saved to $OUT ====="

echo
echo "===== 3) sshd process + config in use ====="
ps -ef | grep -E "sshd" | grep -v grep
SSHD_BIN=$(command -v sshd)
echo "sshd binary: $SSHD_BIN"
echo "--- sshd -T (effective config, filtered) ---"
$SSHD_BIN -T 2>&1 | grep -iE "permitroot|pubkey|authorizedkeys|passwordauth|usepam|authenticationmethods" || true

echo
echo "===== 4) sshd config files present ====="
for f in /etc/ssh/sshd_config /usr/share/openssh/sshd_config; do
  if [ -f "$f" ]; then echo "FOUND: $f"; else echo "MISSING: $f"; fi
done
ls -la /etc/ssh/sshd_config.d/ 2>/dev/null || echo "no /etc/ssh/sshd_config.d/"

echo
echo "===== 5) if no /etc/ssh/sshd_config, recreate from package default ====="
if [ ! -f /etc/ssh/sshd_config ]; then
  if [ -f /usr/share/openssh/sshd_config ]; then
    cp /usr/share/openssh/sshd_config /etc/ssh/sshd_config
    echo "copied default config to /etc/ssh/sshd_config"
  else
    echo "reinstalling openssh-server to restore configs..."
    DEBIAN_FRONTEND=noninteractive apt-get install --reinstall -y openssh-server
  fi
fi

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-jrd-root-key.conf <<'EOF'
# allow root login with key, no password
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
AuthorizedKeysFile .ssh/authorized_keys
EOF
echo "wrote /etc/ssh/sshd_config.d/00-jrd-root-key.conf"

echo
echo "===== 6) test + restart sshd ====="
$SSHD_BIN -t && echo "config OK" || { echo "BAD CONFIG, aborting"; exit 1; }
systemctl restart ssh
sleep 1
systemctl is-active ssh
$SSHD_BIN -T 2>&1 | grep -iE "permitroot|pubkey|authorizedkeys|passwordauth" || true

echo
echo "===== DONE. log saved to $OUT ====="
