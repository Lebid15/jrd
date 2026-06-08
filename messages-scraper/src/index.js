// نقطة الدخول — تسجيل حُرّاس استثناءات أوّلاً، ثم تشغيل الخادم.
// (في ESM تُرفع imports فوق كل شيء، لذا نستخدم dynamic import لضمان
//  تسجيل الـ handlers قبل أي كود تهيئة قد يرمي).
process.on('uncaughtException', (err) => {
  console.error('[gmsg] uncaughtException — keeping process alive:', err?.stack || err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[gmsg] unhandledRejection — keeping process alive:', reason?.stack || reason?.message || reason);
});

await import('./server.js');
