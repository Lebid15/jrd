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
const ACTION = (process.env.ROUTE_ACTION || 'route').toLowerCase(); // route | deactivate
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

    // الكوبير = الخلية قبل خليتين من أوّل خلية فيها select API
    // (ترتيب الأعمدة: OpFiy | Küpür | Ç.Şekli | API1...). أدقّ بكثير من
    // "أكبر رقم في الصف" (الذي كان يلتقط OpFiy بالخطأ).
    const rowKupur = (tr) => {
      const kids = [...tr.children];
      const a = kids.findIndex((td) => [...td.querySelectorAll('select')].some(isApiSelect));
      return a >= 2 ? clean(kids[a - 2].textContent) : '';
    };
    const rows = [];
    for (const tr of document.querySelectorAll('table tr')) {
      const selects = [...tr.querySelectorAll('select')].filter(isApiSelect);
      if (!selects.length) continue;
      const cells = [...tr.children].map((c) => clean(c.textContent));
      const nameCell = cells.find((t) => t && !/^\d/.test(t)) || cells[1] || '';
      rows.push({
        name: nameCell,
        kupur_raw: rowKupur(tr),
        apiCount: selects.length,
        apiSelected: selects.map((sel) => clean(sel.options[sel.selectedIndex]?.textContent || '')),
      });
    }
    return { url: location.href, filterSelects, headerCells, kupurCol, apiOptionsSample, rowCount: rows.length, rows };
  });
}

// اختيار من select محدَّد بالاسم/المعرّف، بأمان (لا يرمي، ينتظر التنقّل).
async function trySelect(page, selector, label) {
  try {
    const loc = page.locator(selector).first();
    if (await loc.count() === 0) return false;
    try {
      await loc.selectOption({ label }, { timeout: 8000 });
    } catch {
      // بديل: طابق نصّ الخيار (يحوي label) وأطلق change يدوياً.
      await loc.evaluate((sel, lab) => {
        const i = [...sel.options].findIndex((o) => o.textContent.trim() === lab || o.textContent.includes(lab));
        if (i >= 0) { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      }, label);
    }
    await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(700);
    return true;
  } catch (e) {
    console.warn('[filter]', selector, 'skipped:', (e.message || '').split('\n')[0]);
    return false;
  }
}

async function applyFilter(page) {
  // 1) صفِّ حسب المشغّل أولاً (اسم الحقل الفعلي). لا نحتاج فلتر النوع —
  //    المطابقة برقم الربط (küpür) تكفي لأنه فريد داخل المشغّل.
  if (OPERATOR) await trySelect(page, 'select[name="filitre_operator"]', OPERATOR);
  // 2) ثم اعرض كل الصفوف في صفحة واحدة (تفادي الترقيم عبر 8 صفحات) — آخر إجراء.
  await trySelect(page, '#perPageCount', '10000');
}

// يقرأ صفّاً واحداً برقم ربطه: هل وُجد؟ اسمه، عدد الخانات، وأسماء الخيارات المتاحة.
// الكوبير = الخلية قبل خليتين من أوّل خلية فيها select API.
async function readRow(page, ref) {
  return page.evaluate((ref) => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    const stripPrice = (s) => clean(s.replace(/\s*\([^)]*\)\s*$/, ''));
    const isApi = (sel) => {
      const o = [...sel.options].map((x) => clean(x.textContent).toLowerCase());
      return o.includes('kapat') && o.includes('manuel');
    };
    const norm = (s) => { const m = String(s ?? '').match(/-?\d+/); return m ? m[0] : ''; };
    for (const tr of document.querySelectorAll('table tr')) {
      const kids = [...tr.children];
      const a = kids.findIndex((td) => [...td.querySelectorAll('select')].some(isApi));
      if (a < 2) continue;
      if (norm(clean(kids[a - 2].textContent)) !== String(ref)) continue;
      const sels = [...tr.querySelectorAll('select')].filter(isApi);
      const name = kids.map((k) => clean(k.textContent)).find((t) => t && !/^\d/.test(t)) || '';
      return {
        found: true, name, slotCount: sels.length,
        optionNames: sels.length ? [...sels[0].options].map((o) => stripPrice(o.textContent)) : [],
      };
    }
    return { found: false };
  }, ref);
}

// يضبط خانة API واحدة لصفّ محدَّد برقم ربطه (يُعيد إيجاد الصفّ كل مرّة).
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
    let tr = null;
    for (const row of document.querySelectorAll('table tr')) {
      const kids = [...row.children];
      const a = kids.findIndex((td) => [...td.querySelectorAll('select')].some(isApi));
      if (a < 2) continue;
      if (norm(clean(kids[a - 2].textContent)) === String(ref)) { tr = row; break; }
    }
    if (!tr) return { status: 'row_not_found' };
    const sels = [...tr.querySelectorAll('select')].filter(isApi);
    if (apiIdx >= sels.length) return { status: 'no_slot' };
    const sel = sels[apiIdx];
    const opts = [...sel.options];
    const idx = String(want).toLowerCase() === 'kapat'
      ? opts.findIndex((o) => clean(o.textContent).toLowerCase() === 'kapat')
      : opts.findIndex((o) => stripPrice(o.textContent) === want);
    if (idx < 0) return { status: 'missing' };
    if (sel.selectedIndex === idx) return { status: 'already' };
    if (write) { sel.selectedIndex = idx; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    return { status: 'set' };
  }, { ref, apiIdx, want, write });
}

