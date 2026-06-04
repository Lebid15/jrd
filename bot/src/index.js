import 'dotenv/config';
import express from 'express';
import { config } from './config.js';
import logger from './logger.js';
import router from './server.js';
import { bootstrap } from './sessionManager.js';

const app = express();
app.use(express.json());
app.use(router);

app.listen(config.botPort, config.botHost, async () => {
  logger.info({ port: config.botPort }, 'Bot server started');
  await bootstrap();
});
