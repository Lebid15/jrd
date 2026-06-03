# syntax=docker/dockerfile:1.7

# ============================================================
# JRD — Dockerfile
# Single runtime base: Playwright (Node 20 + Chromium + libs).
# Builds native deps (better-sqlite3) INSIDE the final image
# to guarantee ABI compatibility with the runtime glibc.
# ============================================================

# ---------- Stage 1: build frontend (small, fast) ----------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: final runtime ----------
FROM mcr.microsoft.com/playwright:v1.47.0-jammy AS runtime

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3001 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Build tools for better-sqlite3 native compile
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend deps (native compile happens here against runtime libc)
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev && npm cache clean --force

# Install scraper deps
COPY scraper/package*.json ./scraper/
RUN cd scraper && npm install --omit=dev && npm cache clean --force

# Copy app source
COPY backend/ ./backend/
COPY scraper/ ./scraper/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Persistent data dir (mounted as a Volume in Railway)
RUN mkdir -p /data/uploads /data/browser-data

# Note: we run as root because Railway-mounted volumes are root-owned.
# Chromium is launched with --no-sandbox (see scraper/src/fetch.js).
# This is acceptable for a single-tenant internal app.

EXPOSE 3001

CMD ["node", "backend/src/index.js"]
