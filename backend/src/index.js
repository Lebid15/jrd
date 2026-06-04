import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import itemsRouter from './routes/items.js';
import inventoryRouter from './routes/inventory.js';
import settingsRouter from './routes/settings.js';
import photosRouter from './routes/photos.js';
import apiConfigsRouter from './routes/apiConfigs.js';
import bankRouter from './routes/bank.js';
import internalRouter from './routes/internal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve uploaded photos
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads')));

// Healthcheck (Railway)
app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

// API routes
app.use('/api/items', itemsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/photos', photosRouter);
app.use('/api/configs', apiConfigsRouter);
app.use('/api/bank', bankRouter);
app.use('/api/internal', internalRouter);

// Serve frontend static files in production
const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
