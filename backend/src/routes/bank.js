import { Router } from 'express';
import db from '../database.js';

const router = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * تحويل الأرقام التركية "1.000,00" → 1000.00
 */
export function parseTurkishNumber(str) {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

/**
 * تحليل نص SMS من كويت ترك
 * يرجع: { direction: 'in'|'out', amount, senderReceiver, description, transactionTime }
 * أو null إذا لم يُعرَف النمط
 *
 * يُستخدَم من webhook الـ SMS ومن messages-scraper (Google Messages) معاً —
 * نفس parser للمصدرَين، لأن نصّ الرسالة هو نفسه.
 */
export function parseSms(body) {
  const isIncoming = /hesab[ıi]n[ıi]za.*para geldi/i.test(body);
  const isOutgoing = /hesab[ıi]n[ıi]zdan.*para g[oö]nderildi/i.test(body);

  if (!isIncoming && !isOutgoing) return null;

  const amountMatch = body.match(/Tutar:\s*([\d.,]+)\s*TL/i);
  if (!amountMatch) return null;
  const amount = parseTurkishNumber(amountMatch[1]);
  if (isNaN(amount) || amount <= 0) return null;

  // الطرف الآخر: مُرسِل أو مُستلِم
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
    amount,
    senderReceiver,
    description,
    transactionTime,
  };
}

// ─── routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/bank/sms-webhook
 * يستقبل SMS من تطبيق SMS Forwarder ويحدّث رصيد البنك
 *
 * أمان: يتحقق من SMS_WEBHOOK_SECRET في query أو header
 * Body: { sender: string, body: string, item_id?: number }
 */
/**
 * core processing — يُستخدَم من webhook و من sms-test معاً
 * يسجّل دائماً في bank_sms_log ويرجع كائن النتيجة.
 */
