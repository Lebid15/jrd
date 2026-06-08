import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from './config.js';
import { log } from './logger.js';
import { sendToBackend } from './backendClient.js';
import {
  LIST_SHELL_CANDIDATES,
  LIST_ITEM_CANDIDATES,
  ITEM_NAME_CANDIDATES,
  MESSAGE_WRAPPER_CANDIDATES,
  MESSAGE_TEXT_CANDIDATES,
} from './selectors.js';

const MESSAGES_URL = 'https://messages.google.com/web/conversations';

/**
 * State machine بسيطة:
 *  idle             — لم نبدأ بعد
 *  starting         — يفتح المتصفّح
 *  pairing          — على صفحة QR، ننتظر المسح
 *  opening_chat     — مقترن، يفتح محادثة الهدف
 *  running          — يستطلع دورياً
 *  session_expired  — كانت running ثم وقعنا على صفحة QR (الجلسة انتهت)
 *  error            — خطأ غير قابل للاستئناف بدون إعادة تشغيل
 *  stopped          — متوقّف يدوياً
 */
export class Scraper {
  constructor() {
    this.state = 'idle';
    this.lastError = null;
    this.lastSeenAt = null;            // آخر مرّة استطلعنا فيها بنجاح
    this.lastMessageAt = null;         // آخر رسالة جديدة عُولجت
    this.messagesProcessedTotal = 0;
    this.context = null;
    this.page = null;
    this.pollTimer = null;
    this.seen = new Set();             // hashes للرسائل المُعالَجة
    this._loadSeen();
    this._activeSelectors = {
      list_shell: null,
      list_item: null,
      message_wrapper: null,
    };
  }

