import { Router } from 'express';
import db from '../database.js';
import { tid } from '../tenantHelpers.js';

const router = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

export function parseTurkishNumber(str) {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

export function parseSms(body) {
  const isIncoming = /hesab[ıi]n[ıi]za.*para geldi/i.test(body);
  const isOutgoing = /hesab[ıi]n[ıi]zdan.*para g[oö]nderildi/i.test(body);
  if (!isIncoming && !isOutgoing) return null;

  const amountMatch = body.match(/Tutar:\s*([\d.,]+)\s*TL/i);
  if (!amountMatch) return null;
  const amount = parseTurkishNumber(amountMatch[1]);
  if (isNaN(amount) || amount <= 0) return null;

  let senderReceiver = '';
  if (isIncoming) {
    const m = body.match(/G[oö]nderen:\s*(.+)/i);
    if (m) senderReceiver = m[1].trim();
  } else {
    const m = body.match(/Al[ıi]c[ıi]:\s*(.+)/i);
    if (m) senderReceiver = m[1].trim();
  }

  const descMatch = body.match(/A[cç][ıi]klama:\s*(.*)/i);
  const description = descMatch ? descMatch[1].trim() : '';

  const timeMatch = body.match(/[İI]şlem\s*Zaman[ıi]:\s*(.+?)(?:\s+B\d+)?$/im);
  const transactionTime = timeMatch ? timeMatch[1].trim() : '';

  return {
    direction: isIncoming ? 'in' : 'out',
    amount, senderReceiver, description, transactionTime,
  };
}

// ─── core (يستخدم من webhook و sms-test) ────────────────────────────────────

function processSmsRequest({ tenantId, ip, sender, smsBody, item_id, secret_ok = true }) {
  const insertLog = db.prepare(`
    INSERT INTO bank_sms_log
      (tenant_id, ip, secret_ok, parse_status, error_message, sender, raw_body, item_id, direction, amount, transaction_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (!secret_ok) {
    // محاولة غير مُخوَّلة — نسجّل في tenant 1 (default) كملاذ، لأن العمود NOT NULL وFK
    insertLog.run(tenantId || 1, ip || '', 0, 'unauthorized', 'Bad SMS_WEBHOOK_SECRET', sender || '', smsBody || '', null, '', null, null);
    return { http: 401, body: { error: 'Unauthorized' } };
  }
  if (!tenantId) return { http: 400, body: { error: 'tenant_required' } };

  if (!smsBody || !String(smsBody).trim()) {
    insertLog.run(tenantId, ip || '', 1, 'no_body', 'Empty body', sender || '', smsBody || '', null, '', null, null);
    return { http: 400, body: { error: 'body is required' } };
  }

  const bodyClean = smsBody.includes('\n')
    ? smsBody.split('\n').slice(smsBody.startsWith('From') ? 1 : 0).join('\n').trim()
    : smsBody.trim();

  const parsed = parseSms(bodyClean);
  if (!parsed) {
    insertLog.run(tenantId, ip || '', 1, 'no_pattern', 'Could not parse SMS', sender || '', bodyClean, null, '', null, null);
    return { http: 422, body: { error: 'Could not parse SMS', raw: bodyClean } };
  }

  let bankItem;
  if (item_id) {
    bankItem = db.prepare(`
      SELECT i.id, cv.try_amount
      FROM items i
      LEFT JOIN current_values cv ON cv.item_id = i.id AND cv.tenant_id = i.tenant_id
      WHERE i.id = ? AND i.type = 'bank' AND i.tenant_id = ?
    `).get(item_id, tenantId);
  } else {
    bankItem = db.prepare(`
      SELECT i.id, cv.try_amount
      FROM items i
      LEFT JOIN current_values cv ON cv.item_id = i.id AND cv.tenant_id = i.tenant_id
      WHERE i.type = 'bank' AND i.is_active = 1 AND i.tenant_id = ?
      ORDER BY i.sort_order ASC LIMIT 1
    `).get(tenantId);
  }

  if (!bankItem) {
    insertLog.run(tenantId, ip || '', 1, 'no_bank_item', 'No active bank item for tenant.', sender || '', bodyClean, null, parsed.direction, parsed.amount, null);
    return { http: 404, body: { error: 'No bank item found for tenant.' } };
  }

  const currentBalance = bankItem.try_amount || 0;
  const newBalance = parsed.direction === 'in' ? currentBalance + parsed.amount : currentBalance - parsed.amount;

  const txId = db.transaction(() => {
    db.prepare('UPDATE current_values SET try_amount = ? WHERE item_id = ? AND tenant_id = ?')
      .run(newBalance, bankItem.id, tenantId);

    const result = db.prepare(`
      INSERT INTO bank_transactions (tenant_id, item_id, direction, amount, sender_receiver, description, transaction_time, raw_sms, balance_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, bankItem.id, parsed.direction, parsed.amount, parsed.senderReceiver, parsed.description, parsed.transactionTime, bodyClean, newBalance);
    const newTxId = result.lastInsertRowid;

    insertLog.run(tenantId, ip || '', 1, 'applied', '', sender || '', bodyClean, bankItem.id, parsed.direction, parsed.amount, newTxId);
    return newTxId;
  })();

  return {
    http: 200,
    body: {
      success: true,
      transaction_id: txId,
      direction: parsed.direction,
      amount: parsed.amount,
      balance_before: currentBalance,
      balance_after: newBalance,
      sender_receiver: parsed.senderReceiver,
    },
  };
}

