import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ════════════════════════════════════════════════════════════════════════════
// روبوت توجيه الباقات (Kontör tarife yönlendirme) على لوحة زينت.
// يعيد استخدام نفس دخول روبوت الديون (رقم الجوال + كلمة السر + PIN).
// الوجهة: {أصل BAYI_LOGIN_URL}/Kontor/admin_tarifeler.php
//
// أوضاع (ROUTE_MODE):
//   inspect → يدخل، يطبّق الفلتر، ويُرجع بنية الصفحة (فلاتر/أعمدة/صفوف/خيارات)
//             دون أي تغيير. لضبط المُحدِّدات على الموقع الحقيقي.
//   dryrun  → يطابق الخطة مع صفوف الصفحة ويُرجع ما «سيفعله» دون كتابة.
//   apply   → يكتب فعلاً (يختار المزوّدين؛ زينت يحفظ تلقائياً عند الاختيار).
//
// المدخلات عبر البيئة:
//   ROUTE_OPERATOR = Turkcell | Vodafone | Avea
//   ROUTE_TYPE     = Ses | Tam | 3gCep | Yds | 3gPc | ...
//   ROUTE_PLAN     = JSON: { "<رقم الربط>": ["اسم1","اسم2","اسم3"], ... }
//                    (الأسماء بترتيب API1..N؛ "Kapat" لإغلاق الخانة)
// ════════════════════════════════════════════════════════════════════════════

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = process.env.BROWSER_DATA_DIR
  ? path.resolve(process.env.BROWSER_DATA_DIR)
  : path.join(__dirname, '..', 'browser-data');

const LOGIN_URL = process.env.BAYI_LOGIN_URL || 'http://bayi.alayatl.com/index.php?giris=true';
const ADMIN_PATH = '/Kontor/admin_tarifeler.php';
const ADMIN_URL = new URL(ADMIN_PATH, LOGIN_URL).toString();

const PHONE = process.env.BAYI_PHONE;
const PASSWORD = process.env.BAYI_PASSWORD;
const PIN = process.env.BAYI_PIN || '111111';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() === 'true';
const NAV_TIMEOUT = parseInt(process.env.NAV_TIMEOUT_MS || '30000', 10);

const MODE = (process.env.ROUTE_MODE || 'inspect').toLowerCase();
const OPERATOR = (process.env.ROUTE_OPERATOR || '').trim();
const TYPE = (process.env.ROUTE_TYPE || '').trim();
let PLAN = {};
try { PLAN = JSON.parse(process.env.ROUTE_PLAN || '{}'); } catch { PLAN = {}; }

if (!PHONE || !PASSWORD) {
  console.error('[error] Missing BAYI_PHONE or BAYI_PASSWORD');
  process.exit(1);
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// رقم الربط الموحّد: الجزء الصحيح فقط ("24583.00" → "24583").
const refKey = (s) => { const m = String(s ?? '').match(/-?\d+/); return m ? m[0] : ''; };

// ─── الدخول (مطابق لروبوت الديون) ───────────────────────────────────────────
async function isOnLoginPage(page) { return (await page.locator('#kullanici_adi').count()) > 0; }
async function isOnPinPage(page) { return (await page.locator('#parola').count()) > 0; }

async function fillLoginForm(page) {
  console.log('[login] filling phone + password ...');
  await page.fill('#kullanici_adi', PHONE);
  await page.fill('#password', PASSWORD);
  await page.click('#girisbutton');
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT });
  await page.waitForTimeout(800);
}

async function enterPin(page) {
  console.log('[login] entering PIN ...');
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
  console.log('[nav] opening admin_tarifeler ...');
  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  if (await isOnLoginPage(page)) await fillLoginForm(page);
  if (await isOnPinPage(page)) await enterPin(page);
  if (!page.url().includes('admin_tarifeler')) {
    await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  }
  if (await isOnLoginPage(page)) {
    throw new Error('Still on login page — credentials may be wrong.');
  }
}

