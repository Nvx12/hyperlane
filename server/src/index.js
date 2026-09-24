import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './app.js';
import { createApi } from './api/index.js';

const config = loadConfig();
const log = createLogger({ level: config.logLevel, json: config.isProd });
const { version } = JSON.parse(readFileSync(resolve(config.root, 'package.json'), 'utf8'));

// The game itself never depends on the API: if the database can't open, keep serving the
// game (offline/local mode) and report "degraded" on /health so the platform can alert.
let api = null;
try {
  api = await createApi({ config, log, version });
} catch (err) {
  log.error('API unavailable — serving the game only', { error: err.message });
}

const server = createServer(createApp({ config, log, api, version }));
server.keepAliveTimeout = 10_000;
server.headersTimeout = 15_000;
server.requestTimeout = 20_000;

server.listen(config.port, config.host, () => {
  log.info('server started', {
    version,
    env: config.appEnv,
    port: config.port,
    static: config.staticDir.replace(config.root, '.'),
    database: api ? (config.databasePath === ':memory:' ? 'memory' : 'file') : 'none',
  });
  if (config.generatedSecret) log.warn('SESSION_SECRET not set — using a random dev secret (race sessions reset on restart)');
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish, close the DB.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });
  const force = setTimeout(() => {
    log.warn('forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  force.unref();
  server.close(() => {
    if (api) api.close();
    log.info('shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', err => log.error('unhandled rejection', { error: String(err && err.message) }));