  // ─── persistence (seen.json) ────────────────────────────────────────────
  _loadSeen() {
    try {
      if (fs.existsSync(config.seenFile)) {
        const raw = fs.readFileSync(config.seenFile, 'utf8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) this.seen = new Set(arr);
      }
    } catch (e) {
      log.warn('seen', 'load failed', e.message);
    }
  }
  _saveSeen() {
    try {
      fs.mkdirSync(path.dirname(config.seenFile), { recursive: true });
      // نحتفظ بآخر 2000 hash فقط حتى لا ينمو الملف بلا حدود
      const arr = Array.from(this.seen).slice(-2000);
      fs.writeFileSync(config.seenFile, JSON.stringify(arr));
    } catch (e) {
      log.warn('seen', 'save failed', e.message);
    }
  }

  // ─── public API ─────────────────────────────────────────────────────────
  status() {
    return {
      state: this.state,
      last_error: this.lastError,
      last_seen_at: this.lastSeenAt,
      last_message_at: this.lastMessageAt,
      messages_processed_total: this.messagesProcessedTotal,
      active_selectors: this._activeSelectors,
      target_contact: config.targetContact,
      poll_interval_ms: config.pollIntervalMs,
      headless: config.headless,
      browser_data_dir: config.browserDataDir,
    };
  }

  async start() {
    if (['starting', 'opening_chat', 'running', 'pairing'].includes(this.state)) {
      return { already: true, state: this.state };
    }
    this.lastError = null;
    this.state = 'starting';
    log.info('start', 'launching persistent context', { dir: config.browserDataDir });
    fs.mkdirSync(config.browserDataDir, { recursive: true });

    // إزالة ملفات قفل Chromium المتبقّية من جلسة سابقة (تتعطّل launchPersistentContext معها)
    for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const p = path.join(config.browserDataDir, lockName);
      try { fs.rmSync(p, { force: true }); } catch (_) { /* ignore */ }
    }

    try {
      this.context = await chromium.launchPersistentContext(config.browserDataDir, {
        headless: config.headless,
        channel: process.env.GMSG_CHROME_CHANNEL || 'chrome', // استخدم Chrome الحقيقي (يقبله Google)
        viewport: { width: 1024, height: 768 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          // ملاحظة: لا نعطّل IsolateOrigins/site-per-process لأنّها تكسر
          // Service Worker و IndexedDB التي يحفظ فيها Google Messages
          // بيانات الإقران (وإلا يدخل دوامة welcome ↔ pair ↔ welcome).
          '--disable-features=TranslateUI',
          '--memory-pressure-off',
          '--lang=en-US,en',
        ],
      });

      // stealth: إخفاء علامات الأتمتة قبل أيّ تنقّل
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5].map(() => ({ name: 'Chrome PDF Plugin' })),
        });
        // ضمن window.chrome (موجود في Chrome الحقيقي)
        if (!window.chrome) window.chrome = { runtime: {} };
        // permissions query بشكل طبيعي
        const orig = window.navigator.permissions?.query?.bind(window.navigator.permissions);
        if (orig) {
          window.navigator.permissions.query = (p) =>
            p.name === 'notifications'
              ? Promise.resolve({ state: Notification.permission, onchange: null })
              : orig(p);
        }
      });
      this.page = this.context.pages()[0] || (await this.context.newPage());
      this.page.setDefaultTimeout(config.navTimeoutMs);

      await this.page.goto(MESSAGES_URL, {
        waitUntil: 'domcontentloaded',
        timeout: config.navTimeoutMs,
      });

      // قد نهبط على /web/welcome — نحاول تجاوزها بالضغط على زر "Get started" / "Continue"
      this.state = 'pairing';
      await this._dismissWelcomeIfPresent();

      // ننتظر "قشرة" قائمة المحادثات (= مقترن) — مهلة طويلة (30 د) لإتاحة مسح QR من الواجهة
      const shell = await this._waitForAnySelector(
        LIST_SHELL_CANDIDATES,
        config.pairingTimeoutSec * 1000,
        'shell',
      );
      if (!shell) {
        // لا نرمي خطأ — نُبقي المتصفّح مفتوحاً ليرى المستخدم QR عبر /screenshot
        this.state = 'session_expired';
        this.lastError = 'pairing_timeout';
        log.warn('start', 'pairing_timeout — browser kept open for manual QR via UI');
        return { ok: false, state: this.state, hint: 'open /screenshot to scan QR' };
      }
      this._activeSelectors.list_shell = shell.selector;

      // ننتظر عناصر المحادثات
      const item = await this._waitForAnySelector(LIST_ITEM_CANDIDATES, 60_000, 'items');
      if (!item) {
        this.lastError = 'list_items_not_found';
        this.state = 'error';
        throw new Error('list_items_not_found');
      }
      this._activeSelectors.list_item = item.selector;

      // افتح المحادثة الهدف
      this.state = 'opening_chat';
      await this._openTargetConversation();

      // أوّل scan: نُعلِّم كل الرسائل الموجودة كـ "مرئية" بدون إرسالها (Bootstrap).
      // فقط الرسائل التي تظهر بعد هذه اللحظة تُرسَل.
      await this._bootstrap();

      this.state = 'running';
      this._scheduleNextPoll();
      log.info('start', 'running');
      return { ok: true, state: this.state, selectors: this._activeSelectors };
    } catch (err) {
      this.lastError = err.message;
      if (this.state !== 'session_expired') this.state = 'error';
      log.error('start', 'failed', err.message);
      // لا نُغلق المتصفّح كي يتمكّن المستخدم من رؤية الحالة (مفيد محلياً).
      throw err;
    }
  }

  async stop() {
    log.info('stop', 'stopping');
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    try {
      if (this.context) await this.context.close();
    } catch (e) {
      log.warn('stop', 'context close error', e.message);
    }
    this.context = null;
    this.page = null;
    this.state = 'stopped';
    return { ok: true };
  }

  /** يلتقط لقطة شاشة لصفحة Chromium الحالية. يُستخدم لعرض QR في الواجهة. */
  async screenshot() {
    if (!this.page) {
      log.warn('screenshot', 'no page object available');
      return null;
    }
    try {
      // JPEG + clip + low quality لتجنّب OOM في renderer على Railway
      const buf = await this.page.screenshot({
        type: 'jpeg',
        quality: 60,
        timeout: 8000,
        animations: 'disabled',
        caret: 'hide',
        clip: { x: 0, y: 0, width: 1024, height: 768 },
      });
      log.info('screenshot', `captured ${buf.length} bytes (jpeg)`);
      return buf;
    } catch (e) {
      log.warn('screenshot', `error: ${e.message}`);
      // إن انهار Target → أعد التشغيل التلقائي (في الخلفية)
      if (/Target crashed|browser has been closed|context or browser/i.test(e.message)) {
        log.info('screenshot', 'target crashed — scheduling restart');
        setImmediate(() => {
          this.stop().catch(() => {}).then(() => {
            setTimeout(() => this.start().catch(() => {}), 2000);
          });
        });
      }
      return null;
    }
  }

  // ─── تفاعل عن بُعد (نقر/كتابة/تنقّل) لإتمام الإقران من الواجهة ─────────────
  async remoteClick(x, y) {
    if (!this.page) throw new Error('no_page');
    await this.page.mouse.click(x, y, { delay: 50 });
    return { ok: true, x, y };
  }

  async remoteType(text) {
    if (!this.page) throw new Error('no_page');
    await this.page.keyboard.type(text, { delay: 20 });
    return { ok: true, length: text.length };
  }

  async remoteKey(key) {
    if (!this.page) throw new Error('no_page');
    await this.page.keyboard.press(key);
    return { ok: true, key };
  }

  async remoteScroll(dy) {
    if (!this.page) throw new Error('no_page');
    await this.page.mouse.wheel(0, dy);
    return { ok: true, dy };
  }

  async remoteGoto(url) {
    if (!this.page) throw new Error('no_page');
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { ok: true, url: this.page.url() };
  }

  async remoteUrl() {
    if (!this.page) return null;
    return this.page.url();
  }

  /** يحاول تجاوز صفحة /web/welcome بالضغط على أوّل زر "Get started"/"Continue". */
  async _dismissWelcomeIfPresent() {
    try {
      const url = this.page.url();
      if (!/\/welcome/.test(url)) return;
      log.info('welcome', `on welcome page: ${url} — attempting to advance`);
      const candidates = [
        'button:has-text("Get started")',
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'button:has-text("ابدأ")',
        'button:has-text("متابعة")',
        'button[type="submit"]',
        'mw-welcome button',
        'a[href*="/conversations"]',
      ];
      for (const sel of candidates) {
        const loc = this.page.locator(sel).first();
        if ((await loc.count().catch(() => 0)) > 0) {
          try {
            await loc.click({ timeout: 3000 });
            log.info('welcome', `clicked: ${sel}`);
            await this.page.waitForTimeout(2000);
            return;
          } catch (_) { /* try next */ }
        }
      }
      log.info('welcome', 'no welcome button found — proceeding');
    } catch (e) {
      log.warn('welcome', e.message);
    }
  }

  // ─── internals ──────────────────────────────────────────────────────────
  async _waitForAnySelector(selectors, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        const count = await this.page.locator(sel).count().catch(() => 0);
        if (count > 0) {
          log.info(label, `selector="${sel}" count=${count}`);
          return { selector: sel, count };
        }
      }
      await this.page.waitForTimeout(800);
    }
    return null;
  }

  async _getItemName(itemLocator) {
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

  async _openTargetConversation() {
    const items = this.page.locator(this._activeSelectors.list_item);
    const total = await items.count();
    log.info('list', `conversations count=${total}`);
    for (let i = 0; i < total; i++) {
      const item = items.nth(i);
      const name = await this._getItemName(item);
      if (name && name.toLowerCase().includes(config.targetContact.toLowerCase())) {
        log.info('list', `target match index=${i} name="${name}"`);
        await item.click();
        await this.page.waitForTimeout(1500);
        const wrapperHit = await this._waitForAnySelector(
          MESSAGE_WRAPPER_CANDIDATES,
          config.navTimeoutMs,
          'msg-wait',
        );
        if (!wrapperHit) throw new Error('no_message_wrapper_after_open');
        this._activeSelectors.message_wrapper = wrapperHit.selector;
        return;
      }
    }
    throw new Error(`target_not_found:${config.targetContact}`);
  }

  /** يقرأ آخر N رسالة ويُعَلِّمها seen دون إرسال (نقطة الصفر للـ polling). */
  async _bootstrap() {
    const messages = await this._readLastMessages();
    for (const m of messages) {
      this.seen.add(m.hash);
    }
    this._saveSeen();
    log.info('bootstrap', `marked ${messages.length} existing messages as seen`);
  }

  _scheduleNextPoll() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this._tick().catch((e) => {
      log.error('poll', 'tick error', e.message);
      this.lastError = e.message;
      this._scheduleNextPoll();
    }), config.pollIntervalMs);
  }

  async _tick() {
    if (this.state !== 'running') return;
    // فحص انتهاء الجلسة: إن اختفت قائمة المحادثات أو ظهرت صفحة QR.
    const shellExists = await this.page.locator(this._activeSelectors.list_shell).count().catch(() => 0);
    if (!shellExists) {
      // ربما تنقّلنا أو الجلسة انتهت
      const url = this.page.url();
      if (/authentication|qr/i.test(url)) {
        log.warn('session', 'session_expired (qr page)');
        this.state = 'session_expired';
        return; // لا polling حتى إعادة الإقران
      }
      // نحاول إعادة فتح المحادثة
      try {
        await this._openTargetConversation();
      } catch (e) {
        log.warn('tick', 're-open failed', e.message);
        this._scheduleNextPoll();
        return;
      }
    }

    const messages = await this._readLastMessages();
    this.lastSeenAt = new Date().toISOString();
    let newCount = 0;
    for (const m of messages) {
      if (this.seen.has(m.hash)) continue;
      // فقط الرسائل الواردة (incoming) من البنك تهمّنا.
      if (m.direction === 'outgoing') {
        this.seen.add(m.hash);
        continue;
      }
      try {
        const resp = await sendToBackend({
          text: m.text,
          occurredAt: m.timestamp,
          externalId: m.hash,
          contactName: config.targetContact,
        });
        log.info('ingest', 'sent', { applied: resp.applied, hash: m.hash.slice(0, 12) });
        this.seen.add(m.hash);
        this.lastMessageAt = new Date().toISOString();
        this.messagesProcessedTotal++;
        newCount++;
      } catch (e) {
        log.warn('ingest', 'failed — will retry next tick', e.message);
        // لا نضيفها لـ seen كي نُعيد المحاولة في الدورة التالية.
      }
    }
    if (newCount > 0) this._saveSeen();
    this._scheduleNextPoll();
  }

  /** قراءة آخر scanLastN رسالة من المحادثة المفتوحة. */
  async _readLastMessages() {
    const wrapperSel = this._activeSelectors.message_wrapper;
    if (!wrapperSel) return [];
    const textSels = MESSAGE_TEXT_CANDIDATES;
    const scanLastN = config.scanLastN;

    const raws = await this.page.evaluate(
      ({ wrapperSel, textSels, scanLastN }) => {
        const wrappers = Array.from(document.querySelectorAll(wrapperSel));
        const slice = wrappers.slice(-scanLastN);
        return slice.map((el) => {
          const html = el.outerHTML || '';
          let direction = null;
          if (/\bincoming\b/.test(html)) direction = 'incoming';
          else if (/\boutgoing\b/.test(html)) direction = 'outgoing';

          let text = '';
          for (const sel of textSels) {
            const t = el.querySelector(sel);
            if (t) {
              text = (t.innerText || '').trim();
              if (text) break;
            }
          }
          if (!text) text = (el.innerText || '').trim();

          const tsEl =
            el.querySelector('mws-relative-timestamp') ||
            el.querySelector('mw-relative-timestamp') ||
            el.querySelector('[data-e2e-message-timestamp]') ||
            el.querySelector('time');
          const timestamp = tsEl
            ? tsEl.getAttribute('datetime') || tsEl.getAttribute('title') || (tsEl.innerText || '').trim()
            : null;

          return { direction, text, timestamp };
        });
      },
      { wrapperSel, textSels, scanLastN },
    );

    // hash مستقر: نعتمد على (text + timestamp). text لكويت ترك يحوي Tutar و Islem Zamani
    // وهي فريدة عملياً لكل رسالة.
    return raws
      .filter((m) => m.text && m.text.length > 5)
      .map((m) => {
        const h = crypto
          .createHash('sha256')
          .update(`${m.timestamp || ''}|${m.text}`)
          .digest('hex')
          .slice(0, 24);
        return { ...m, hash: h };
      });
  }
}
