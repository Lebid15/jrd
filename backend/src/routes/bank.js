import { Router } from 'express';
import db from '../database.js';

const router = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * تحويل الأرقام التركية "1.000,00" → 1000.00
 */
function parseTurkishNumber(str) {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

/**
 * تحليل نص SMS من كويت ترك
 * يرجع: { direction: 'in'|'out', amount, senderReceiver, description, transactionTime }
 * أو null إذا لم يُعرَف النمط
 */
function parseSms(body) {
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
router.post('/sms-webhook', (req, res) => {
  const secret = process.env.SMS_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.query.secret || req.headers['x-webhook-secret'];
    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { sender = '', body: smsBody = '', item_id } = req.body;

  if (!smsBody) {
    return res.status(400).json({ error: 'body is required' });
  }

  // نتحقق أن الرسالة من كويت ترك (اختياري لو أرسل المرسِل)
  const senderLower = sender.toLowerCase();
  if (senderLower && !senderLower.includes('kuveyt') && !senderLower.includes('ktbank')) {
    // نسمح بالمرور إذا لم يُرسَل sender (بعض التطبيقات لا ترسله)
    if (senderLower.length > 0) {
      return res.status(400).json({ error: 'Unknown sender' });
    }
  }

  const parsed = parseSms(smsBody);
  if (!parsed) {
    return res.status(422).json({ error: 'Could not parse SMS', raw: smsBody });
  }

  // إيجاد البند البنكي — إما بـ item_id أو أول بند من نوع 'bank'
  let bankItem;
  if (item_id) {
    bankItem = db.prepare("SELECT i.id, cv.try_amount FROM items i LEFT JOIN current_values cv ON cv.item_id = i.id WHERE i.id = ? AND i.type = 'bank'").get(item_id);
  } else {
    bankItem = db.prepare("SELECT i.id, cv.try_amount FROM items i LEFT JOIN current_values cv ON cv.item_id = i.id WHERE i.type = 'bank' AND i.is_active = 1 ORDER BY i.sort_order ASC LIMIT 1").get();
  }

  if (!bankItem) {
    return res.status(404).json({ error: 'No bank item found. Create an item with type=bank first.' });
  }

  const currentBalance = bankItem.try_amount || 0;
  const newBalance = parsed.direction === 'in'
    ? currentBalance + parsed.amount
    : currentBalance - parsed.amount;

  // تحديث الرصيد + حفظ المعاملة — atomic
  const updateTx = db.transaction(() => {
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
      smsBody,
      newBalance
    );
    return result.lastInsertRowid;
  });

  const txId = updateTx();

  res.json({
    success: true,
    transaction_id: txId,
    direction: parsed.direction,
    amount: parsed.amount,
    balance_before: currentBalance,
    balance_after: newBalance,
    sender_receiver: parsed.senderReceiver,
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
