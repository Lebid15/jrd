/**
 * Spike — البند 3.5 / المرحلة 1 (تشخيصي)
 *
 * نسخة محسَّنة تكتشف selectors تلقائياً وتعطي معلومات DOM واضحة
 * عند الفشل. الهدف: "تنجح أو تُخبرنا بدقّة لماذا فشلت".
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGET_CONTACT = (process.env.TARGET_CONTACT || 'KUVEYT TURK').trim();
const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const PAIRING_TIMEOUT_SEC = parseInt(process.env.PAIRING_TIMEOUT_SEC || '300', 10);
const NAV_TIMEOUT = parseInt(process.env.NAV_TIMEOUT_MS || '45000', 10);
const USER_DATA_DIR = process.env.BROWSER_DATA_DIR
  ? path.resolve(process.env.BROWSER_DATA_DIR)
  : path.join(__dirname, '..', 'browser-data');

const MESSAGES_URL = 'https://messages.google.com/web/conversations';

// مرشّحات selectors (نجرّبها بالترتيب حتى ينجح أحدها)
const LIST_SHELL_CANDIDATES = [
  'mws-conversations-list',
  'mw-conversations-list',
  'mws-conversation-list',
  'mw-conversation-list',
];

const LIST_ITEM_CANDIDATES = [
  'mws-conversation-list-item',
  'mw-conversation-list-item',
  'mws-conversation-item',
  'mw-conversation-item',
  'a.list-item',
  '[data-e2e-conversation-list-item]',
];

const ITEM_NAME_CANDIDATES = [
  '.name',
  '.text-content .name',
  'h3',
  '[data-e2e-conversation-name]',
];

const MESSAGE_WRAPPER_CANDIDATES = [
  'mws-message-wrapper',
  'mw-message-wrapper',
  'mws-incoming-message',
  '[data-e2e-message-wrapper]',
];

const MESSAGE_TEXT_CANDIDATES = [
  'mws-text-message-part',
  'mw-text-message-part',
  '.text-msg-content',
  '[data-e2e-message-text]',
];

function log(tag, ...rest) {
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, ...rest);
}

/** انتظر حتى يظهر "أحد" المرشّحات وأرجعه (أو null عند timeout). */
async function waitForAnySelector(page, selectors, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastTickLog = 0;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) {
        log(label, `selector="${sel}" count=${count}`);
        return { selector: sel, count };
      }
    }
    if (Date.now() - lastTickLog > 8000) {
      lastTickLog = Date.now();
      log(label, `ما زال ينتظر ... (selectors جُرّبت: ${selectors.length})`);
    }
    await page.waitForTimeout(700);
  }
  return null;
}

/** dump diagnostic لكل custom elements (mw-* / mws-*) الظاهرة في الصفحة. */
async function dumpCustomTags(page) {
  return await page.evaluate(() => {
    const counts = {};
    document.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag.startsWith('mw-') || tag.startsWith('mws-')) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
  });
}

/** يحاول قراءة نصّ الاسم من عنصر محادثة عبر عدّة candidates. */
async function getItemName(itemLocator) {
  for (const sel of ITEM_NAME_CANDIDATES) {
    const loc = itemLocator.locator(sel).first();
    if ((await loc.count()) > 0) {
      const t = (await loc.innerText().catch(() => '')).trim();
      if (t) return t;
    }
  }
  const full = (await itemLocator.innerText().catch(() => '')).trim();
  return full.split('\n')[0] || '';
}

async function findConversation(page, itemSelector, contactName) {
  const items = page.locator(itemSelector);
  const total = await items.count();
  log('list', `إجمالي عناصر المحادثات: ${total}`);

  for (let i = 0; i < total; i++) {
    const item = items.nth(i);
    const name = await getItemName(item);
    if (name && name.toLowerCase().includes(contactName.toLowerCase())) {
      log('list', `تطابق عند index=${i}: "${name}"`);
      return item;
    }
  }
  return null;
}

