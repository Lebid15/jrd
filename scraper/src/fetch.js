import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = process.env.BROWSER_DATA_DIR
  ? path.resolve(process.env.BROWSER_DATA_DIR)
  : path.join(__dirname, '..', 'browser-data');

const LOGIN_URL = process.env.BAYI_LOGIN_URL || 'http://bayi.alayatl.com/index.php?giris=true';
const TARGET_PATH = '/Ayarlar/bayiler.php?alt_bayiler=goster';
const TARGET_URL = new URL(TARGET_PATH, LOGIN_URL).toString();

const PHONE = process.env.BAYI_PHONE;
const PASSWORD = process.env.BAYI_PASSWORD;
const PIN = process.env.BAYI_PIN || '111111';
const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const NAV_TIMEOUT = parseInt(process.env.NAV_TIMEOUT_MS || '30000', 10);

if (!PHONE || !PASSWORD) {
  console.error('Missing BAYI_PHONE or BAYI_PASSWORD in .env');
  process.exit(1);
}

// Turkish number ("202639,7888") -> 202639.7888
function parseTrNumber(str) {
  if (str == null) return null;
  const cleaned = String(str).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function isOnLoginPage(page) {
  return (await page.locator('#kullanici_adi').count()) > 0;
}

async function isOnPinPage(page) {
  return (await page.locator('#parola').count()) > 0;
}

async function fillLoginForm(page) {
  console.log('[login] filling phone + password ...');
  await page.fill('#kullanici_adi', PHONE);
  await page.fill('#password', PASSWORD);
  await page.click('#girisbutton');
  // wait for either pin page or target page
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT });
  await page.waitForTimeout(800);
}

async function enterPin(page) {
  console.log('[login] entering PIN on randomized keypad ...');
  // wait until keypad is rendered
  await page.waitForSelector('input[name="number"]', { timeout: NAV_TIMEOUT });

  for (const digit of PIN.split('')) {
    const selector = `input[name="number"][value="${digit}"]`;
    await page.waitForSelector(selector, { timeout: 5000 });
    await page.click(selector);
    await page.waitForTimeout(120);
  }

  await page.click('#_G');
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT });
  await page.waitForTimeout(800);
}

async function ensureLoggedIn(page) {
  // Strategy: try the target URL first. If we get redirected to login -> log in.
  console.log('[nav] opening target page ...');
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

  if (await isOnLoginPage(page)) {
    await fillLoginForm(page);
  }

  if (await isOnPinPage(page)) {
    await enterPin(page);
  }

  // After login, we may land on dashboard, not target -> navigate again
  if (!page.url().includes('bayiler.php')) {
    console.log('[nav] re-navigating to target after login ...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  }

  if (await isOnLoginPage(page)) {
    throw new Error('Still on login page after attempting login — credentials may be wrong.');
  }
}

async function extractTotals(page) {
  // Get the full text of the summary row (the TD with colspan=16 holds all 4 totals).
  // We use a regex on the page text to remain robust even if markup changes.
  const text = await page.evaluate(() => document.body.innerText);

  const grab = (label) => {
    // Matches "Label: 12.345,67 TL" or with negative sign / spaces / nbsp
    const re = new RegExp(label + '\\s*[:：]?\\s*(-?[\\d.,]+)', 'i');
    const m = text.match(re);
    return m ? m[1] : null;
  };

  return {
    bakiye_toplami: parseTrNumber(grab('Bakiye Toplamı')),
    borc_toplami: parseTrNumber(grab('Borc Toplamı')),
    bayi_alacagi: parseTrNumber(grab('Bayi Alacağı')),
    toplam_bayi_sayisi: parseInt((grab('Toplam Bayi Sayısı') || '0').replace(/\D/g, ''), 10) || null,
  };
}

async function main() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  console.log(`[browser] launching persistent context at ${USER_DATA_DIR}`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(NAV_TIMEOUT);

  let exitCode = 0;
  try {
    await ensureLoggedIn(page);
    const totals = await extractTotals(page);

    console.log('\n=== Bayiler Totals ===');
    console.log(JSON.stringify(totals, null, 2));

    // Output a final JSON line that can be captured by the backend later
    console.log('\nRESULT_JSON=' + JSON.stringify(totals));

    if (totals.bayi_alacagi === null) {
      console.warn('[warn] could not parse Bayi Alacağı — saving debug screenshot');
      await page.screenshot({ path: path.join(__dirname, '..', 'debug-parse.png'), fullPage: true });
      exitCode = 2;
    }
  } catch (err) {
    console.error('[error]', err.message);
    try {
      await page.screenshot({ path: path.join(__dirname, '..', 'debug-error.png'), fullPage: true });
      console.error('[error] screenshot saved to debug-error.png');
    } catch {}
    exitCode = 1;
  } finally {
    await context.close();
  }

  process.exit(exitCode);
}

main();
