import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_DIR = process.env.SCRAPER_DIR
  ? path.resolve(process.env.SCRAPER_DIR)
  : path.join(__dirname, '..', '..', 'scraper');
const SCRAPER_ENTRY = path.join(SCRAPER_DIR, 'src', 'fetch.js');
const ROUTE_ENTRY = path.join(SCRAPER_DIR, 'src', 'route-tariffs.js');
const GAMES_ROUTE_ENTRY = path.join(SCRAPER_DIR, 'src', 'route-games.js');
const BROWSER_DATA_ROOT = process.env.DATA_DIR
  ? path.join(path.resolve(process.env.DATA_DIR), 'browser-data')
  : path.join(SCRAPER_DIR, 'browser-data');

const TIMEOUT_MS = parseInt(process.env.SCRAPER_TIMEOUT_MS || '180000', 10);

// عزل filesystem لكل مستأجر+بند لجلسة المتصفّح.
function browserDirFor(tenantId, itemId) {
  const tenantDir = path.join(BROWSER_DATA_ROOT, `t${tenantId}`);
  const dir = itemId ? path.join(tenantDir, `item-${itemId}`) : tenantDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// مشغّل عامّ لسكرابر Playwright: يُطلق العملية، يلتقط RESULT_JSON، ويعيد الكائن.
function runScraper(entry, extraEnv, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: SCRAPER_DIR,
      env: { ...process.env, HEADLESS: 'true', ...extraEnv },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; process.stdout.write('[scraper] ' + s); });
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; process.stderr.write('[scraper:err] ' + s); });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Scraper timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => { clearTimeout(timer); reject(new Error('Failed to spawn scraper: ' + err.message)); });

    child.on('close', (code) => {
      clearTimeout(timer);
      const match = stdout.match(/RESULT_JSON=(\{[\s\S]*\})\s*$/m) || stdout.match(/RESULT_JSON=(\{[^\n]*\})/);
      if (match) {
        try { return resolve(JSON.parse(match[1])); }
        catch (err) { return reject(new Error('Bad JSON from scraper: ' + err.message)); }
      }
      const allLines = (stdout + '\n' + stderr).split('\n').map((l) => l.trim()).filter(Boolean);
      const errLine = allLines.find((l) => l.startsWith('[error]'));
      const meaningful = errLine ? errLine.replace(/^\[error\]\s*/, '') : allLines.slice(-5).join(' | ');
      reject(new Error(`Scraper exited (code ${code}): ${meaningful.slice(0, 500)}`));
    });
  });
}

/**
 * Run the bayi.alayatl scraper as a child process.
 * Returns the parsed totals object: { bakiye_toplami, borc_toplami, bayi_alacagi, toplam_bayi_sayisi }
 *
 * المسار: BROWSER_DATA_ROOT/t<tenantId>/item-<itemId>/ — عزل filesystem لكل مستأجر+بند.
 */
export function runBayiAlayatlScraper(config, { itemId, tenantId = 1 } = {}) {
  const phone = (config?.kod || '').trim();
  const password = (config?.sifre || '').trim();
  const loginUrl = (config?.base_url || '').trim() || 'http://bayi.alayatl.com/index.php?giris=true';
  const pin = (config?.pin || '').trim();
  if (!phone || !password) {
    return Promise.reject(new Error('Missing phone (kod) or password (sifre)'));
  }
  return runScraper(SCRAPER_ENTRY, {
    BAYI_PHONE: phone,
    BAYI_PASSWORD: password,
    BAYI_LOGIN_URL: loginUrl,
    // رمز الـ PIN الخاص بالعميل (يختلف لكل موقع). لو فارغ، السكرابر يستخدم الافتراضي.
    ...(pin ? { BAYI_PIN: pin } : {}),
    BROWSER_DATA_DIR: browserDirFor(tenantId, itemId),
  });
}

/**
 * روبوت توجيه الباقات على لوحة زينت (Kontör admin_tarifeler.php).
 * يعيد استخدام نفس جلسة دخول روبوت الديون (نفس item-<id> browser-data).
 *   mode: 'inspect' | 'dryrun' | 'apply'
 *   plan: { '<رقم الربط>': ['اسم1','اسم2','اسم3'] }  (Kapat لإغلاق الخانة)
 * يُرجع كائن النتيجة من السكرابر (RESULT_JSON).
 */
export function runTariffRouter(config, { mode = 'dryrun', operator, type, plan = {}, itemId, tenantId = 1 } = {}) {
  const phone = (config?.kod || '').trim();
  const password = (config?.sifre || '').trim();
  const loginUrl = (config?.base_url || '').trim() || 'http://bayi.alayatl.com/index.php?giris=true';
  const pin = (config?.pin || '').trim();
  if (!phone || !password) {
    return Promise.reject(new Error('Missing phone (kod) or password (sifre)'));
  }
  // apply قد يمرّ على صفوف كثيرة (250ms/خانة) — نمنحه وقتاً أطول.
  const timeoutMs = mode === 'apply' ? 600000 : 240000;
  return runScraper(ROUTE_ENTRY, {
    BAYI_PHONE: phone,
    BAYI_PASSWORD: password,
    BAYI_LOGIN_URL: loginUrl,
    ...(pin ? { BAYI_PIN: pin } : {}),
    BROWSER_DATA_DIR: browserDirFor(tenantId, itemId),
    ROUTE_MODE: mode,
    ROUTE_OPERATOR: operator || '',
    ROUTE_TYPE: type || '',
    ROUTE_PLAN: JSON.stringify(plan || {}),
  }, { timeoutMs });
}

/**
 * روبوت توجيه الألعاب على لوحة زينت (OyunPin/admin_allPinList.php) — خانتان (Api1/Api2).
 * يطابق كل صفّ برقم منتج الافتراضي. plan: { '<رقم المنتج>': ['اسم1','اسم2'] }.
 */
export function runGamesRouter(config, { mode = 'dryrun', plan = {}, itemId, tenantId = 1 } = {}) {
  const phone = (config?.kod || '').trim();
  const password = (config?.sifre || '').trim();
  const loginUrl = (config?.base_url || '').trim() || 'http://bayi.alayatl.com/index.php?giris=true';
  const pin = (config?.pin || '').trim();
  if (!phone || !password) return Promise.reject(new Error('Missing phone (kod) or password (sifre)'));
  const timeoutMs = mode === 'apply' ? 600000 : 240000;
  return runScraper(GAMES_ROUTE_ENTRY, {
    BAYI_PHONE: phone,
    BAYI_PASSWORD: password,
    BAYI_LOGIN_URL: loginUrl,
    ...(pin ? { BAYI_PIN: pin } : {}),
    BROWSER_DATA_DIR: browserDirFor(tenantId, itemId),
    ROUTE_MODE: mode,
    ROUTE_PLAN: JSON.stringify(plan || {}),
  }, { timeoutMs });
}
