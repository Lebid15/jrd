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
