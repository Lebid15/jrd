/**
 * مساعدات scope المستأجر.
 *
 * كل route يستدعي tid(req) للحصول على tenant_id الحالي.
 * - للمستخدم العادي (owner): يُرجع req.user.tenant_id (دائماً INTEGER).
 * - للـ admin (tenant_id=NULL): يبحث عن tenant_id في header X-Tenant-Id أو query ?tenant_id.
 *   لو لم يحدّد admin مستأجراً → يرمي 400.
 *
 * الاستخدام داخل route:
 *   const t = tid(req);   // قد يرمي → يصل لـ Express error handler
 *   db.prepare('SELECT * FROM items WHERE tenant_id = ?').all(t);
 */

export function tid(req) {
  const user = req.user;
  if (!user) {
    const e = new Error('unauthenticated');
    e.status = 401;
    throw e;
  }
  if (user.tenant_id != null) return user.tenant_id;

  // admin: يجب أن يحدّد tenant
  const raw = req.headers['x-tenant-id'] || req.query.tenant_id;
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n <= 0) {
    const e = new Error('tenant_id_required: admin must specify X-Tenant-Id header or ?tenant_id= query');
    e.status = 400;
    throw e;
  }
  return n;
}

// middleware يستدعى قبل routes لضمان tid متاح (يضع req.tenantId)
export function attachTenant(req, res, next) {
  try {
    req.tenantId = tid(req);
    next();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// Wrapper لـ async/sync handler يلتقط أخطاء tid ويُرجع status صحيح.
export function withTenant(handler) {
  return (req, res, next) => {
    try {
      req.tenantId = tid(req);
      const out = handler(req, res, next);
      if (out && typeof out.catch === 'function') {
        out.catch((e) => {
          if (!res.headersSent) res.status(e.status || 500).json({ error: e.message });
        });
      }
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  };
}
