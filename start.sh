#!/bin/sh
set -e

# Railway يضبط PORT لـ backend (الخدمة العامة).
# البوت يحتاج معرفة هذا المنفذ ليتصل بـ backend داخلياً.
BACKEND_PORT="${PORT:-3001}"
export BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"

echo "Starting backend on port ${BACKEND_PORT}..."
node backend/src/index.js &
BACKEND_PID=$!

# انتظر أن يصبح backend جاهزاً قبل تشغيل البوت
echo "Waiting for backend to be ready..."
for i in $(seq 1 30); do
  if wget -q --spider "http://127.0.0.1:${BACKEND_PORT}/api/items" 2>/dev/null \
     || wget -q --spider "http://127.0.0.1:${BACKEND_PORT}/" 2>/dev/null; then
    echo "Backend is ready"
    break
  fi
  sleep 1
done

echo "Starting bot (BACKEND_URL=${BACKEND_URL})..."
node bot/src/index.js &
BOT_PID=$!

echo "Both services started (backend=$BACKEND_PID, bot=$BOT_PID)"

wait $BACKEND_PID $BOT_PID
