// Abuse cases: things a hostile client would try against the public server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startTestServer } from '../helpers/server.js';

let srv;
before(async () => {
  srv = await startTestServer();
});
after(() => srv.close());

// Raw request (fetch normalises paths, so traversal attempts need the low-level client).
function raw(path, method = 'GET') {
  const { hostname, port } = new URL(srv.base);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('path traversal and dotfiles are not served', async () => {
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/server/src/config.js', '/js/../../.env', '/.git/config', '/.env', '/css/%2e%2e/%2e%2e/package.json']) {
    const r = await raw(p);
    assert.ok(r.status === 404 || r.status === 400, `${p} → ${r.status}`);
    assert.ok(!r.body.includes('"devDependencies"') && !r.body.includes('loadConfig'), p);
  }
});

test('server source and data are unreachable over HTTP', async () => {
  for (const p of ['/server/src/index.js', '/data/nightvector.db', '/package.json', '/tests/api/security.test.js']) {
    assert.equal((await raw(p)).status, 404, p);
  }
});

test('SQL injection in names and query parameters is inert', async () => {
  const inj = await srv.call('POST', '/api/v1/players', { body: { displayName: "x'); DROP TABLE players;--" } });
  assert.equal(inj.status, 422);
  const lb = await srv.call('GET', `/api/v1/leaderboard?category=${encodeURIComponent("score; DROP TABLE scores")}&period=all`);
  assert.equal(lb.status, 400);
  const id = await srv.call('POST', `/api/v1/races/${encodeURIComponent("' OR 1=1 --")}/finish`, { body: {} });
  assert.equal(id.status, 401);
  assert.ok(srv.api.healthy());
  assert.equal(srv.api.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'players'").get().n, 1);
});

test('markup in display names is rejected', async () => {
  for (const displayName of ['<b>bold</b>', '"><svg onload=1>', 'name\u0000null', 'zero​width', 'emoji 🚗']) {
    assert.equal((await srv.call('POST', '/api/v1/players', { body: { displayName } })).status, 422, JSON.stringify(displayName));
  }
});

test('prototype-pollution payloads do nothing', async () => {
  const body = '{"displayName":"Proto Test","__proto__":{"admin":true},"constructor":{"prototype":{"polluted":1}}}';
  const r = await srv.call('POST', '/api/v1/players', { raw: body, headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 201);
  assert.equal({}.admin, undefined);
  assert.equal({}.polluted, undefined);
});

test('forged, reused and cross-player tokens are refused', async () => {
  const a = (await srv.call('POST', '/api/v1/players', { body: { displayName: 'Token A' } })).json.token;
  const forged = a.slice(0, -1) + (a.endsWith('A') ? 'B' : 'A');
  assert.equal((await srv.call('GET', '/api/v1/players/me', { token: forged })).status, 401);
  assert.equal((await srv.call('GET', '/api/v1/players/me', { headers: { authorization: `Basic ${a}` } })).status, 401);
  assert.equal((await srv.call('GET', '/api/v1/players/me', { headers: { authorization: 'Bearer ' } })).status, 401);
});

test('the global limiter stops floods', async () => {
  const s = await startTestServer();
  try {
    let limited = 0;
    for (let i = 0; i < 260; i++) if ((await s.call('GET', '/api/v1/status')).status === 429) limited++;
    assert.ok(limited > 0, 'flood gets 429s');
  } finally {
    await s.close();
  }
});

test('deeply nested or huge JSON is bounded', async () => {
  const deep = '['.repeat(3000) + ']'.repeat(3000);
  const r = await srv.call('POST', '/api/v1/players', { raw: deep, headers: { 'content-type': 'application/json' } });
  assert.ok([400, 413, 422].includes(r.status), String(r.status));
  assert.ok(srv.api.healthy());
});

test('non-production deployments are never indexed; production is', async () => {
  const r = await raw('/robots.txt');
  assert.match(r.body, /Disallow: \/\n/);
  assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  // STATIC_DIR pinned so the test doesn't depend on whether dist/ was built.
  const prod = await startTestServer({ APP_ENV: 'production', PUBLIC_URL: 'https://game.example', STATIC_DIR: 'client' });
  try {
    const robots = await fetch(`${prod.base}/robots.txt`);
    const text = await robots.text();
    assert.match(text, /Allow: \//);
    assert.match(text, /Disallow: \/api\//);
    assert.match(text, /Sitemap: https:\/\/game\.example\/sitemap\.xml/);
    assert.equal(robots.headers.get('x-robots-tag'), null);
    const sitemap = await (await fetch(`${prod.base}/sitemap.xml`)).text();
    assert.match(sitemap, /<loc>https:\/\/game\.example\/<\/loc>/);
    const html = await (await fetch(`${prod.base}/`)).text();
    assert.match(html, /"url":"https:\/\/game\.example\/"/);
    assert.ok(!html.includes('__PUBLIC_URL__'));
  } finally {
    await prod.close();
  }
});

test('health and errors never reveal internals', async () => {
  const h = await srv.call('GET', '/health');
  assert.deepEqual(Object.keys(h.json).sort(), ['database', 'status', 'uptime', 'version']);
  const e = await srv.call('GET', '/api/v1/nope');
  assert.ok(!/node_modules|\\|\/src\//.test(e.text));
  const headers = (await raw('/')).headers;
  assert.equal(headers['x-powered-by'], undefined);
  assert.equal(headers['x-frame-options'], 'DENY');
});
