import express from 'express';
import crypto from 'crypto';
import { config } from './config.js';
import { startSession, logoutSession, getSession, listSessions } from './sessionManager.js';

const router = express.Router();

// ─── Public: healthz (بدون auth) — للـ Railway healthcheck وللتشخيص ─────────
router.get('/healthz', (req, res) => {
  res.json({ ok: true, sessions: listSessions().length });
});

// ─── Auth middleware ─────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const provided = req.headers['x-internal-api-key'] || '';
  const expected = config.internalApiKey;
  try {
    const a = Buffer.from(provided.padEnd(64));
    const b = Buffer.from(expected.padEnd(64));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(authMiddleware);

// ─── Protected routes ────────────────────────────────────────────────────────

router.get('/sessions', (req, res) => {
  res.json(listSessions());
});

router.get('/sessions/:tenantId', (req, res) => {
  const session = getSession(req.params.tenantId);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session.status());
});

router.post('/sessions/:tenantId/start', async (req, res) => {
  try {
    const session = await startSession(req.params.tenantId);
    res.json(session.status());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/sessions/:tenantId/logout', async (req, res) => {
  await logoutSession(req.params.tenantId);
  res.json({ success: true });
});

export default router;

export { authMiddleware };
