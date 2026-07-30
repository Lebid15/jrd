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

// ─── قراءة بنية الصفحة (موجزة، للتشخيص + الأوضاع) ────────────────────────────
async function readPage(page) {
  return page.evaluate(() => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    const isApiSelect = (sel) => {
      const opts = [...sel.options].map((o) => clean(o.textContent).toLowerCase());
      return opts.includes('kapat') && opts.includes('manuel');
    };

    // selects الفلاتر = كل select ليس من نوع API (المشغّل/النوع/غيرها).
    const filterSelects = [...document.querySelectorAll('select')]
      .filter((sel) => !isApiSelect(sel))
      .map((sel, i) => ({
        index: i, id: sel.id || '', name: sel.name || '', value: sel.value,
        options: [...sel.options].map((o) => clean(o.textContent)).slice(0, 60),
      }));

    // عمود الكوبير من صفّ الرأس.
    let kupurCol = -1;
    const headerCells = [];
    const headRow = document.querySelector('table thead tr') || document.querySelector('table tr');
    if (headRow) {
      [...headRow.children].forEach((c, i) => {
        const t = clean(c.textContent);
        headerCells.push(t);
        if (/k[uü]p[uü]r|kpür/i.test(t)) kupurCol = i;
      });
    }

    // عيّنة خيارات مزوّد (من أوّل select API) — لأرى صيغة الأسماء.
    let apiOptionsSample = [];
    const firstApi = [...document.querySelectorAll('select')].find(isApiSelect);
    if (firstApi) apiOptionsSample = [...firstApi.options].map((o) => clean(o.textContent));

    // صفوف الباقات (موجزة): الاسم + الكوبير + الاختيارات الحالية.
    const rows = [];
    for (const tr of document.querySelectorAll('table tr')) {
      const selects = [...tr.querySelectorAll('select')].filter(isApiSelect);
      if (!selects.length) continue;
      const cells = [...tr.children].map((c) => clean(c.textContent));
      const nameCell = cells.find((t) => t && !/^\d/.test(t)) || cells[1] || '';
      let kupur = (kupurCol >= 0 && cells[kupurCol]) ? cells[kupurCol] : '';
      if (!kupur) {
        const nums = cells.filter((t) => /^\d[\d.,]*$/.test(t)).sort((a, b) => parseFloat(b) - parseFloat(a));
        kupur = nums[0] || '';
      }
      rows.push({
        name: nameCell,
        kupur_raw: kupur,
        apiCount: selects.length,
        apiSelected: selects.map((sel) => clean(sel.options[sel.selectedIndex]?.textContent || '')),
      });
    }
    return { url: location.href, filterSelects, headerCells, kupurCol, apiOptionsSample, rowCount: rows.length, rows };
  });
}

// اختيار خيار فلتر بأمان (locator يُعاد معالجته؛ يتحمّل navigation؛ لا يرمي أبداً).
async function selectFilter(page, matchOption) {
  try {
    const metas = await page.$$eval('select', (sels) => sels.map((s, i) => ({
      i, options: [...s.options].map((o) => o.textContent.trim()),
    })));
    for (const m of metas) {
      const optIndex = matchOption(m.options);
      if (optIndex >= 0) {
        try {
          await page.locator('select').nth(m.i).selectOption({ index: optIndex }, { timeout: 8000 });
        } catch { /* قد تُدمَّر البيئة بسبب navigation — نتجاهل */ }
        await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
        await page.waitForTimeout(700);
        return true;
      }
    }
  } catch (e) {
    console.warn('[filter] step skipped:', (e.message || '').split('\n')[0]);
  }
  return false;
}

async function applyFilter(page) {
  if (OPERATOR) {
    await selectFilter(page, (opts) => {
      if (!opts.some((t) => /operator/i.test(t))) return -1;
      return opts.findIndex((t) => t.toLowerCase().includes(OPERATOR.toLowerCase()));
    });
  }
  if (TYPE) {
    await selectFilter(page, (opts) => opts.findIndex((t) =>
      t.includes(`(${TYPE})`) && (!OPERATOR || t.toLowerCase().includes(OPERATOR.toLowerCase()))));
  }
}