// ─── قراءة بنية الصفحة (تُستخدم في كل الأوضاع) ───────────────────────────────
// نُرجع: قائمة selects الفلاتر، فهرس عمود الكوبير، وصفوف الباقات مع API selects.
async function readPage(page) {
  return page.evaluate(() => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

    // كل selects في الصفحة مع خياراتها (للتشخيص + الفلاتر).
    const allSelects = [...document.querySelectorAll('select')].map((sel, i) => ({
      index: i,
      id: sel.id || '',
      name: sel.name || '',
      value: sel.value,
      options: [...sel.options].map((o) => clean(o.textContent)),
    }));

    // عمود الكوبير: نبحث عن خلية رأس نصّها يحوي küpür/kpür.
    let kupurCol = -1;
    const headerCells = [];
    const headRow = document.querySelector('table thead tr') ||
                    document.querySelector('table tr');
    if (headRow) {
      [...headRow.children].forEach((c, i) => {
        const t = clean(c.textContent);
        headerCells.push(t);
        if (/k[uü]p[uü]r|kpür/i.test(t)) kupurCol = i;
      });
    }

    // صفوف الباقات: أي <tr> فيه select routing (يحوي خيار Kapat + Manuel).
    const rows = [];
    const isApiSelect = (sel) => {
      const opts = [...sel.options].map((o) => clean(o.textContent).toLowerCase());
      return opts.includes('kapat') && opts.includes('manuel');
    };
    for (const tr of document.querySelectorAll('table tr')) {
      const selects = [...tr.querySelectorAll('select')].filter(isApiSelect);
      if (!selects.length) continue;
      const cells = [...tr.children].map((c) => clean(c.textContent));
      // اسم الباقة: أوّل خلية غير فارغة غير رقمية.
      const nameCell = cells.find((t) => t && !/^\d/.test(t)) || cells[1] || '';
      // الكوبير: من عمود الرأس إن عُرف، وإلّا أوّل رقم كبير في الصف.
      let kupur = '';
      if (kupurCol >= 0 && cells[kupurCol]) kupur = cells[kupurCol];
      if (!kupur) {
        const nums = cells.map((t) => (t.match(/^\d[\d.,]*$/) ? t : null)).filter(Boolean);
        kupur = nums.sort((a, b) => parseFloat(b) - parseFloat(a))[0] || '';
      }
      rows.push({
        name: nameCell,
        kupur_raw: kupur,
        api: selects.map((sel) => ({
          value: sel.value,
          selectedText: clean(sel.options[sel.selectedIndex]?.textContent || ''),
          options: [...sel.options].map((o) => clean(o.textContent)),
        })),
      });
    }
    return { url: location.href, allSelects, headerCells, kupurCol, rowCount: rows.length, rows };
  });
}

