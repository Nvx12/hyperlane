import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/server.js';
import { validateDisplayName } from '../../server/src/api/names.js';

let srv;
before(async () => {
  srv = await startTestServer();
});
after(() => srv.close());

test('health reports database ok', async () => {
  const r = await srv.call('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'ok');
  assert.equal(r.json.database, 'ok');
});

test('status endpoint', async () => {
  const r = await srv.call('GET', '/api/v1/status');
  assert.equal(r.status, 200);
  assert.equal(r.json.apiVersion, 1);
});

test('create, read, rename and delete a player', async () => {
  const created = await srv.call('POST', '/api/v1/players', { body: { displayName: '  Neon   Rider ' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.player.displayName, 'Neon Rider');
  assert.match(created.json.token, /^[A-Za-z0-9_-]{43}$/);
  const { token } = created.json;

  const me = await srv.call('GET', '/api/v1/players/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.json.player.id, created.json.player.id);
  assert.equal(me.json.player.best, null);

  const renamed = await srv.call('PATCH', '/api/v1/players/me', { token, body: { displayName: 'Vector_7' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.player.displayName, 'Vector_7');

  const del = await srv.call('DELETE', '/api/v1/players/me', { token });
  assert.equal(del.status, 204);
  const gone = await srv.call('GET', '/api/v1/players/me', { token });
  assert.equal(gone.status, 401);
});

test('token is stored hashed, never in plain text', async () => {
  const created = await srv.call('POST', '/api/v1/players', { body: { displayName: 'Hashcheck' } });
  const row = srv.api.db.prepare('SELECT token_hash FROM players WHERE id = ?').get(created.json.player.id);
  assert.notEqual(row.token_hash, created.json.token);
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
});

test('rejects invalid names', async () => {
  for (const displayName of ['ab', 'x'.repeat(17), '<script>', 'admin', '___', 'sh1thead', 42, null]) {
    const r = await srv.call('POST', '/api/v1/players', { body: { displayName } });
    assert.equal(r.status, 422, `expected 422 for ${JSON.stringify(displayName)}`);
    assert.equal(r.json.error.code, 'invalid_name');
  }
});

test('name screening avoids obvious false positives', () => {
  for (const ok of ['Grapevine', 'Spicy Taco', 'Scunthorpe 2', 'Mod Squad']) assert.equal(validateDisplayName(ok).ok, true, ok);
  for (const bad of ['rape', 'NAZI boy', 'F u c k', 'Administrator']) assert.equal(validateDisplayName(bad).ok, false, bad);
});

test('auth failures', async () => {
  assert.equal((await srv.call('GET', '/api/v1/players/me')).status, 401);
  assert.equal((await srv.call('GET', '/api/v1/players/me', { token: 'nope' })).status, 401);
  assert.equal((await srv.call('GET', '/api/v1/players/me', { token: 'A'.repeat(43) })).status, 401);
});

test('malformed and oversized bodies', async () => {
  const bad = await srv.call('POST', '/api/v1/players', { raw: '{nope', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  const wrongType = await srv.call('POST', '/api/v1/players', { raw: 'displayName=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(wrongType.status, 415);
  const huge = await srv.call('POST', '/api/v1/players', { body: { displayName: 'Big', pad: 'x'.repeat(20000) } });
  assert.equal(huge.status, 413);
});

test('unknown endpoints and methods', async () => {
  assert.equal((await srv.call('GET', '/api/v1/nope')).status, 404);
  assert.equal((await srv.call('GET', '/api/v2/status')).status, 404);
  assert.equal((await srv.call('PUT', '/api/v1/players/me')).status, 405);
});

test('errors never leak stack traces', async () => {
  const r = await srv.call('POST', '/api/v1/players', { raw: '{nope', headers: { 'content-type': 'application/json' } });
  assert.deepEqual(Object.keys(r.json.error).sort(), ['code', 'message']);
  assert.ok(!/at .*\.js/.test(r.text));
});

test('player creation is rate limited per IP', async () => {
  const s = await startTestServer();
  try {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await s.call('POST', '/api/v1/players', { body: { displayName: `Racer ${i}` } })).status);
    assert.deepEqual(codes.slice(0, 5), [201, 201, 201, 201, 201]);
    const limited = await s.call('POST', '/api/v1/players', { body: { displayName: 'Racer X' } });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    s.advance(60 * 60_000);
    assert.equal((await s.call('POST', '/api/v1/players', { body: { displayName: 'Racer Y' } })).status, 201);
  } finally {
    await s.close();
  }
});

test('CORS only for allowed origins', async () => {
  const s = await startTestServer({ CORS_ORIGINS: 'https://game.example' });
  try {
    const ok = await s.call('OPTIONS', '/api/v1/players', { headers: { origin: 'https://game.example' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://game.example');
    const denied = await s.call('OPTIONS', '/api/v1/players', { headers: { origin: 'https://evil.example' } });
    assert.equal(denied.status, 403);
    const get = await s.call('GET', '/api/v1/status', { headers: { origin: 'https://evil.example' } });
    assert.equal(get.headers.get('access-control-allow-origin'), null);
  } finally {
    await s.close();
  }
});