// ─── public webhook handler (مُستدعى من index.js قبل auth) ──────────────────

/**
 * نمطان:
 *   POST /api/webhooks/bank-sms/:tenantSecret  → secret في URL يحدّد tenant
 *   POST /api/bank/sms-webhook                 → التوافق القديم (secret عام عبر env + tenant=1)
 */
export function smsWebhookHandler(req, res) {
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  const tenantSecret = req.params.tenantSecret;
  const { sender = '', body: smsBody = '', item_id } = req.body || {};
  let tenantId = null;
  let secret_ok = true;

  if (tenantSecret) {
    const row = db.prepare(`SELECT tenant_id FROM settings WHERE key = 'sms_webhook_secret' AND value = ?`).get(tenantSecret);
    if (row && row.tenant_id) {
      tenantId = row.tenant_id;
    } else {
      secret_ok = false;
    }
  } else {
    const globalSecret = process.env.SMS_WEBHOOK_SECRET;
    if (globalSecret) {
      const provided = req.query.secret || req.headers['x-webhook-secret'];
      if (provided !== globalSecret) secret_ok = false;
    }
    tenantId = 1;
  }

  const result = processSmsRequest({ tenantId, ip, sender, smsBody, item_id, secret_ok });
  res.status(result.http).json(result.body);
}

// ─── authenticated routes ───────────────────────────────────────────────────

router.post('/sms-test', (req, res) => {
  const t = tid(req);
  const { sender = '', body: smsBody = '', item_id } = req.body || {};
  const result = processSmsRequest({ tenantId: t, ip: 'manual-test', sender, smsBody, item_id, secret_ok: true });
  res.status(result.http === 401 ? 200 : result.http).json(result.body);
});

