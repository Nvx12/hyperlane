import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/server.js';

let srv;
beforeEach(async () => {
  srv = await startTestServer();
});
afterEach(() => srv.close());

async function player(name = 'Tester') {
  const r = await srv.call('POST', '/api/v1/players', { body: { displayName: name } });
  return r.json.token;
}
async function start(token, carId = 'vireo') {
  const r = await srv.call('POST', '/api/v1/races', { token, body: { carId, envId: 'neon', clientVersion: '1.0.0' } });
  assert.equal(r.status, 201);
  return r.json.sessionId;
}
// A believable 2-minute run: ~180 km/h average.
const goodRun = (over = {}) => ({
  score: 42000, distance: 6000, topSpeed: 228, bestCombo: 5, durationMs: 120_000,
  nearMisses: 24, overtakes: 60, perfectOvertakes: 6, ...over,
});
const finish = (token, id, run) => srv.call('POST', `/api/v1/races/${id}/finish`, { token, body: run });

test('a plausible run is accepted and ranked', async () => {
  const token = await player();
  const id = await start(token);
  srv.advance(125_000);
  const r = await finish(token, id, goodRun());
  assert.equal(r.status, 200);
  assert.equal(r.json.accepted, true);
  assert.equal(r.json.personalBest, true);
  assert.deepEqual(r.json.ranks.day, { rank: 1, value: 42000 });
});

test('finishing is idempotent for the same payload, and single-use otherwise', async () => {
  const token = await player();
  const id = await start(token);
  srv.advance(125_000);
  assert.equal((await finish(token, id, goodRun())).json.accepted, true);
  const retry = await finish(token, id, goodRun());
  assert.equal(retry.status, 200);
  assert.equal(retry.json.accepted, true);
  const replay = await finish(token, id, goodRun({ score: 99000 }));
  assert.equal(replay.status, 409);
  const count = srv.api.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n;
  assert.equal(count, 1);
});

test('rejects runs longer than the real time that passed (speed hacks)', async () => {
  const token = await player();
  const id = await start(token);
  srv.advance(30_000); // only 30 s really passed…
  const r = await finish(token, id, goodRun()); // …but the run claims 2 minutes
  assert.equal(r.json.accepted, false);
  assert.ok(!('reason' in r.json), 'exact reason must not be disclosed');
});

test('rejects impossible numbers', async () => {
  const token = await player();
  const cases = [
    goodRun({ topSpeed: 900 }),
    goodRun({ distance: 60_000 }), // 1800 km/h average
    goodRun({ score: 50_000_000 }),
    goodRun({ nearMisses: 5000 }),
    goodRun({ perfectOvertakes: 80 }),
    goodRun({ bestCombo: 10, nearMisses: 0, overtakes: 0, distance: 300, topSpeed: 200, durationMs: 10_000, score: 500 }),
  ];
  for (const run of cases) {
    const id = await start(token);
    srv.advance(125_000);
    const r = await finish(token, id, run);
    assert.equal(r.json.accepted, false, JSON.stringify(run));
  }
  assert.equal(srv.api.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 0);
});

test('rejects malformed payloads', async () => {
  const token = await player();
  const id = await start(token);
  srv.advance(60_000);
  for (const run of [goodRun({ bestCombo: 4 }), goodRun({ score: -1 }), goodRun({ score: 1.5 }), goodRun({ distance: 'far' }), {}]) {
    const r = await finish(token, id, run);
    assert.equal(r.status, 422, JSON.stringify(run));
  }
});

test('sessions: unknown car, other players, expiry, one live session', async () => {
  const a = await player('Alpha');
  const b = await player('Bravo');
  const bad = await srv.call('POST', '/api/v1/races', { token: a, body: { carId: 'batmobile', envId: 'neon', clientVersion: '1.0.0' } });
  assert.equal(bad.status, 422);

  const id = await start(a);
  srv.advance(125_000);
  assert.equal((await finish(b, id, goodRun())).status, 404, 'cannot finish someone else\'s session');

  const first = await start(a);
  const second = await start(a); // starting again closes the previous live session
  srv.advance(125_000);
  assert.equal((await finish(a, first, goodRun())).status, 409);
  assert.equal((await finish(a, second, goodRun())).json.accepted, true);

  const old = await start(a);
  srv.advance(4 * 60 * 60_000);
  assert.equal((await finish(a, old, goodRun())).status, 409);
});

test('leaderboard: best per player, periods, me, no ids exposed', async () => {
  const a = await player('Alpha');
  const b = await player('Bravo');
  for (const [token, score] of [[a, 30000], [a, 45000], [b, 40000]]) {
    const id = await start(token);
    srv.advance(125_000);
    assert.equal((await finish(token, id, goodRun({ score }))).json.accepted, true);
  }
  const board = await srv.call('GET', '/api/v1/leaderboard?category=score&period=all', { token: b });
  assert.equal(board.status, 200);
  assert.deepEqual(board.json.entries.map(e => [e.rank, e.name, e.value, e.me]), [[1, 'Alpha', 45000, false], [2, 'Bravo', 40000, true]]);
  assert.deepEqual(board.json.me, { rank: 2, value: 40000 });
  assert.ok(!JSON.stringify(board.json).includes('p_'), 'player ids must not be exposed');

  const speed = await srv.call('GET', '/api/v1/leaderboard?category=speed&period=day');
  assert.equal(speed.json.entries.length, 2);
  assert.equal(speed.json.me, null);

  srv.advance(8 * 86_400_000); // next week: period boards empty, all-time kept
  const week = await srv.call('GET', '/api/v1/leaderboard?category=score&period=week');
  assert.equal(week.json.entries.length, 0);

  const me = await srv.call('GET', '/api/v1/leaderboard/me', { token: a });
  assert.equal(me.json.standings.score.all.rank, 1);
  assert.equal(me.json.standings.score.day, null);

  assert.equal((await srv.call('GET', '/api/v1/leaderboard?category=hacks')).status, 400);
  assert.equal((await srv.call('GET', '/api/v1/leaderboard?period=forever')).status, 400);
});

test('deleting a player removes their leaderboard entries', async () => {
  const a = await player('Alpha');
  const id = await start(a);
  srv.advance(125_000);
  await finish(a, id, goodRun());
  assert.equal((await srv.call('DELETE', '/api/v1/players/me', { token: a })).status, 204);
  srv.advance(11_000); // past the board cache
  const board = await srv.call('GET', '/api/v1/leaderboard?period=all');
  assert.equal(board.json.entries.length, 0);
});
