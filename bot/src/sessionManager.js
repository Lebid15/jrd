import fs from 'fs';
import path from 'path';
import { Session } from './session.js';
import { config } from './config.js';
import logger from './logger.js';

const sessions = new Map();

export function getSession(tenantId) {
  return sessions.get(String(tenantId));
}

export function getOrCreateSession(tenantId) {
  const id = String(tenantId);
  if (!sessions.has(id)) {
    sessions.set(id, new Session(id));
  }
  return sessions.get(id);
}

export async function startSession(tenantId, opts = {}) {
  const session = getOrCreateSession(tenantId);
  await session.start(opts);
  return session;
}

export async function logoutSession(tenantId) {
  const session = getSession(tenantId);
  if (session) await session.logout();
}

export async function resetSession(tenantId) {
  const session = getOrCreateSession(tenantId);
  await session.purgeAuth();
  await session.start({ force: true });
  return session;
}

export function listSessions() {
  return [...sessions.values()].map(s => s.status());
}

// عند الإقلاع — استئناف كل الجلسات الموجودة على القرص
export async function bootstrap() {
  const authDir = config.authDir;
  if (!fs.existsSync(authDir)) return;

  const folders = fs.readdirSync(authDir).filter(f =>
    fs.statSync(path.join(authDir, f)).isDirectory()
  );

  logger.info({ count: folders.length }, 'Bootstrapping sessions');
  for (const tenantId of folders) {
    await startSession(tenantId);
  }
}
