import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../database.js';
import crypto from 'crypto';
import { tid } from '../tenantHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // مجلّد فرعي لكل مستأجر — يعزل الملفات على القرص أيضاً
    try {
      const t = tid(req);
      const dir = path.join(uploadsDir, `t${t}`);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = crypto.randomUUID() + ext;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|pdf)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مسموح'));
    }
  }
});

const router = Router();

// Get all photos
router.get('/', (req, res) => {
  const t = tid(req);
  const photos = db.prepare('SELECT * FROM photos WHERE tenant_id = ? ORDER BY uploaded_at DESC').all(t);
  res.json(photos);
});

// Upload photo
router.post('/', upload.single('photo'), (req, res) => {
  const t = tid(req);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // نخزّن المسار النسبي (t<id>/<uuid>.ext) ليُقرأ من /uploads/...
  const relPath = path.posix.join(`t${t}`, req.file.filename);
  const result = db.prepare(
    'INSERT INTO photos (tenant_id, filename, original_name, notes) VALUES (?, ?, ?, ?)'
  ).run(t, relPath, req.file.originalname, req.body.notes || '');

  res.json({ id: result.lastInsertRowid, filename: relPath });
});

// Update photo notes
router.put('/:id', (req, res) => {
  const t = tid(req);
  const { notes } = req.body;
  const info = db.prepare('UPDATE photos SET notes = ? WHERE id = ? AND tenant_id = ?').run(notes || '', req.params.id, t);
  if (info.changes === 0) return res.status(404).json({ error: 'photo_not_found' });
  res.json({ success: true });
});

// Delete photo
router.delete('/:id', (req, res) => {
  const t = tid(req);
  const photo = db.prepare('SELECT filename FROM photos WHERE id = ? AND tenant_id = ?').get(req.params.id, t);
  if (!photo) return res.status(404).json({ error: 'photo_not_found' });
  const filePath = path.join(uploadsDir, photo.filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
  db.prepare('DELETE FROM photos WHERE id = ? AND tenant_id = ?').run(req.params.id, t);
  res.json({ success: true });
});

export default router;
