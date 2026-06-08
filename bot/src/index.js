import 'dotenv/config';

// منع موت العملية بسبب أي استثناء غير ملتقط من Baileys/WebSocket
// (السبب الأشهر لانقطاع الواتس بعد فترة على Railway).
// نُسجِّل قبل تحميل بقية الوحدات عبر dynamic import.
process.on('uncaughtException', (err) => {
  console.error('[bot] uncaughtException — keeping process alive:', err?.stack || err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[bot] unhandledRejection — keeping process alive:', reason?.stack || reason?.message || reason);
});

const express = (await import('express')).default;
const { config } = await import('./config.js');
const logger = (await import('./logger.js')).default;
const router = (await import('./server.js')).default;
const { bootstrap } = await import('./sessionManager.js');

const app = express();
app.use(express.json());
app.use(router);

app.listen(config.botPort, config.botHost, async () => {
  logger.info({ port: config.botPort }, 'Bot server started');
  await bootstrap();
});
