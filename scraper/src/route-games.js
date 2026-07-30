import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ════════════════════════════════════════════════════════════════════════════
// روبوت توجيه الألعاب على لوحة زينت: OyunPin/admin_allPinList.php.
// خانتا توجيه لكل منتج: Api 1 و Api 2 (آخر قائمتين في الصف؛ الأولى «Gönderilebilir»
// عرضٌ للأساسي). نطابق كل صفّ **برقم منتج الافتراضي** (عمود id مثل 263).
// أوضاع: inspect (يُرجع البنية) | dryrun (بلا كتابة) | apply (يكتب؛ زينت يحفظ تلقائياً).
// المدخلات: ROUTE_MODE, ROUTE_PLAN = { '<رقم المنتج>': ['اسم1','اسم2'] } (Kapat=إغلاق).
// ════════════════════════════════════════════════════════════════════════════

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = process.env.BROWSER_DATA_DIR
  ? path.resolve(process.env.BROWSER_DATA_DIR)
  : path.join(__dirname, '..', 'browser-data');

const LOGIN_URL = process.env.BAYI_LOGIN_URL || 'http://bayi.alayatl.com/index.php?giris=true';
const ADMIN_PATH = '/OyunPin/admin_allPinList.php';
const ADMIN_URL = new URL(ADMIN_PATH, LOGIN_URL).toString();

const PHONE = process.env.BAYI_PHONE;
const PASSWORD = process.env.BAYI_PASSWORD;
const PIN = process.env.BAYI_PIN || '111111';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() === 'true';
const NAV_TIMEOUT = parseInt(process.env.NAV_TIMEOUT_MS || '30000', 10);

const MODE = (process.env.ROUTE_MODE || 'inspect').toLowerCase();
let PLAN = {};
try { PLAN = JSON.parse(process.env.ROUTE_PLAN || '{}'); } catch { PLAN = {}; }

if (!PHONE || !PASSWORD) { console.error('[error] Missing BAYI_PHONE or BAYI_PASSWORD'); process.exit(1); }

// ─── الدخول (مطابق لروبوت الديون/الكونتور) ───────────────────────────────────
async function isOnLoginPage(page) { return (await page.locator('#kullanici_adi').count()) > 0; }
async function isOnPinPage(page) { return (await page.locator('#parola').count()) > 0; }
async function fillLoginForm(page) {
  await page.fill('#kullanici_adi', PHONE);
  await page.fill('#password', PASSWORD);
  await page.click('#girisbutton');
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT });
  await page.waitForTimeout(800);
}
async function enterPin(page) {
  await page.waitForSelector('input[name="number"]', { timeout: NAV_TIMEOUT });
  for (const digit of PIN.split('')) {
    const sel = `input[name="number"][value="${digit}"]`;
    await page.waitForSelector(sel, { timeout: 5000 });
    await page.click(sel);
    await page.waitForTimeout(120);
  }
  await page.click('#_G');
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT });
  await page.waitForTimeout(800);
}
async function ensureLoggedIn(page) {
  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  if (await isOnLoginPage(page)) await fillLoginForm(page);
  if (await isOnPinPage(page)) await enterPin(page);
  if (!page.url().includes('admin_allPinList')) {
    await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  }
  if (await isOnLoginPage(page)) throw new Error('Still on login page — credentials may be wrong.');
}