router.get('/sms-log', (req, res) => {
  const t = tid(req);
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const rows = db.prepare(`
    SELECT id, created_at, ip, secret_ok, parse_status, error_message,
           sender, raw_body, item_id, direction, amount, transaction_id
    FROM bank_sms_log
    WHERE tenant_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(t, limit);
  res.json(rows);
});

router.delete('/sms-log', (req, res) => {
  const t = tid(req);
  const info = db.prepare('DELETE FROM bank_sms_log WHERE tenant_id = ?').run(t);
  res.json({ success: true, deleted: info.changes });
});
router.delete('/sms-log/:id', (req, res) => {
  const t = tid(req);
  const info = db.prepare('DELETE FROM bank_sms_log WHERE id = ? AND tenant_id = ?').run(req.params.id, t);
  res.json({ success: true, deleted: info.changes });
});

router.get('/diagnostics', (req, res) => {
  const t = tid(req);
  const hasTenantSecret = !!db.prepare(`SELECT 1 FROM settings WHERE tenant_id = ? AND key = 'sms_webhook_secret'`).get(t);
  const globalConfigured = !!process.env.SMS_WEBHOOK_SECRET;
  const bankItems = db.prepare("SELECT id, name, is_active FROM items WHERE type = 'bank' AND tenant_id = ? ORDER BY sort_order").all(t);
  const lastLog = db.prepare('SELECT id, created_at, parse_status, error_message FROM bank_sms_log WHERE tenant_id = ? ORDER BY id DESC LIMIT 1').get(t);
  const lastTx = db.prepare('SELECT id, created_at, direction, amount FROM bank_transactions WHERE tenant_id = ? ORDER BY id DESC LIMIT 1').get(t);
  const counts = db.prepare(`
    SELECT parse_status, COUNT(*) as n
    FROM bank_sms_log
    WHERE tenant_id = ? AND created_at >= datetime('now', '-7 days')
    GROUP BY parse_status
  `).all(t);
  res.json({
    tenant_id: t,
    tenant_secret_configured: hasTenantSecret,
    global_secret_configured: globalConfigured,
    bank_items: bankItems,
    last_webhook_log: lastLog || null,
    last_transaction: lastTx || null,
    counts_last_7d: counts,
    webhook_path_new: '/api/webhooks/bank-sms/<tenant_secret>',
    webhook_path_legacy: '/api/bank/sms-webhook',
  });
});

router.get('/transactions', (req, res) => {
  const t = tid(req);
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const { item_id, from, to, direction, min_amount, max_amount, q } = req.query;

  const where = ['bt.tenant_id = ?'];
  const params = [t];
  if (item_id)  { where.push('bt.item_id = ?'); params.push(item_id); }
  if (from)     { where.push("date(bt.created_at) >= date(?)"); params.push(from); }
  if (to)       { where.push("date(bt.created_at) <= date(?)"); params.push(to); }
  if (direction === 'in' || direction === 'out') { where.push('bt.direction = ?'); params.push(direction); }
  if (min_amount !== undefined && min_amount !== '' && !isNaN(parseFloat(min_amount))) {
    where.push('bt.amount >= ?'); params.push(parseFloat(min_amount));
  }
  if (max_amount !== undefined && max_amount !== '' && !isNaN(parseFloat(max_amount))) {
    where.push('bt.amount <= ?'); params.push(parseFloat(max_amount));
  }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    where.push('(bt.sender_receiver LIKE ? OR bt.description LIKE ? OR bt.raw_sms LIKE ?)');
    params.push(like, like, like);
  }

  const sql = `
    SELECT bt.*, i.name as item_name
    FROM bank_transactions bt
    LEFT JOIN items i ON i.id = bt.item_id AND i.tenant_id = bt.tenant_id
    WHERE ${where.join(' AND ')}
    ORDER BY bt.id DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit);
  res.json(rows);
});

router.delete('/transactions/:id', (req, res) => {
  const t = tid(req);
  const tx = db.prepare('SELECT * FROM bank_transactions WHERE id = ? AND tenant_id = ?').get(req.params.id, t);
  if (!tx) return res.status(404).json({ error: 'Not found' });

  const cv = db.prepare('SELECT try_amount FROM current_values WHERE item_id = ? AND tenant_id = ?').get(tx.item_id, t);
  if (!cv) return res.status(404).json({ error: 'Bank item not found' });

  const corrected = tx.direction === 'in' ? (cv.try_amount || 0) - tx.amount : (cv.try_amount || 0) + tx.amount;

  db.transaction(() => {
    db.prepare('UPDATE current_values SET try_amount = ? WHERE item_id = ? AND tenant_id = ?').run(corrected, tx.item_id, t);
    db.prepare('DELETE FROM bank_transactions WHERE id = ? AND tenant_id = ?').run(tx.id, t);
  })();

  res.json({ success: true, balance_after: corrected });
});

export default router;