function processSmsRequest({ ip, sender, smsBody, item_id, secret_ok = true }) {
  const insertLog = db.prepare(`
    INSERT INTO bank_sms_log
      (ip, secret_ok, parse_status, error_message, sender, raw_body, item_id, direction, amount, transaction_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1) فشل تحقّق السر
  if (!secret_ok) {
    insertLog.run(ip || '', 0, 'unauthorized', 'Bad SMS_WEBHOOK_SECRET', sender || '', smsBody || '', null, '', null, null);
    return { http: 401, body: { error: 'Unauthorized' } };
  }

  // 2) جسم فارغ
  if (!smsBody || !String(smsBody).trim()) {
    insertLog.run(ip || '', 1, 'no_body', 'Empty body', sender || '', smsBody || '', null, '', null, null);
    return { http: 400, body: { error: 'body is required' } };
  }

  // نستخرج نص الرسالة الفعلي — بعض التطبيقات ترسل "From : X\nنص الرسالة"
  const bodyClean = smsBody.includes('\n')
    ? smsBody.split('\n').slice(smsBody.startsWith('From') ? 1 : 0).join('\n').trim()
    : smsBody.trim();

  const parsed = parseSms(bodyClean);

  // 3) نمط غير معروف
  if (!parsed) {
    insertLog.run(ip || '', 1, 'no_pattern', 'Could not parse SMS', sender || '', bodyClean, null, '', null, null);
    return { http: 422, body: { error: 'Could not parse SMS', raw: bodyClean } };
  }

  // إيجاد البند البنكي — إما بـ item_id أو أول بند من نوع 'bank'
  let bankItem;
  if (item_id) {
    bankItem = db.prepare("SELECT i.id, cv.try_amount FROM items i LEFT JOIN current_values cv ON cv.item_id = i.id WHERE i.id = ? AND i.type = 'bank'").get(item_id);
  } else {
    bankItem = db.prepare("SELECT i.id, cv.try_amount FROM items i LEFT JOIN current_values cv ON cv.item_id = i.id WHERE i.type = 'bank' AND i.is_active = 1 ORDER BY i.sort_order ASC LIMIT 1").get();
  }

  // 4) لا يوجد بند بنكي مُفعَّل
  if (!bankItem) {
    insertLog.run(
      ip || '', 1, 'no_bank_item',
      'No active item with type=bank. Add a bank item or activate it.',
      sender || '', bodyClean, null, parsed.direction, parsed.amount, null
    );
    return { http: 404, body: { error: 'No bank item found. Create an item with type=bank first.' } };
  }

  const currentBalance = bankItem.try_amount || 0;
  const newBalance = parsed.direction === 'in'
    ? currentBalance + parsed.amount
    : currentBalance - parsed.amount;

  // 5) تطبيق ناجح — atomic: update balance + insert transaction + log
  const txId = db.transaction(() => {
    db.prepare('UPDATE current_values SET try_amount = ? WHERE item_id = ?')
      .run(newBalance, bankItem.id);

    const result = db.prepare(`
      INSERT INTO bank_transactions (item_id, direction, amount, sender_receiver, description, transaction_time, raw_sms, balance_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bankItem.id,
      parsed.direction,
      parsed.amount,
      parsed.senderReceiver,
      parsed.description,
      parsed.transactionTime,
      bodyClean,
      newBalance
    );
    const newTxId = result.lastInsertRowid;

    insertLog.run(
      ip || '', 1, 'applied', '',
      sender || '', bodyClean,
      bankItem.id, parsed.direction, parsed.amount, newTxId
    );
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

router.post('/sms-webhook', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  const secret = process.env.SMS_WEBHOOK_SECRET;
  let secret_ok = true;
  if (secret) {
    const provided = req.query.secret || req.headers['x-webhook-secret'];
    if (provided !== secret) secret_ok = false;
  }

  const { sender = '', body: smsBody = '', item_id } = req.body || {};
  const result = processSmsRequest({ ip, sender, smsBody, item_id, secret_ok });
  res.status(result.http).json(result.body);
});

/**
 * POST /api/bank/sms-test
 * أداة اختبار يدوية: يلصق المستخدم نص SMS من الواجهة ويرى لماذا فشل/نجح.
 * body: { body: string, sender?: string, item_id?: number }
 * (لا تحتاج secret لأنها مسار داخلي للواجهة على نفس النطاق)
 */
router.post('/sms-test', (req, res) => {
  const ip = 'manual-test';
  const { sender = '', body: smsBody = '', item_id } = req.body || {};
  const result = processSmsRequest({ ip, sender, smsBody, item_id, secret_ok: true });
  res.status(result.http === 401 ? 200 : result.http).json(result.body);
});

/**
 * GET /api/bank/sms-log?limit=50
 * سجلّ كل طلب وصل إلى webhook (نجاح/فشل + سبب).
 */
router.get('/sms-log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const rows = db.prepare(`
    SELECT id, created_at, ip, secret_ok, parse_status, error_message,
           sender, raw_body, item_id, direction, amount, transaction_id
    FROM bank_sms_log
    ORDER BY id DESC LIMIT ?
  `).all(limit);
  res.json(rows);
});

/**
 * DELETE /api/bank/sms-log — تفريغ السجلّ كاملاً.
 * DELETE /api/bank/sms-log/:id — حذف صفّ واحد.
 */
router.delete('/sms-log', (req, res) => {
  const info = db.prepare('DELETE FROM bank_sms_log').run();
  res.json({ success: true, deleted: info.changes });
});
router.delete('/sms-log/:id', (req, res) => {
  const info = db.prepare('DELETE FROM bank_sms_log WHERE id = ?').run(req.params.id);
  res.json({ success: true, deleted: info.changes });
});

/**
 * GET /api/bank/diagnostics — حالة الـ webhook العامة
 * - هل secret مضبوط
 * - عدد البنود البنكية المفعَّلة
 * - آخر طلب وصل + آخر معاملة طُبِّقت
 */
router.get('/diagnostics', (req, res) => {
  const secretConfigured = !!process.env.SMS_WEBHOOK_SECRET;
  const bankItems = db.prepare("SELECT id, name, is_active FROM items WHERE type = 'bank' ORDER BY sort_order").all();
  const lastLog = db.prepare('SELECT id, created_at, parse_status, error_message FROM bank_sms_log ORDER BY id DESC LIMIT 1').get();
  const lastTx = db.prepare('SELECT id, created_at, direction, amount FROM bank_transactions ORDER BY id DESC LIMIT 1').get();
  const counts = db.prepare(`
    SELECT parse_status, COUNT(*) as n
    FROM bank_sms_log
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY parse_status
  `).all();
  res.json({
    secret_configured: secretConfigured,
    bank_items: bankItems,
    last_webhook_log: lastLog || null,
    last_transaction: lastTx || null,
    counts_last_7d: counts,
    webhook_path: '/api/bank/sms-webhook',
  });
});

/**
 * GET /api/bank/transactions?item_id=X&limit=50
 * سجل المعاملات البنكية
 */
router.get('/transactions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const itemId = req.query.item_id;

  let rows;
  if (itemId) {
    rows = db.prepare(`
      SELECT bt.*, i.name as item_name
      FROM bank_transactions bt
      LEFT JOIN items i ON i.id = bt.item_id
      WHERE bt.item_id = ?
      ORDER BY bt.id DESC LIMIT ?
    `).all(itemId, limit);
  } else {
    rows = db.prepare(`
      SELECT bt.*, i.name as item_name
      FROM bank_transactions bt
      LEFT JOIN items i ON i.id = bt.item_id
      ORDER BY bt.id DESC LIMIT ?
    `).all(limit);
  }

  res.json(rows);
});

/**
 * DELETE /api/bank/transactions/:id
 * حذف معاملة وتصحيح الرصيد
 */
router.delete('/transactions/:id', (req, res) => {
  const tx = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });

  const cv = db.prepare('SELECT try_amount FROM current_values WHERE item_id = ?').get(tx.item_id);
  if (!cv) return res.status(404).json({ error: 'Bank item not found' });

  // عكس العملية
  const corrected = tx.direction === 'in'
    ? (cv.try_amount || 0) - tx.amount
    : (cv.try_amount || 0) + tx.amount;

  db.transaction(() => {
    db.prepare('UPDATE current_values SET try_amount = ? WHERE item_id = ?').run(corrected, tx.item_id);
    db.prepare('DELETE FROM bank_transactions WHERE id = ?').run(tx.id);
  })();

  res.json({ success: true, balance_after: corrected });
});

export default router;
