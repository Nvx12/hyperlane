import { createStaticHandler } from './static.js';
import { securityHeaders } from './security.js';
import { sendJson, sendError } from './http.js';

// Builds the single request handler: security headers → /health → /api → static files.
export function createApp({ config, log, api = null, version }) {
  const baseHeaders = securityHeaders(config);
  const serveStatic = createStaticHandler(config, api ? { extraRoutes: api.staticRoutes || {} } : {});
  const startedAt = Date.now();

  return async function handle(req, res) {
    for (const [k, v] of Object.entries(baseHeaders)) res.setHeader(k, v);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendError(res, 400, 'bad_request', 'Malformed URL.');
    }
    const path = url.pathname;
    try {
      if (path === '/health') {
        // Liveness: 200 while the process serves requests. The game works without the
        // database, so a DB problem reports "degraded" instead of failing the check.
        const dbOk = Boolean(api && api.healthy());
        return sendJson(res, 200, {
          status: dbOk ? 'ok' : 'degraded',
          database: dbOk ? 'ok' : 'unavailable',
          version,
          uptime: Math.round((Date.now() - startedAt) / 1000),
        }, { 'Cache-Control': 'no-store' });
      }
      if (path === '/api' || path.startsWith('/api/')) {
        if (!api) return sendError(res, 404, 'not_found', 'Unknown endpoint.');
        return await api.handle(req, res, url);
      }
      if (await serveStatic(req, res, path)) return undefined;
      return sendError(res, 404, 'not_found', 'Not found.');
    } catch (err) {
      log.error('unhandled request error', { path, error: err.message, stack: config.isProd ? undefined : err.stack });
      if (!res.headersSent) return sendError(res, 500, 'internal', 'Something went wrong.');
      res.end();
      return undefined;
    }
  };
}
