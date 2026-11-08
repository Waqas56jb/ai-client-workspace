import { createApp } from './app.js';
import { env, safeConfigSummary } from './config/env.js';
import { getDatabase } from './config/db.js';
import { logger } from './utils/logger.js';
import { drainQueue, startRunReconciliation } from './jobs/generationQueue.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ config: safeConfigSummary(), node: process.version }, `API listening on port ${env.PORT}`);
  // Runs that were in flight when a previous process stopped can never finish.
  startRunReconciliation();
});
// A proxy in front (CloudFront keeps idle connections 60 s) must never reuse a connection
// Node has already closed — that surfaces as a random 502. Keep ours open longer.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  server.close();
  const interrupted = await drainQueue().catch(() => 0);
  if (interrupted) logger.warn({ interrupted }, 'generation runs interrupted by shutdown');
  await getDatabase().close().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ reason: String(reason) }, 'unhandled rejection'));
