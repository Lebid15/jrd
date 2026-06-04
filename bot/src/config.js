import 'dotenv/config';

export const config = {
  backendUrl: process.env.BACKEND_URL || 'http://127.0.0.1:3001',
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  botPort: parseInt(process.env.BOT_PORT || '3100'),
  botHost: process.env.BOT_HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  replyDelayMin: parseInt(process.env.REPLY_DELAY_MIN_MS || '1500'),
  replyDelayMax: parseInt(process.env.REPLY_DELAY_MAX_MS || '4000'),
  encryptionKey: process.env.BOT_ENCRYPTION_KEY || '',
  authDir: process.env.AUTH_DIR || './auth_sessions',
};

if (!config.internalApiKey) {
  console.error('INTERNAL_API_KEY is required');
  process.exit(1);
}
