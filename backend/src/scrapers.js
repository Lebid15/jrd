import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_DIR = process.env.SCRAPER_DIR
  ? path.resolve(process.env.SCRAPER_DIR)
  : path.join(__dirname, '..', '..', 'scraper');
const SCRAPER_ENTRY = path.join(SCRAPER_DIR, 'src', 'fetch.js');
const BROWSER_DATA_ROOT = process.env.DATA_DIR
  ? path.join(path.resolve(process.env.DATA_DIR), 'browser-data')
  : path.join(SCRAPER_DIR, 'browser-data');

const TIMEOUT_MS = parseInt(process.env.SCRAPER_TIMEOUT_MS || '180000', 10);

/**
 * Run the bayi.alayatl scraper as a child process.
 * Returns the parsed totals object: { bakiye_toplami, borc_toplami, bayi_alacagi, toplam_bayi_sayisi }
 */
export function runBayiAlayatlScraper(config, { itemId } = {}) {
  return new Promise((resolve, reject) => {
    const phone = (config?.kod || '').trim();
    const password = (config?.sifre || '').trim();
    const loginUrl = (config?.base_url || '').trim() || 'http://bayi.alayatl.com/index.php?giris=true';

    if (!phone || !password) {
      return reject(new Error('Missing phone (kod) or password (sifre)'));
    }

    // Per-item browser-data dir so multiple bayi accounts don't collide
    const browserDir = itemId
      ? path.join(BROWSER_DATA_ROOT, `item-${itemId}`)
      : BROWSER_DATA_ROOT;
    fs.mkdirSync(browserDir, { recursive: true });

    const child = spawn(process.execPath, [SCRAPER_ENTRY], {
      cwd: SCRAPER_DIR,
      env: {
        ...process.env,
        BAYI_PHONE: phone,
        BAYI_PASSWORD: password,
        BAYI_LOGIN_URL: loginUrl,
        HEADLESS: 'true',
        BROWSER_DATA_DIR: browserDir,
      },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write('[scraper] ' + s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write('[scraper:err] ' + s);
    });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Scraper timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error('Failed to spawn scraper: ' + err.message));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const match = stdout.match(/RESULT_JSON=(\{[^\n]*\})/);
      if (match) {
        try {
          return resolve(JSON.parse(match[1]));
        } catch (err) {
          return reject(new Error('Bad JSON from scraper: ' + err.message));
        }
      }
      // Prefer the explicit "[error] ..." line printed by fetch.js
      const allLines = (stdout + '\n' + stderr).split('\n').map(l => l.trim()).filter(Boolean);
      const errLine = allLines.find(l => l.startsWith('[error]'));
      let meaningful;
      if (errLine) {
        meaningful = errLine.replace(/^\[error\]\s*/, '');
      } else {
        // Fallback: last 5 non-empty lines
        meaningful = allLines.slice(-5).join(' | ');
      }
      reject(new Error(`Scraper exited (code ${code}): ${meaningful.slice(0, 500)}`));
    });
  });
}
