import { config } from './config.js';
import logger from './logger.js';

const BASE = config.backendUrl;
const KEY = config.internalApiKey;

async function request(path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Api-Key': KEY,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function ingestMessage(payload) {
  try {
    return await request('/api/internal/ingest', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'ingest failed');
  }
}
