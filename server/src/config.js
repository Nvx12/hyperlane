import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Minimal .env loader (KEY=VALUE lines) so local development needs no dependency.
// Real environment variables always win over the file.
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const bool = (v, fallback) => (v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v));
const int = (v, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

export function loadConfig(overrides = {}) {
  loadDotEnv(resolve(ROOT, '.env'));
  const env = { ...process.env, ...overrides };
  const appEnv = ['development', 'staging', 'production', 'test'].includes(env.APP_ENV) ? env.APP_ENV
    : env.NODE_ENV === 'production' ? 'production' : 'development';
  const isProd = appEnv === 'production' || appEnv === 'staging';

  const dist = resolve(ROOT, 'dist');
  const staticDir = env.STATIC_DIR ? resolve(ROOT, env.STATIC_DIR)
    : isProd && existsSync(dist) ? dist : resolve(ROOT, 'client');

  let sessionSecret = env.SESSION_SECRET || '';
  const generatedSecret = !sessionSecret;
  if (generatedSecret) {
    if (isProd) throw new Error('SESSION_SECRET must be set in staging/production (use a long random string).');
    sessionSecret = randomBytes(32).toString('hex'); // dev: sessions simply don't survive restarts
  }

  return Object.freeze({
    root: ROOT,
    appEnv,
    isProd,
    host: env.HOST || '0.0.0.0',
    port: int(env.PORT, 8080),
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    apiUrl: (env.API_URL || '').replace(/\/+$/, ''),
    staticDir,
    databasePath: env.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(ROOT, env.DATABASE_PATH || 'data/nightvector.db'),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    sessionSecret,
    generatedSecret,
    trustProxy: bool(env.TRUST_PROXY, false),
    analyticsEnabled: bool(env.ANALYTICS_ENABLED, true),
    rateLimitScale: Math.max(0.1, Number(env.RATE_LIMIT_SCALE) || 1), // tests / staging can relax limits
    logLevel: env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  });
}