// اختيار خيار في <select> عبر رقمه الفهرسي (index) بأمان + إطلاق change.
async function selectApi(page, selectHandle, optionIndex) {
  await selectHandle.evaluate((sel, idx) => {
    sel.selectedIndex = idx;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, optionIndex);
}

async function applyFilter(page) {
  // نحاول اختيار المشغّل + النوع من selects الفلاتر (heuristic؛ inspect يؤكّدها).
  if (!OPERATOR && !TYPE) return;
  const selects = await page.locator('select').elementHandles();
  for (const h of selects) {
    const opts = await h.evaluate((sel) => [...sel.options].map((o) => o.textContent.trim()));
    // فلتر المشغّل: يحوي خيار "Operator" (placeholder).
    if (OPERATOR && opts.some((t) => /operator/i.test(t))) {
      const idx = opts.findIndex((t) => t.toLowerCase().includes(OPERATOR.toLowerCase()));
      if (idx >= 0) { await selectApi(page, h, idx); await page.waitForTimeout(600); }
    }
    // فلتر النوع: خيار يحوي (TYPE) واسم المشغّل.
    if (TYPE && opts.some((t) => t.includes(`(${TYPE})`))) {
      const idx = opts.findIndex((t) => t.includes(`(${TYPE})`) &&
        (!OPERATOR || t.toLowerCase().includes(OPERATOR.toLowerCase())));
      if (idx >= 0) { await selectApi(page, h, idx); await page.waitForTimeout(800); }
    }
  }
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
  await page.waitForTimeout(800);
}

// تطبيق الخطة على الصفوف (dryrun: بلا كتابة؛ apply: يكتب).
async function applyPlan(page, write) {
  const results = [];
  const trHandles = await page.locator('table tr').elementHandles();
  for (const tr of trHandles) {
    const info = await tr.evaluate((row) => {
      const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
      const isApi = (sel) => {
        const o = [...sel.options].map((x) => clean(x.textContent).toLowerCase());
        return o.includes('kapat') && o.includes('manuel');
      };
      const selects = [...row.querySelectorAll('select')].filter(isApi);
      if (!selects.length) return null;
      const cells = [...row.children].map((c) => clean(c.textContent));
      let kupur = '';
      const nums = cells.filter((t) => /^\d[\d.,]*$/.test(t)).sort((a, b) => parseFloat(b) - parseFloat(a));
      // الكوبير عادةً أكبر رقم في الصف (OpFiy أصغر، Ç.Şekli=0).
      kupur = nums[0] || '';
      const name = cells.find((t) => t && !/^\d/.test(t)) || '';
      return { name, kupur, apiCount: selects.length };
    });
    if (!info) continue;

    const ref = (info.kupur.match(/-?\d+/) || [''])[0];
    const wanted = PLAN[ref];
    if (!wanted) { continue; }

    // لكل خانة API نحدّد الخيار المطلوب.
    const apiSelects = await tr.$$('select');
    const apiOnly = [];
    for (const h of apiSelects) {
      const isApi = await h.evaluate((sel) => {
        const o = [...sel.options].map((x) => x.textContent.trim().toLowerCase());
        return o.includes('kapat') && o.includes('manuel');
      });
      if (isApi) apiOnly.push(h);
    }

    const rowRes = { ref, name: info.name, set: [], missing: [] };
    for (let i = 0; i < wanted.length && i < apiOnly.length; i++) {
      const target = wanted[i];
      const h = apiOnly[i];
      const optionIndex = await h.evaluate((sel, want) => {
        const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
        const stripPrice = (s) => clean(s.replace(/\s*\([^)]*\)\s*$/, ''));
        const opts = [...sel.options];
        // Kapat → تطابق تام
        if (want.toLowerCase() === 'kapat') {
          return opts.findIndex((o) => clean(o.textContent).toLowerCase() === 'kapat');
        }
        return opts.findIndex((o) => stripPrice(o.textContent) === want);
      }, target);

      if (optionIndex < 0) { rowRes.missing.push(target); continue; }
      if (write) {
        await h.evaluate((sel, idx) => {
          sel.selectedIndex = idx;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, optionIndex);
        await page.waitForTimeout(250); // زينت يحفظ تلقائياً — نمهله
      }
      rowRes.set.push(`API${i + 1}=${target}`);
    }
    results.push(rowRes);
  }
  return results;
}

async function main() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  console.log(`[browser] launching at ${USER_DATA_DIR} (mode=${MODE})`);
  let context, page, exitCode = 0;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: HEADLESS,
      viewport: { width: 1400, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(NAV_TIMEOUT);

    await ensureLoggedIn(page);
    await applyFilter(page);

    let out;
    if (MODE === 'inspect') {
      out = { mode: 'inspect', ...(await readPage(page)) };
    } else {
      const results = await applyPlan(page, MODE === 'apply');
      out = {
        mode: MODE,
        operator: OPERATOR, type: TYPE,
        planned: Object.keys(PLAN).length,
        matched: results.length,
        applied: results.filter((r) => r.set.length).length,
        results,
      };
    }
    console.log('\nRESULT_JSON=' + JSON.stringify(out));
  } catch (err) {
    console.error('[error]', err?.message ? err.message.split('\n')[0] : String(err));
    try {
      if (page) {
        await page.screenshot({ path: path.join(__dirname, '..', 'debug-route.png'), fullPage: true });
        console.error('[error] screenshot saved to debug-route.png');
      }
    } catch {}
    exitCode = 1;
  } finally {
    try { if (context) await context.close(); } catch {}
  }
  process.exit(exitCode);
}

main();
