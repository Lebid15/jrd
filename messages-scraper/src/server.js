import express from 'express';
import crypto from 'crypto';
import { config } from './config.js';
import { log } from './logger.js';
import { Scraper } from './scraper.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

const scraper = new Scraper();

// ─── auth middleware (مثل internal.js) ──────────────────────────────────────
function internalAuth(req, res, next) {
  const key = config.internalApiKey || '';
  if (!key) return next(); // محلياً بدون مفتاح
  const provided = req.headers['x-internal-api-key'] || '';
  try {
    const a = Buffer.from(String(provided).padEnd(64));
    const b = Buffer.from(key.padEnd(64));
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Unauthorized' });
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true, ts: Date.now(), state: scraper.state });
});

app.get('/status', internalAuth, (req, res) => {
  res.json(scraper.status());
});

app.post('/start', internalAuth, async (req, res) => {
  try {
    const out = await scraper.start();
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message, state: scraper.state });
  }
});

app.post('/stop', internalAuth, async (req, res) => {
  // رفض stop أثناء الإقلاع/الإقران النشط إلا بـ force=1 (يمنع حلقة stop/start)
  const force = req.query.force === '1' || req.body?.force === true;
  if (!force && ['starting', 'pairing', 'opening_chat'].includes(scraper.state)) {
    return res.status(409).json({
      ok: false,
      refused: 'busy',
      state: scraper.state,
      hint: 'الـ scraper حالياً يحاول الإقران — أعد المحاولة بعد دقيقة أو استخدم ?force=1',
    });
  }
  const out = await scraper.stop();
  res.json(out);
});

// مكان مخصّص لاحقاً لـ /repair (إعادة إقران من الواجهة).
// حالياً: إعادة الإقران تتمّ محلياً عبر `npm run spike` بـ HEADLESS=false.
app.post('/repair', internalAuth, async (req, res) => {
  res.status(501).json({
    error: 'not_implemented',
    hint: 'احذف browser-data/ وشغّل npm run spike محلياً (HEADLESS=false) لإعادة الإقران، ثم ارفع المجلد إلى Volume على Railway.',
  });
});

/**
 * POST /recheck
 * فحص فوري: هل اكتمل الإقران (قائمة المحادثات ظاهرة)؟ إن نعم — انتقل لـ running
 * بدون إعادة تشغيل المتصفّح. يُستدعى من زر "تحديث الحالة" في الواجهة.
 */
app.post('/recheck', internalAuth, async (req, res) => {
  try {
    const recovered = await scraper.recheckPairing();
    res.json({ ok: true, recovered, state: scraper.state });
  } catch (e) {
    res.status(500).json({ error: e.message, state: scraper.state });
  }
});

// تشخيص: ماذا يرى الـ scraper الآن من رسائل (بدون أي إرسال أو تعديل seen).
app.get('/peek', internalAuth, async (req, res) => {
  try {
    const out = await scraper.peek();
    res.status(out.ok === false ? 503 : 200).json(out);
  } catch (e) {
    res.status(500).json({ error: e.message, state: scraper.state });
  }
});

/**
 * POST /pause  → يوقف watchdog + polling دون إغلاق المتصفّح.
 * يستعمله المستخدم من الواجهة حين يريد تسجيل دخول Google يدوياً دون أن
 * يقاطعه السكرابر بمحاولات فتح المحادثة كل 8 ثوان.
 */
app.post('/pause', internalAuth, async (req, res) => {
  res.json(scraper.pause());
});

/**
 * POST /resume → يعيد تشغيل watchdog ويحاول الاسترداد فوراً.
 */
app.post('/resume', internalAuth, async (req, res) => {
  try {
    res.json(await scraper.resume());
  } catch (e) {
    res.status(500).json({ error: e.message, state: scraper.state });
  }
});

// تشخيص: ماذا يعرض Chromium الآن (URL + title + نص الـ body المختصر)؟
app.get('/debug-page', internalAuth, async (req, res) => {  try {
    const page = scraper.page;
    if (!page) return res.json({ error: 'no_page', state: scraper.state });
    const url = page.url();
    const title = await page.title().catch(() => null);
    const bodyText = await page.evaluate(() =>
      (document.body?.innerText || '').slice(0, 1500)
    ).catch(() => null);
    const html = await page.evaluate(() =>
      (document.body?.innerHTML || '').slice(0, 2000)
    ).catch(() => null);
    res.json({ state: scraper.state, url, title, body_text: bodyText, html_snippet: html });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// لقطة شاشة Chromium (لعرض QR في الواجهة بدلاً من رفع zip)
app.get('/screenshot', internalAuth, async (req, res) => {
  const buf = await scraper.screenshot();
  if (!buf) return res.status(503).json({ error: 'no_screenshot', state: scraper.state });
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  res.send(buf);
});

// ─── تفاعل عن بُعد مع Chromium (لإتمام التسجيل + الإقران من الواجهة) ─────────
app.post('/interact/click', internalAuth, async (req, res) => {
  try {
    const { x, y } = req.body || {};
    if (typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({ error: 'x and y (numbers) required' });
    }
    res.json(await scraper.remoteClick(x, y));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/interact/type', internalAuth, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string') return res.status(400).json({ error: 'text required' });
    res.json(await scraper.remoteType(text));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/interact/key', internalAuth, async (req, res) => {
  try {
    const { key } = req.body || {};
    if (typeof key !== 'string') return res.status(400).json({ error: 'key required' });
    res.json(await scraper.remoteKey(key));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/interact/scroll', internalAuth, async (req, res) => {
  try {
    const dy = Number(req.body?.dy || 0);
    res.json(await scraper.remoteScroll(dy));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/interact/goto', internalAuth, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (typeof url !== 'string') return res.status(400).json({ error: 'url required' });
    res.json(await scraper.remoteGoto(url));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/interact/url', internalAuth, async (req, res) => {
  res.json({ url: await scraper.remoteUrl(), state: scraper.state });
});

app.listen(config.port, config.host, () => {
  log.info('boot', `messages-scraper listening on ${config.host}:${config.port}`);
  if (config.autoStart) {
    log.info('boot', 'auto-start enabled — calling scraper.start()');
    scraper.start().catch((e) => log.error('boot', 'auto-start failed', e.message));
  } else {
    log.info('boot', 'auto-start disabled — POST /start to begin');
  }
});

// لقطة: إذا انتهت العملية، نُغلق المتصفّح بنظافة.
const shutdown = async (sig) => {
  log.info('shutdown', `signal=${sig}`);
  await scraper.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