async function extractLastMessage(page) {
  const wrapperHit = await waitForAnySelector(
    page,
    MESSAGE_WRAPPER_CANDIDATES,
    NAV_TIMEOUT,
    'msg-wait',
  );
  if (!wrapperHit) {
    return { error: 'no_wrapper_selector_matched', wrappers_count: 0 };
  }

  return await page.evaluate(
    ({ wrapperSel, textSels }) => {
      const out = {
        wrapper_selector: wrapperSel,
        wrappers_count: 0,
        last_text: null,
        last_direction: null,
        last_timestamp: null,
        last_outer_html_preview: null,
      };

      const wrappers = Array.from(document.querySelectorAll(wrapperSel));
      out.wrappers_count = wrappers.length;
      if (wrappers.length === 0) return out;

      const last = wrappers[wrappers.length - 1];
      const html = last.outerHTML || '';

      if (/\bincoming\b/.test(html)) out.last_direction = 'incoming';
      else if (/\boutgoing\b/.test(html)) out.last_direction = 'outgoing';

      let text = '';
      for (const sel of textSels) {
        const el = last.querySelector(sel);
        if (el) {
          text = (el.innerText || '').trim();
          if (text) break;
        }
      }
      if (!text) text = (last.innerText || '').trim();
      out.last_text = text;

      const tsEl =
        last.querySelector('mws-relative-timestamp') ||
        last.querySelector('mw-relative-timestamp') ||
        last.querySelector('[data-e2e-message-timestamp]') ||
        last.querySelector('time');
      if (tsEl) {
        out.last_timestamp =
          tsEl.getAttribute('datetime') ||
          tsEl.getAttribute('title') ||
          (tsEl.innerText || '').trim() ||
          null;
      }

      out.last_outer_html_preview = html.slice(0, 1500);
      return out;
    },
    { wrapperSel: wrapperHit.selector, textSels: MESSAGE_TEXT_CANDIDATES },
  );
}

async function main() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  log('boot', `persistent context dir: ${USER_DATA_DIR}`);
  log('boot', `target contact       : "${TARGET_CONTACT}"`);
  log('boot', `headless             : ${HEADLESS}`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(NAV_TIMEOUT);

  let exitCode = 0;
  try {
    log('nav', `goto ${MESSAGES_URL}`);
    await page.goto(MESSAGES_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    const shellHit = await waitForAnySelector(
      page,
      LIST_SHELL_CANDIDATES,
      PAIRING_TIMEOUT_SEC * 1000,
      'shell',
    );
    if (!shellHit) {
      const dump = await dumpCustomTags(page);
      log('error', 'لم تظهر "قشرة" قائمة المحادثات. أعلى custom tags في الصفحة:');
      dump.forEach(([t, n]) => log('error', `   ${t}  (${n})`));
      throw new Error('list shell not found');
    }

    log('items', 'ننتظر تحميل عناصر المحادثات داخل القشرة ...');
    const itemHit = await waitForAnySelector(
      page,
      LIST_ITEM_CANDIDATES,
      60 * 1000,
      'items',
    );
    if (!itemHit) {
      const insideShell = await page.evaluate((shellSel) => {
        const shell = document.querySelector(shellSel);
        if (!shell) return { error: 'shell_gone' };
        const counts = {};
        shell.querySelectorAll('*').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          counts[tag] = (counts[tag] || 0) + 1;
        });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30);
        const html = (shell.innerHTML || '').slice(0, 2000);
        return { top_tags: top, inner_html_preview: html };
      }, shellHit.selector);
      log('error', 'لم أجد selector صالح لعنصر محادثة. تشخيص داخل القشرة:');
      log('error', JSON.stringify(insideShell, null, 2));
      throw new Error('list item selector not found');
    }

    await page.waitForTimeout(1500);

    const target = await findConversation(page, itemHit.selector, TARGET_CONTACT);
    if (!target) {
      const items = page.locator(itemHit.selector);
      const total = Math.min(await items.count(), 20);
      log('error', `لم أجد محادثة باسم يحوي "${TARGET_CONTACT}". أوّل ${total} اسم رأيتها:`);
      for (let i = 0; i < total; i++) {
        const name = await getItemName(items.nth(i));
        log('error', `   [${i}] ${name}`);
      }
      throw new Error(`conversation not found: ${TARGET_CONTACT}`);
    }

    log('nav', 'فتح المحادثة ...');
    await target.click();
    await page.waitForTimeout(1500);

    const data = await extractLastMessage(page);

    log('result', '---------------- آخر رسالة ----------------');
    log('result', `wrapper_sel : ${data.wrapper_selector || '(none)'}`);
    log('result', `wrappers    : ${data.wrappers_count}`);
    log('result', `direction   : ${data.last_direction}`);
    log('result', `timestamp   : ${data.last_timestamp}`);
    log('result', `text        :\n${data.last_text}`);
    log('result', '--------------------------------------------');

    if (!data.last_text) {
      log('debug', 'فشل استخراج النصّ. أوّل 1500 حرف من DOM:');
      log('debug', data.last_outer_html_preview);
      exitCode = 2;
    } else {
      log('selectors-ok', JSON.stringify({
        list_shell: shellHit.selector,
        list_item: itemHit.selector,
        message_wrapper: data.wrapper_selector,
      }, null, 2));
    }
  } catch (err) {
    log('error', err?.message || err);
    exitCode = 1;
  } finally {
    if (HEADLESS) {
      await context.close();
    } else {
      log('hold', 'المتصفّح مفتوح للفحص اليدوي. اضغط Ctrl+C للخروج.');
      await new Promise(() => {});
    }
    process.exit(exitCode);
  }
}

main();