// تطبيق الخطة: لكل باقة (برقم ربطها) نضغط المزوّدين المتاحين فعلاً كخيارات في
// زينت (نتجاهل الأسماء غير الموجودة) ونوزّعهم على API1/2/3 بالترتيب، والباقي Kapat.
// نضبط كل خانة تسلسلياً منتظرين إعادة التحميل بعد كل كتابة (زينت يحفظ تلقائياً).
async function applyPlan(page, write) {
  const results = [];
  for (const [ref, wanted] of Object.entries(PLAN)) {
    const info = await readRow(page, ref);
    if (!info.found) {
      results.push({ ref, name: '', set: [], missing: [], note: 'row_not_found (تحقّق من المشغّل/رقم الربط)' });
      continue;
    }
    const optSet = new Set(info.optionNames);
    const suppliers = wanted.filter((w) => String(w).toLowerCase() !== 'kapat');
    const missing = suppliers.filter((w) => !optSet.has(w));
    const avail = suppliers.filter((w) => optSet.has(w));
    const slots = Math.min(4, info.slotCount);
    // هدف كل خانة: أوّل 3 من المتاح، ثم Kapat لبقيّة الخانات (يمسح القديم).
    const targets = [];
    for (let i = 0; i < slots; i++) targets.push(i < Math.min(3, avail.length) ? avail[i] : 'Kapat');

    const rowRes = { ref, name: info.name, set: [], missing, note: '' };
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const r = await setOneSlot(page, ref, i, t, write);
      if (r.status === 'row_not_found') { rowRes.note = 'row_disappeared'; break; }
      if ((r.status === 'set' || r.status === 'already') && String(t).toLowerCase() !== 'kapat') {
        rowRes.set.push(`API${i + 1}=${t}`);
      }
      if (write && r.status === 'set') {
        await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
        await page.waitForTimeout(400);
      }
    }
    results.push(rowRes);
  }
  return results;
}

// ─── تعطيل الباقات غير المتوفّرة (Pasif Et) ─────────────────────────────────
// يحدّد صفّاً برقم ربطه ويضع علامة على checkbox الخاص به. status: checked |
// already | no_checkbox | row_not_found. الكوبير = نفس منطق readRow.
async function checkRow(page, ref, write) {
  return page.evaluate(({ ref, write }) => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    const isApi = (sel) => {
      const o = [...sel.options].map((x) => clean(x.textContent).toLowerCase());
      return o.includes('kapat') && o.includes('manuel');
    };
    const norm = (s) => { const m = String(s ?? '').match(/-?\d+/); return m ? m[0] : ''; };
    let tr = null;
    for (const row of document.querySelectorAll('table tr')) {
      const kids = [...row.children];
      const a = kids.findIndex((td) => [...td.querySelectorAll('select')].some(isApi));
      if (a < 2) continue;
      if (norm(clean(kids[a - 2].textContent)) === String(ref)) { tr = row; break; }
    }
    if (!tr) return { status: 'row_not_found' };
    const name = [...tr.children].map((k) => clean(k.textContent)).find((t) => t && !/^\d/.test(t)) || '';
    const box = tr.querySelector('input[type="checkbox"]');
    if (!box) return { status: 'no_checkbox', name };
    if (box.checked) return { status: 'already', name };
    if (write) {
      box.checked = true;
      box.dispatchEvent(new Event('click', { bubbles: true }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { status: 'checked', name };
  }, { ref, write });
}

// يبحث عن زرّ «Pasif Et» (يظهر فقط بعد التحديد) ويضغطه.
async function clickPasifEt(page) {
  return page.evaluate(() => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    const re = /pasif\s*et/i;
    const cands = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
    const el = cands.find((c) => {
      const txt = clean(c.tagName === 'INPUT' ? c.value : c.textContent);
      const style = window.getComputedStyle(c);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && c.offsetParent !== null;
      return re.test(txt) && visible;
    });
    if (!el) return { clicked: false };
    el.click();
    return { clicked: true, label: clean(el.tagName === 'INPUT' ? el.value : el.textContent) };
  });
}

// تدفّق التعطيل: يطابق كل رقم ربط في PLAN، يضع علامة على checkbox،
// وفي وضع apply يضغط «Pasif Et» مرّة واحدة بعد تحديد الكل.
async function applyDeactivate(page, write) {
  const refs = Object.keys(PLAN);
  const results = [];
  let checked = 0;
  for (const ref of refs) {
    const r = await checkRow(page, ref, write);
    if (r.status === 'checked' || r.status === 'already') checked++;
    results.push({ ref, name: r.name || '', status: r.status });
  }
  let pasif = { clicked: false };
  if (write && checked > 0) {
    pasif = await clickPasifEt(page);
    if (pasif.clicked) {
      await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
  return { planned: refs.length, checked, pasif, results };
}

async function main() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  console.log(`[browser] launching at ${USER_DATA_DIR} (mode=${MODE}, action=${ACTION})`);
  let context, page, exitCode = 0;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: HEADLESS,
      viewport: { width: 1400, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(NAV_TIMEOUT);
    // «Pasif Et» قد يطلق نافذة تأكيد (confirm) — نقبلها تلقائياً.
    page.on('dialog', (d) => { d.accept().catch(() => {}); });

    await ensureLoggedIn(page);

    let out;
    if (MODE === 'inspect') {
      // قبل الفلتر: نرى selects الفلاتر في حالتها الأولى. ثم نطبّق الفلتر (بأمان)
      // ونرى الصفوف بعده. كلاهما بلا أي كتابة.
      const before = await readPage(page);
      await applyFilter(page);
      const after = await readPage(page);
      out = { mode: 'inspect', operator: OPERATOR, type: TYPE, before, after };
    } else if (ACTION === 'deactivate') {
      // تعطيل الباقات غير المتوفّرة لدى أي مزوّد (Pasif Et).
      await applyFilter(page);
      const res = await applyDeactivate(page, MODE === 'apply');
      out = { mode: MODE, action: 'deactivate', operator: OPERATOR, type: TYPE, ...res };
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
