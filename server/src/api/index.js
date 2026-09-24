import { openDatabase, SCHEMA_VERSION } from './db.js';
import { createRateLimiter, RULES } from './rateLimit.js';
import { createPlayerStore, playerRoutes } from './players.js';
import { HttpError, sendError, sendJson, readJson, clientIp } from '../http.js';

export const API_PREFIX = '/api/v1';
const DEFAULT_MAX_BODY = 4 * 1024;

// Compiles '/players/:id' into a matcher returning params or null.
function compile(path) {
  const parts = path.split('/').filter(Boolean);
  return segs => {
    if (segs.length !== parts.length) return null;
    const params = {};
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (parts[i] !== segs[i]) return null;
    }
    return params;
  };
}

export async function createApi({ config, log, version, now = Date.now }) {
  const db = openDatabase(config.databasePath);
  const limiter = createRateLimiter({ scale: config.rateLimitScale, now });
  const players = createPlayerStore(db, now);
  const shared = { db, config, log, version, now, limiter, players };

  const routes = [
    {
      method: 'GET',
      path: '/status',
      handler: () => ({
        body: { status: 'ok', version, apiVersion: 1, serverTime: new Date(now()).toISOString(), features: { analytics: config.analyticsEnabled } },
      }),
    },
    ...playerRoutes(shared),
  ].map(r => ({ ...r, match: compile(r.path) }));

  // CORS only for explicitly allowed origins (separate API domain setups). Same-origin
  // requests need no CORS headers at all.
  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!origin || !config.corsOrigins.includes(origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }

  async function handle(req, res, url) {
    const started = now();
    const corsOk = applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(corsOk ? 204 : 403);
      res.end();
      return;
    }

    const path = url.pathname;
    if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) {
      sendError(res, 404, 'not_found', 'Unknown API version or endpoint.');
      return;
    }
    const segs = path.slice(API_PREFIX.length).split('/').filter(Boolean);
    let route = null;
    let params = null;
    let pathMatched = false;
    for (const r of routes) {
      const p = r.match(segs);
      if (!p) continue;
      pathMatched = true;
      if (r.method === req.method) {
        route = r;
        params = p;
        break;
      }
    }

    const ip = clientIp(req, config.trustProxy);
    let status = 500;
    try {
      if (!route) throw pathMatched ? new HttpError(405, 'method_not_allowed', 'Method not allowed.') : new HttpError(404, 'not_found', 'Unknown endpoint.');
      const global = limiter.take(RULES.global, ip);
      if (!global.ok) throw new HttpError(429, 'rate_limited', 'Too many requests. Slow down.', { retryAfter: global.retryAfter });

      const ctx = {
        req,
        url,
        params,
        ip,
        log,
        body: () => readJson(req, route.maxBody || DEFAULT_MAX_BODY),
        player: null,
      };
      if (route.auth) {
        ctx.player = players.authenticate(req.headers.authorization);
        if (!ctx.player) throw new HttpError(401, 'unauthorized', 'Missing or invalid player token.');
      }
      const out = (await route.handler(ctx)) || {};
      status = out.status || 200;
      if (status === 204) {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
      } else {
        sendJson(res, status, out.body || {}, out.headers);
      }
    } catch (err) {
      if (err instanceof HttpError) {
        status = err.status;
        if (err.status === 429 && err.extra.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
        sendError(res, err.status, err.code, err.message, err.extra);
      } else {
        status = 500;
        log.error('api error', { path, error: err.message, stack: config.isProd ? undefined : err.stack });
        sendError(res, 500, 'internal', 'Something went wrong.');
      }
    } finally {
      // Never log tokens, bodies or query strings — only what's needed to operate the service.
      log.debug('api', { method: req.method, path, status, ms: now() - started });
    }
  }

  function healthy() {
    try {
      db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  function close() {
    limiter.close();
    db.close();
  }

  log.info('database ready', { schema: SCHEMA_VERSION });
  return { handle, healthy, close, db };
}
