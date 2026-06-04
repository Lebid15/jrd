#!/bin/sh
set -e

echo "Starting backend..."
node backend/src/index.js &
BACKEND_PID=$!

echo "Starting bot..."
node bot/src/index.js &
BOT_PID=$!

echo "Both services started (backend=$BACKEND_PID, bot=$BOT_PID)"

wait $BACKEND_PID $BOT_PID
