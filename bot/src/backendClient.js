import { config } from './config.js';
import logger from './logger.js';

// تجنّب مشاكل IPv6 في Node 20: حوّل localhost إلى 127.0.0.1
const BASE = (config.backendUrl || '').replace('://localhost', '://127.0.0.1');
const KEY = config.internalApiKey;

async function request(path, payload) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
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
  } catch (e) {
    logger.error({ url, err: e.message, cause: e.cause?.code || e.cause?.message }, 'backend request failed');
    throw e;
  }
}

export async function ingestMessage(payload) {
  try {
    return await request('/api/internal/ingest', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'ingest failed');
  }
}
