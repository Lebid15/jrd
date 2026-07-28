import { Router } from 'express';
import db from '../database.js';
import { tid } from '../tenantHelpers.js';

const router = Router();

// سجل تغييرات البنود اليدوية — الأحدث أوّلاً.
// فلاتر اختيارية: item_id, from (YYYY-MM-DD), to (YYYY-MM-DD), limit, offset.
router.get('/', (req, res) => {
  const t = tid(req);
  const { item_id, from, to } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;

  let where = 'WHERE tenant_id = ?';
  const params = [t];
  if (item_id) { where += ' AND item_id = ?'; params.push(parseInt(item_id)); }
  if (from) { where += ' AND created_at >= ?'; params.push(from); }
  if (to) { where += " AND created_at <= ?"; params.push(`${to} 23:59:59`); }

  const logs = db.prepare(
    `SELECT id, item_id, item_name, field, old_value, new_value, delta, changed_by, created_at
       FROM item_change_log ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS count FROM item_change_log ${where}`).get(...params).count;

  res.json({ logs, total });
});

// حذف السجل بالكامل لهذا المستأجر (تفريغ السجل).
router.delete('/', (req, res) => {
  const t = tid(req);
  const info = db.prepare('DELETE FROM item_change_log WHERE tenant_id = ?').run(t);
  res.json({ success: true, deleted: info.changes });
});

export default router;
