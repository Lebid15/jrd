import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import itemsRouter from './routes/items.js';
import inventoryRouter from './routes/inventory.js';
import settingsRouter from './routes/settings.js';
import photosRouter from './routes/photos.js';
import apiConfigsRouter from './routes/apiConfigs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve uploaded photos
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// API routes
app.use('/api/items', itemsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/photos', photosRouter);
app.use('/api/configs', apiConfigsRouter);

// Serve frontend static files in production
const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
