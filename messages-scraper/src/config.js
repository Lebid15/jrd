import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function str(name, def = '') {
  const v = process.env[name];
  return v == null || v === '' ? def : String(v);
}
function int(name, def) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) ? v : def;
}
function bool(name, def) {
  const v = String(process.env[name] || '').toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return def;
}

export const config = {
  port: int('GMSG_PORT', 3101),
  host: str('GMSG_HOST', '0.0.0.0'),

  internalApiKey: str('INTERNAL_API_KEY', ''),
  backendUrl: str('BACKEND_URL', 'http://127.0.0.1:3001'),

  browserDataDir: str('GMSG_BROWSER_DATA', '') || path.join(__dirname, '..', 'browser-data'),
  headless: bool('GMSG_HEADLESS', true),
  targetContact: str('GMSG_TARGET_CONTACT', 'KUVEYT TURK'),

  pollIntervalMs: int('GMSG_POLL_INTERVAL_MS', 12000),
  navTimeoutMs: int('GMSG_NAV_TIMEOUT_MS', 45000),
  pairingTimeoutSec: int('GMSG_PAIRING_TIMEOUT_SEC', 300),

  // عدد آخر الرسائل التي نقرأها كل دورة بحثاً عن الجديد
  scanLastN: int('GMSG_SCAN_LAST_N', 20),

  // التشغيل التلقائي عند الإقلاع (true في الإنتاج، false محلياً لو أردت ضبط يدوي)
  autoStart: bool('GMSG_AUTOSTART', true),

  // مسار ملف seen.json (داخل browserDataDir افتراضياً)
  seenFile: '', // يُحسب لاحقاً
};

config.seenFile = path.join(config.browserDataDir, 'seen.json');