// يحاول عرض كل الصفوف (لو الجدول DataTable له عنصر «عدد الصفوف»).
async function showAllRows(page) {
  try {
    await page.evaluate(() => {
      const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
      for (const sel of document.querySelectorAll('select')) {
        const opts = [...sel.options].map((o) => clean(o.textContent));
        const allNum = opts.length >= 2 && opts.every((o) => /^\d+$/.test(o) || /all|tüm|hepsi/i.test(o));
        if (allNum) {
          let best = -1, bestVal = 0;
          opts.forEach((o, i) => { if (/all|tüm|hepsi/i.test(o)) { best = i; bestVal = 1e9; } const n = parseInt(o, 10); if (!isNaN(n) && n > bestVal) { bestVal = n; best = i; } });
          if (best >= 0) { sel.selectedIndex = best; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      }
    });
    await page.waitForTimeout(900);
  } catch { /* تجاهل */ }
}

async function readPage(page) {
  return page.evaluate(() => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    // قائمة توجيه = تحوي خياراً فيه «kapal» أو «alternatif» (Alternatif Kapalı).
    const isRouting = (sel) => [...sel.options].some((o) => { const t = clean(o.textContent).toLowerCase(); return t.includes('kapal') || t.includes('alternatif'); });
    const filterSelects = [...document.querySelectorAll('select')].filter((s) => !isRouting(s))
      .map((s, i) => ({ index: i, id: s.id || '', name: s.name || '', value: s.value, options: [...s.options].map((o) => clean(o.textContent)).slice(0, 40) }));
    let sampleOptions = [];
    const firstR = [...document.querySelectorAll('select')].find(isRouting);
    if (firstR) sampleOptions = [...firstR.options].map((o) => clean(o.textContent));
    const rows = [];
    for (const tr of document.querySelectorAll('table tr')) {
      const sels = [...tr.querySelectorAll('select')].filter(isRouting);
      if (!sels.length) continue;
      const cells = [...tr.children].map((c) => clean(c.textContent));
      const idCell = cells.find((t) => /^\d+$/.test(t)) || '';
      const name = cells.find((t) => t && !/^[\d.,\s]+$/.test(t)) || '';
      rows.push({ id: idCell, name, selectCount: sels.length, selected: sels.map((s) => clean(s.options[s.selectedIndex]?.textContent || '')) });
    }
    return { url: location.href, filterSelects, sampleOptions, rowCount: rows.length, rows: rows.slice(0, 12) };
  });
}

// يضبط خانة (0=Api1, 1=Api2) لصفّ رقمه id. status: set|already|missing|no_slot|row_not_found
async function setSlot(page, id, slotIdx, want, write) {
  return page.evaluate(({ id, slotIdx, want, write }) => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    const stripPrice = (s) => clean(s.replace(/\s*[-–]\s*[\d.,]+\s*$/, '').replace(/\s*\([^)]*\)\s*$/, ''));
    const isRouting = (sel) => [...sel.options].some((o) => { const t = clean(o.textContent).toLowerCase(); return t.includes('kapal') || t.includes('alternatif'); });
    let tr = null;
    for (const row of document.querySelectorAll('table tr')) {
      const sels = [...row.querySelectorAll('select')].filter(isRouting);
      if (!sels.length) continue;
      const cells = [...row.children].map((c) => clean(c.textContent));
      if (cells.some((t) => t === String(id))) { tr = row; break; }
    }
    if (!tr) return { status: 'row_not_found' };
    const sels = [...tr.querySelectorAll('select')].filter(isRouting);
    const api = sels.slice(-2); // خانتا التوجيه = آخر قائمتين (الأولى Gönderilebilir عرض)
    if (slotIdx >= api.length) return { status: 'no_slot' };
    const sel = api[slotIdx];
    const opts = [...sel.options];
    const closed = (o) => { const t = clean(o.textContent).toLowerCase(); return t.includes('kapal') || t.includes('alternatif'); };
    const idx = String(want).toLowerCase() === 'kapat'
      ? opts.findIndex(closed)
      : opts.findIndex((o) => stripPrice(o.textContent) === want);
    if (idx < 0) return { status: 'missing' };
    if (sel.selectedIndex === idx) return { status: 'already' };
    if (write) { sel.selectedIndex = idx; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    return { status: 'set' };
  }, { id, slotIdx, want, write });
}

async function applyPlan(page, write) {
  const results = [];
  for (const [id, wanted] of Object.entries(PLAN)) {
    const rowRes = { ref: id, set: [], missing: [], note: '' };
    for (let i = 0; i < Math.min(2, wanted.length); i++) {
      const want = wanted[i];
      if (String(want).toLowerCase() === 'kapat') continue;
      const r = await setSlot(page, id, i, want, write);
      if (r.status === 'row_not_found') { rowRes.note = 'row_not_found'; break; }
      if (r.status === 'set' || r.status === 'already') rowRes.set.push(`Api${i + 1}=${want}`);
      else if (r.status === 'missing') rowRes.missing.push(want);
      if (write && r.status === 'set') {
        await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
        await page.waitForTimeout(400);
      }
    }
    results.push(rowRes);
  }
  return results;
}

async function main() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  console.log(`[browser] launching at ${USER_DATA_DIR} (games mode=${MODE})`);
  let context, page, exitCode = 0;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: HEADLESS, viewport: { width: 1400, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(NAV_TIMEOUT);
    await ensureLoggedIn(page);
    await showAllRows(page);

    let out;
    if (MODE === 'inspect') {
      out = { mode: 'inspect', ...(await readPage(page)) };
    } else {
      const results = await applyPlan(page, MODE === 'apply');
      out = {
        mode: MODE, planned: Object.keys(PLAN).length,
        matched: results.filter((r) => r.set.length || r.missing.length).length,
        applied: results.filter((r) => r.set.length).length, results,
      };
    }
    console.log('\nRESULT_JSON=' + JSON.stringify(out));
  } catch (err) {
    console.error('[error]', err?.message ? err.message.split('\n')[0] : String(err));
    try { if (page) { await page.screenshot({ path: path.join(__dirname, '..', 'debug-games.png'), fullPage: true }); } } catch {}
    exitCode = 1;
  } finally {
    try { if (context) await context.close(); } catch {}
  }
  process.exit(exitCode);
}

main();
