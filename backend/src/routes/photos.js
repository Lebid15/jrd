import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../database.js';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
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
  const photos = db.prepare('SELECT * FROM photos ORDER BY uploaded_at DESC').all();
  res.json(photos);
});

// Upload photo
router.post('/', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const result = db.prepare(
    'INSERT INTO photos (filename, original_name, notes) VALUES (?, ?, ?)'
  ).run(req.file.filename, req.file.originalname, req.body.notes || '');

  res.json({ id: result.lastInsertRowid, filename: req.file.filename });
});

// Update photo notes
router.put('/:id', (req, res) => {
  const { notes } = req.body;
  db.prepare('UPDATE photos SET notes = ? WHERE id = ?').run(notes || '', req.params.id);
  res.json({ success: true });
});

// Delete photo
router.delete('/:id', (req, res) => {
  const photo = db.prepare('SELECT filename FROM photos WHERE id = ?').get(req.params.id);
  if (photo) {
    const filePath = path.join(uploadsDir, photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.id);
  }
  res.json({ success: true });
});

export default router;
