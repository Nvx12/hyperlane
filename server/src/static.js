import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlib } from 'node:zlib';
import { transformHtml } from './htmlTransform.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);
// Files that must always be revalidated so updates reach players (the SW does offline caching).
const LONG_CACHE_DIRS = ['fonts/', 'icons/'];

// Serves the client directory. Small files are read once, compressed once, and kept in memory
// keyed by mtime, so steady-state requests never touch the disk or the compressor.
export function createStaticHandler(config, { extraRoutes = {} } = {}) {
  const cache = new Map();
  const htmlOptions = { publicUrl: config.publicUrl, apiUrl: config.apiUrl, appEnv: config.appEnv };

  async function load(rel, file) {
    const info = await stat(file);
    if (!info.isFile()) return null;
    const hit = cache.get(rel);
    if (hit && hit.mtime === info.mtimeMs) return hit;
    let body = await readFile(file);
    const ext = extname(file).toLowerCase();
    if (ext === '.html') body = Buffer.from(transformHtml(body.toString('utf8'), htmlOptions));
    const entry = {
      mtime: info.mtimeMs,
      ext,
      body,
      etag: `W/"${body.length.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
      br: null,
      gzip: null,
    };
    if (COMPRESSIBLE.has(ext) && body.length > 1024) {
      entry.br = brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 9 } });
      entry.gzip = gzipSync(body, { level: 9 });
    }
    cache.set(rel, entry);
    return entry;
  }

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel;
    try {
      rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch {
      return false;
    }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    if (extraRoutes[rel]) return extraRoutes[rel](req, res);
    const file = normalize(join(config.staticDir, rel));
    // Path traversal guard + never serve dotfiles.
    if (!file.startsWith(config.staticDir + sep) || rel.split('/').some(p => p.startsWith('.'))) return false;

    let entry;
    try {
      entry = await load(rel, file);
    } catch {
      return false;
    }
    if (!entry) return false;

    const headers = {
      'Content-Type': MIME[entry.ext] || 'application/octet-stream',
      ETag: entry.etag,
      'Cache-Control': LONG_CACHE_DIRS.some(d => rel.startsWith(d)) ? 'public, max-age=604800' : 'no-cache',
      Vary: 'Accept-Encoding',
    };
    if (rel === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    const accept = req.headers['accept-encoding'] || '';
    let body = entry.body;
    if (entry.br && /\bbr\b/.test(accept)) {
      body = entry.br;
      headers['Content-Encoding'] = 'br';
    } else if (entry.gzip && /\bgzip\b/.test(accept)) {
      body = entry.gzip;
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
