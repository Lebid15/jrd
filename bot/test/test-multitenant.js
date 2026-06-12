/**
 * Bot multi-tenant smoke test (بدون Baileys).
 * يتحقّق من:
 *  - config.authDir يستعمل env AUTH_DIR.
 *  - مسارات per-tenant مستقلّة.
 *  - bootstrap-style اكتشاف المجلدات (ملفّات/غير-مجلدات تُتجاهَل).
 *  - backendClient.ingestMessage يُمرّر tenant_id في الـ body.
 *
 * لا يستورد sessionManager/session.js لتجنّب الاعتماد على @whiskeysockets/baileys
 * في بيئة الاختبار.
 *
 * تشغيل: node bot/test/test-multitenant.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { pathToFileURL, fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  + ${name}`); pass++; }
  else      { console.log(`  - ${name}${extra ? '   -> ' + extra : ''}`); fail++; }
}

// 1) جهّز server للـ ingest قبل أي استيراد، لنحصل على port ثم نضبط BACKEND_URL.
let receivedBody = null;
let receivedHeaders = null;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    receivedHeaders = req.headers;
    if (req.url === '/api/internal/ingest') {
      try { receivedBody = JSON.parse(body); } catch {}
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    } else {
      res.writeHead(404); res.end();
    }
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// 2) جهّز env قبل أي استيراد لـ config/backendClient.
const tmpAuth = fs.mkdtempSync(path.join(os.tmpdir(), 'jrd-bot-mt-'));
process.env.AUTH_DIR = tmpAuth;
process.env.INTERNAL_API_KEY = 'test_internal_key';
process.env.BACKEND_URL = `http://127.0.0.1:${port}`;

// 3) الآن استورد config + backendClient.
const { config } = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'config.js')).href);
const bc = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'backendClient.js')).href);

console.log('\n=== Test A: config reads ENV ===');
check('config.authDir == AUTH_DIR env', config.authDir === tmpAuth, `got ${config.authDir}`);
check('config.internalApiKey set', config.internalApiKey === 'test_internal_key');
check('config.backendUrl points to test server', config.backendUrl === `http://127.0.0.1:${port}`);

console.log('\n=== Test B: per-tenant authDir derivation ===');
const t1 = path.join(config.authDir, '1');
const t2 = path.join(config.authDir, '2');
const t99 = path.join(config.authDir, '99');
check('tenant 1 path', t1 === path.join(tmpAuth, '1'));
check('tenant 2 path', t2 === path.join(tmpAuth, '2'));
check('distinct tenant dirs', t1 !== t2 && t2 !== t99 && t1 !== t99);

console.log('\n=== Test C: bootstrap-style folder discovery ===');
fs.mkdirSync(path.join(tmpAuth, '1'), { recursive: true });
fs.mkdirSync(path.join(tmpAuth, '2'), { recursive: true });
fs.mkdirSync(path.join(tmpAuth, '7'), { recursive: true });
fs.writeFileSync(path.join(tmpAuth, 'README'), 'ignore');

const folders = fs.readdirSync(config.authDir).filter(f =>
  fs.statSync(path.join(config.authDir, f)).isDirectory()
);
check('discovered 3 dirs', folders.length === 3, `got ${folders.length}: ${folders.join(',')}`);
check('includes "1"', folders.includes('1'));
check('includes "2"', folders.includes('2'));
check('includes "7"', folders.includes('7'));
check('non-folder "README" excluded', !folders.includes('README'));

console.log('\n=== Test D: backendClient sends tenant_id to /api/internal/ingest ===');
await bc.ingestMessage({
  tenant_id: 42,
  group_id: 'g@s',
  group_name: 'TestGroup',
  sender: '111',
  sender_name: 'Tester',
  message_id: 'm1',
  text: 'hello',
  is_group: true,
});

check('backend received body', receivedBody !== null, `body: ${JSON.stringify(receivedBody)}`);
check('body has tenant_id=42', receivedBody?.tenant_id === 42, `got ${receivedBody?.tenant_id}`);
check('body has group_name', receivedBody?.group_name === 'TestGroup');
check('X-Internal-Api-Key header sent', receivedHeaders?.['x-internal-api-key'] === 'test_internal_key');

await new Promise(r => server.close(r));
try { fs.rmSync(tmpAuth, { recursive: true, force: true }); } catch {}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