// يضبط خانة API واحدة لصفّ محدَّد برقم ربطه — عملية ذرّية داخل الصفحة.
// يُعيد إيجاد الصفّ برقم الربط في كل مرّة (يتحمّل إعادة التحميل وانزياح الفهارس).
// status: set | already | missing | no_slot | row_not_found
async function setOneSlot(page, ref, apiIdx, want, write) {
  return page.evaluate(({ ref, apiIdx, want, write }) => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    const stripPrice = (s) => clean(s.replace(/\s*\([^)]*\)\s*$/, ''));
    const isApi = (sel) => {
      const o = [...sel.options].map((x) => clean(x.textContent).toLowerCase());
      return o.includes('kapat') && o.includes('manuel');
    };
    const norm = (s) => { const m = String(s ?? '').match(/-?\d+/); return m ? m[0] : ''; };

    // ابحث عن الصفّ برقم الربط (أكبر رقم في الصف = الكوبير).
    let row = null, rowName = '';
    for (const tr of document.querySelectorAll('table tr')) {
      const selects = [...tr.querySelectorAll('select')].filter(isApi);
      if (!selects.length) continue;
      const cells = [...tr.children].map((c) => clean(c.textContent));
      const nums = cells.filter((t) => /^\d[\d.,]*$/.test(t)).sort((a, b) => parseFloat(b) - parseFloat(a));
      if (norm(nums[0] || '') === String(ref)) {
        row = tr; rowName = cells.find((t) => t && !/^\d/.test(t)) || ''; break;
      }
    }
    if (!row) return { status: 'row_not_found' };

    const selects = [...row.querySelectorAll('select')].filter(isApi);
    if (apiIdx >= selects.length) return { status: 'no_slot', name: rowName };
    const sel = selects[apiIdx];
    const opts = [...sel.options];
    const idx = want.toLowerCase() === 'kapat'
      ? opts.findIndex((o) => clean(o.textContent).toLowerCase() === 'kapat')
      : opts.findIndex((o) => stripPrice(o.textContent) === want);
    if (idx < 0) return { status: 'missing', name: rowName };
    if (sel.selectedIndex === idx) return { status: 'already', name: rowName };
    if (write) {
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { status: 'set', name: rowName };
  }, { ref, apiIdx, want, write });
}

// تطبيق الخطة تسلسلياً: لكل باقة (برقم ربطها) نضبط API1 ثم API2 ثم API3،
// منتظرين إعادة التحميل بعد كل اختيار. Kapat = نتركها مغلقة (لا نكتب).
// dryrun (write=false): لا يكتب ولا ينتظر — يتحقّق فقط من إيجاد الصفوف والأسماء.
async function applyPlan(page, write) {
  const results = [];
  for (const [ref, wanted] of Object.entries(PLAN)) {
    const rowRes = { ref, name: '', set: [], missing: [], note: '' };
    for (let i = 0; i < wanted.length; i++) {
      const want = wanted[i];
      if (String(want).toLowerCase() === 'kapat') continue; // اتركها مغلقة (Kapat افتراضي)
      const r = await setOneSlot(page, ref, i, want, write);
      if (r.name) rowRes.name = r.name;
      if (r.status === 'set' || r.status === 'already') {
        rowRes.set.push(`API${i + 1}=${want}`);
        if (write && r.status === 'set') {
          // زينت يُعيد التحميل/الحفظ — ننتظر ثم نُعيد التحقّق من بقاء الفلتر.
          await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
          await page.waitForTimeout(500);
        }
      } else if (r.status === 'missing') {
        rowRes.missing.push(want);
        break; // الخانة التالية لا تُفتح إن لم تُضبط هذه (خانات تصاعدية)
      } else if (r.status === 'no_slot') {
        rowRes.note = 'no_more_slots'; break;
      } else if (r.status === 'row_not_found') {
        rowRes.note = 'row_not_found (قد تكون في صفحة أخرى)'; break;
      }
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

    let out;
    if (MODE === 'inspect') {
      // قبل الفلتر: نرى selects الفلاتر في حالتها الأولى. ثم نطبّق الفلتر (بأمان)
      // ونرى الصفوف بعده. كلاهما بلا أي كتابة.
      const before = await readPage(page);
      await applyFilter(page);
      const after = await readPage(page);
      out = { mode: 'inspect', operator: OPERATOR, type: TYPE, before, after };
    } else {
      await applyFilter(page);
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
