import http from 'node:http';
import env from './config/env.js';
import logger from './utils/logger.js';
import app from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { verifyAgainstDummy } from './services/password.js';
import { initRealtime, closeRealtime } from './realtime/index.js';
import { startCleanupJob } from './services/cleanup.js';

async function main() {
  await connectDb();
  await verifyAgainstDummy('warmup'); // pre-compute the dummy hash so the first login is not slower than later ones

  const server = http.createServer(app);
  initRealtime(server);
  const stopCleanup = startCleanupJob();
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, 'MeetSpace server listening'));

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    stopCleanup();
    closeRealtime().then(async () => { await disconnectDb(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => { logger.error({ err: { message: err?.message } }, 'unhandledRejection'); process.exit(1); });
main().catch((err) => { logger.error({ err: { message: err.message } }, 'startup failed'); process.exit(1); });