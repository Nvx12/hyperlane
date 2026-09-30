// Cloud progression: the server is the authority for online accounts. Every test checks the
// database state after the operation, not just the HTTP answer.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from '../helpers/server.js';
import { openDatabase, MIGRATIONS, SCHEMA_VERSION } from '../../server/src/api/db.js';
import { hashToken } from '../../server/src/api/players.js';
import { totalXpForLevel, upgradePrice } from '../../client/js/progression/engine.js';
import { CAR_PROGRESSION, GUEST_IMPORT } from '../../client/js/progression/config.js';

let srv;
beforeEach(async () => {
  srv = await startTestServer();
});
afterEach(() => srv.close());

const db = () => srv.api.db;
async function account(name = 'Cloud Tester') {
  const r = await srv.call('POST', '/api/v1/players', { body: { displayName: name } });
  assert.equal(r.status, 201);
  return { token: r.json.token, id: r.json.player.id, created: r.json };
}
const sync = (token, ops) => srv.call('POST', '/api/v1/sync', { token, body: { ops } });
const row = id => db().prepare('SELECT * FROM player_progress WHERE player_id = ?').get(id);
const carRow = (id, car) => db().prepare('SELECT * FROM player_cars WHERE player_id = ? AND car_id = ?').get(id, car);
const grant = (id, { credits, level }) => {
  if (credits !== undefined) db().prepare('UPDATE player_progress SET credits = ? WHERE player_id = ?').run(credits, id);
  if (level !== undefined) db().prepare('UPDATE player_progress SET xp = ?, level = ? WHERE player_id = ?').run(totalXpForLevel(level), level, id);
};
let seq = 0;
const opId = () => `op-test-${String(++seq).padStart(6, '0')}`;
// A believable ~2 minute run in the starter car.
const run = (over = {}) => ({
  carId: 'vireo', envId: 'neon', score: 42000, distance: 6000, topSpeed: 228, bestCombo: 5, durationMs: 120_000,
  nearMisses: 12, insaneMisses: 2, overtakes: 60, perfectOvertakes: 6, chicanes: 2, pickups: 3, creditChips: 0,
  crashes: 1, policeEscapes: 0, legendPasses: 0, longestChase: 0, boostTime: 14, highSpeedTime: 40, bestCleanDistance: 3000, ...over,
});

test('a new account gets its progression rows: starter car, zero credits, level 1', async () => {
  const { id, created } = await account();
  assert.equal(created.revision, 0);
  assert.deepEqual(created.progress.ownedCars, ['vireo']);
  const p = row(id);
  assert.equal(p.credits, 0);
  assert.equal(p.level, 1);
  assert.equal(p.selected_car, 'vireo');
  assert.ok(carRow(id, 'vireo'));
  assert.equal(JSON.parse(p.missions).active.length, 3);
  assert.ok(db().prepare('SELECT 1 FROM player_stats WHERE player_id = ?').get(id));
  const cars = db().prepare('SELECT id, tier, price FROM cars ORDER BY sort_order').all();
  assert.equal(cars.length, 7);
  assert.deepEqual({ ...cars.find(c => c.id === 'aurora') }, { id: 'aurora', tier: 5, price: CAR_PROGRESSION.aurora.price });
});

test('an online race pays out on the server, once, and ranks', async () => {
  const { token, id } = await account();
  const start = await srv.call('POST', '/api/v1/races', { token, body: { carId: 'vireo', envId: 'neon', clientVersion: '1.2.0' } });
  srv.advance(125_000);
  const op = { opId: opId(), type: 'race', sessionId: start.json.sessionId, run: run() };
  const r = await sync(token, [op]);
  assert.equal(r.status, 200);
  assert.equal(r.json.results[0].ok, true);
  const credits = r.json.progress.credits;
  assert.ok(credits > 0);
  assert.equal(row(id).credits, credits);
  assert.equal(row(id).revision, 1);
  const race = db().prepare('SELECT * FROM race_results WHERE player_id = ?').get(id);
  assert.equal(race.status, 'accepted');
  assert.equal(race.source, 'online');
  assert.equal(race.credits_awarded, credits);
  assert.equal(db().prepare('SELECT COUNT(*) AS n FROM scores WHERE player_id = ?').get(id).n, 1);
  assert.ok(db().prepare("SELECT 1 FROM player_achievements WHERE player_id = ? AND achievement_id = 'first_ride'").get(id), 'achievement stored');
  assert.equal(db().prepare('SELECT races FROM player_stats WHERE player_id = ?').get(id).races, 1);

  // Retrying the same operation (lost response) never pays twice.
  const again = await sync(token, [op]);
  assert.equal(again.json.results[0].duplicate, true);
  assert.equal(row(id).credits, credits);
  assert.equal(db().prepare('SELECT COUNT(*) AS n FROM race_results').get().n, 1);
});

test('offline races count, but only as much race time as really passed', async () => {
  const { token, id } = await account();
  srv.advance(10 * 60_000); // 10 minutes offline
  const two = [run({ durationMs: 150_000, distance: 7000 }), run({ durationMs: 140_000, distance: 6500 })].map(r => ({ opId: opId(), type: 'race', run: r }));
  const r = await sync(token, two);
  assert.deepEqual(r.json.results.map(x => x.ok), [true, true]);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM race_results WHERE source = 'offline' AND status = 'accepted'").get().n, 2);
  assert.equal(db().prepare('SELECT COUNT(*) AS n FROM scores').get().n, 0, 'offline runs are never ranked');

  // Right after a sync, claiming 20 minutes of offline racing is impossible.
  const before = row(id).credits;
  const flood = Array.from({ length: 8 }, () => ({ opId: opId(), type: 'race', run: run({ durationMs: 150_000, distance: 7000 }) }));
  const f = await sync(token, flood);
  const ok = f.json.results.filter(x => x.ok).length;
  assert.ok(ok <= 2, `at most the slack's worth accepted, got ${ok}`);
  assert.ok(f.json.results.some(x => x.code === 'offline_budget'));
  assert.ok(row(id).credits - before < 2000);
});

test('car purchase: locked, insufficient credits, success, duplicate — all atomic', async () => {
  const { token, id } = await account();
  // Locked: level 1 < Kestrel's level requirement, even with plenty of credits.
  grant(id, { credits: 50_000 });
  let r = await sync(token, [{ opId: opId(), type: 'purchaseCar', carId: 'kestrel' }]);
  assert.equal(r.json.results[0].code, 'locked');
  assert.equal(row(id).credits, 50_000);
  assert.equal(carRow(id, 'kestrel'), undefined);

  // Unlocked but too expensive.
  grant(id, { credits: 100, level: 3 });
  r = await sync(token, [{ opId: opId(), type: 'purchaseCar', carId: 'kestrel' }]);
  assert.equal(r.json.results[0].code, 'insufficient_credits');
  assert.equal(row(id).credits, 100);
  assert.equal(carRow(id, 'kestrel'), undefined);

  // Success: credits and ownership change together.
  grant(id, { credits: 3000 });
  const buy = { opId: opId(), type: 'purchaseCar', carId: 'kestrel' };
  r = await sync(token, [buy]);
  assert.equal(r.json.results[0].ok, true);
  assert.equal(row(id).credits, 3000 - CAR_PROGRESSION.kestrel.price);
  assert.ok(carRow(id, 'kestrel'));

  // Same op again → same answer, no second charge. A new op → already owned.
  r = await sync(token, [buy, { opId: opId(), type: 'purchaseCar', carId: 'kestrel' }]);
  assert.equal(r.json.results[0].duplicate, true);
  assert.equal(r.json.results[1].code, 'already_owned');
  assert.equal(row(id).credits, 3000 - CAR_PROGRESSION.kestrel.price);
});

test('upgrades: price, tier ceiling, level gate, ownership', async () => {
  const { token, id } = await account();
  grant(id, { credits: 100_000, level: 20 });
  const up = () => ({ opId: opId(), type: 'buyUpgrade', carId: 'vireo', key: 'engine' });
  const r = await sync(token, [up(), up(), up(), up()]);
  assert.deepEqual(r.json.results.map(x => x.ok), [true, true, true, false]);
  assert.equal(r.json.results[3].code, 'maxed', 'the starter stops at its tier ceiling (3)');
  assert.equal(carRow(id, 'vireo').engine, 3);
  assert.equal(row(id).credits, 100_000 - upgradePrice('vireo', 1) - upgradePrice('vireo', 2) - upgradePrice('vireo', 3));

  const other = await account('Low Level');
  grant(other.id, { credits: 100_000, level: 1 });
  const gated = await sync(other.token, [
    { opId: opId(), type: 'buyUpgrade', carId: 'vireo', key: 'turbo' },
    { opId: opId(), type: 'buyUpgrade', carId: 'vireo', key: 'turbo' },
    { opId: opId(), type: 'buyUpgrade', carId: 'kestrel', key: 'turbo' },
  ]);
  assert.equal(gated.json.results[0].ok, true);
  assert.equal(gated.json.results[1].code, 'level_required');
  assert.equal(gated.json.results[2].code, 'not_owned');
});

test('forged fields are ignored: prices, credits, levels and ownership come from the server', async () => {
  const { token, id } = await account();
  grant(id, { credits: 10, level: 30 });
  const r = await sync(token, [
    { opId: opId(), type: 'purchaseCar', carId: 'aurora', price: -100_000, credits: 1e9, owned: true },
    { opId: opId(), type: 'buyUpgrade', carId: 'vireo', key: 'engine', cost: 0 },
    { opId: opId(), type: 'selectCar', carId: 'aurora' },
    { opId: opId(), type: 'buyCosmetic', slot: 'paint', id: 'gold', price: 0 },
  ]);
  assert.deepEqual(r.json.results.map(x => x.code), ['locked', 'insufficient_credits', 'not_owned', 'insufficient_credits']);
  assert.equal(row(id).credits, 10);
  assert.equal(row(id).selected_car, 'vireo');
  assert.equal(db().prepare('SELECT COUNT(*) AS n FROM player_cars WHERE player_id = ?').get(id).n, 1);
});

test('malformed batches and operations', async () => {
  const { token } = await account();
  assert.equal((await sync(token, 'nope')).status, 422);
  assert.equal((await sync(token, Array.from({ length: 61 }, () => ({})))).status, 422);
  const r = await sync(token, [{}, { opId: 'x', type: 'race' }, { opId: opId(), type: 'hack' }, { opId: opId(), type: 'race', run: { score: 'lots' } },
    { opId: opId(), type: 'purchaseCar', carId: '__proto__' }, { opId: opId(), type: 'buyUpgrade', carId: 'vireo', key: 'warp' }]);
  assert.deepEqual(r.json.results.map(x => x.code), ['invalid_op', 'invalid_op', 'unknown_op', 'invalid_run', 'unknown_car', 'unknown_upgrade']);
  assert.equal((await srv.call('POST', '/api/v1/sync', { token: 'x'.repeat(43), body: { ops: [] } })).status, 401);
  assert.equal((await srv.call('POST', '/api/v1/sync', { body: { ops: [] } })).status, 401);
});

test('impossible race results are rejected and pay nothing', async () => {
  const { token, id } = await account();
  srv.advance(30 * 60_000);
  const bad = [
    run({ topSpeed: 900 }),
    run({ score: 50_000_000 }),
    run({ nearMisses: 5000 }),
    run({ distance: 60_000, durationMs: 60_000 }),
    run({ insaneMisses: 50, nearMisses: 10 }),
    run({ policeEscapes: 20 }),
  ].map(r => ({ opId: opId(), type: 'race', run: r }));
  const r = await sync(token, bad);
  assert.ok(r.json.results.every(x => !x.ok && x.code === 'implausible'), JSON.stringify(r.json.results));
  assert.ok(r.json.results.every(x => !('reason' in x)), 'the failed check is not disclosed');
  assert.equal(row(id).credits, 0);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM race_results WHERE status = 'rejected'").get().n, 6);
});

test('an offline run claimed in a car the account does not own is bounded by its own garage', async () => {
  const { token, id } = await account();
  srv.advance(10 * 60_000);
  // A top speed only a hypercar reaches, claimed while owning just the starter.
  const r = await sync(token, [{ opId: opId(), type: 'race', run: run({ carId: 'aurora', topSpeed: 420, distance: 9000 }) }]);
  assert.equal(r.json.results[0].code, 'implausible');
  const start = await srv.call('POST', '/api/v1/races', { token, body: { carId: 'aurora', envId: 'neon', clientVersion: '1.2.0' } });
  assert.equal(start.status, 409);
  assert.equal(start.json.error.code, 'car_not_owned');
  assert.equal(row(id).credits, 0);
});

test('mission rewards are paid by the server when a race completes one', async () => {
  const { token, id } = await account();
  const missions = JSON.parse(row(id).missions).active;
  srv.advance(10 * 60_000);
  // A run big enough to finish any level-1 single-run mission.
  const big = run({ score: 400_000, distance: 16_000, durationMs: 300_000, topSpeed: 290, bestCombo: 8, nearMisses: 40, insaneMisses: 10,
    overtakes: 420, perfectOvertakes: 30, chicanes: 15, boostTime: 90, highSpeedTime: 200, bestCleanDistance: 12_000, policeEscapes: 2 });
  const r = await sync(token, [{ opId: opId(), type: 'race', run: big }]);
  assert.equal(r.json.results[0].ok, true, JSON.stringify(r.json.results[0]));
  const done = db().prepare('SELECT missions_completed FROM player_stats WHERE player_id = ?').get(id).missions_completed;
  assert.ok(done >= 1, `missions completed: ${done} of ${missions.map(m => m.type).join(', ')}`);
  assert.ok(r.json.results[0].summary.events.some(([k]) => k === 'mission'));
});

test('guest import: once, clamped, cars re-checked', async () => {
  const { token, id } = await account();
  const guest = {
    credits: 9_999_999, xp: totalXpForLevel(35), ownedCars: ['vireo', 'kestrel', 'aurora'],
    cars: { vireo: { upgrades: { engine: 3, turbo: 3 } }, kestrel: { upgrades: { engine: 4 } }, aurora: { upgrades: { engine: 5 } } },
    selectedCar: 'aurora', records: { score: 900_000, combo: 10 }, stats: { races: 40, missionsCompleted: 12 }, achievements: { first_ride: 1 },
  };
  const r = await srv.call('POST', '/api/v1/progress/import', { token, body: { progress: guest } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.clamped.sort(), ['cars', 'credits', 'level', 'upgrades']);
  const p = row(id);
  assert.equal(p.credits, GUEST_IMPORT.MAX_CREDITS);
  assert.equal(p.level, GUEST_IMPORT.MAX_LEVEL);
  assert.equal(p.selected_car, 'vireo');
  assert.equal(carRow(id, 'aurora'), undefined, 'a hypercar is not imported');
  assert.equal(carRow(id, 'kestrel').engine, GUEST_IMPORT.MAX_UPGRADE_STEP);
  assert.ok(p.imported_at);
  const again = await srv.call('POST', '/api/v1/progress/import', { token, body: { progress: guest } });
  assert.equal(again.status, 409);
});

test('import is refused once cloud progress exists', async () => {
  const { token, id } = await account();
  grant(id, { credits: 5000, level: 3 });
  await sync(token, [{ opId: opId(), type: 'buyUpgrade', carId: 'vireo', key: 'engine' }]);
  const r = await srv.call('POST', '/api/v1/progress/import', { token, body: { progress: { credits: 1 } } });
  assert.equal(r.status, 409);
});

test('recovery code: continue on another phone, single use', async () => {
  const { token, id } = await account('Two Phones');
  const issued = await srv.call('POST', '/api/v1/auth/recovery-code', { token });
  assert.equal(issued.status, 201);
  assert.match(issued.json.code, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  const stored = db().prepare("SELECT subject FROM auth_identities WHERE player_id = ? AND provider = 'recovery'").get(id);
  assert.equal(stored.subject, hashToken(issued.json.code.replace(/-/g, '')), 'stored only as a hash');

  const phone2 = await srv.call('POST', '/api/v1/auth/recover', { body: { code: issued.json.code.toLowerCase() } });
  assert.equal(phone2.status, 200);
  assert.equal(phone2.json.player.id, id);
  assert.notEqual(phone2.json.token, token);
  assert.equal((await srv.call('GET', '/api/v1/progress', { token: phone2.json.token })).status, 200);
  assert.equal((await srv.call('GET', '/api/v1/progress', { token })).status, 200, 'the first phone stays signed in');
  const reuse = await srv.call('POST', '/api/v1/auth/recover', { body: { code: issued.json.code } });
  assert.equal(reuse.status, 401);
  for (const code of ['', 'AAAAA', 42, null, '<script>']) {
    assert.equal((await srv.call('POST', '/api/v1/auth/recover', { body: { code } })).status, 401);
  }
});

test('garage, missions, achievements and catalog endpoints', async () => {
  const { token } = await account();
  const garage = await srv.call('GET', '/api/v1/garage', { token });
  assert.equal(garage.status, 200);
  const byId = Object.fromEntries(garage.json.cars.map(c => [c.id, c]));
  assert.equal(byId.vireo.state, 'owned');
  assert.equal(byId.kestrel.state, 'locked');
  assert.equal(byId.phantom.name, '???', 'the legendary car stays secret');
  const catalog = await srv.call('GET', '/api/v1/cars');
  assert.ok(!JSON.stringify(catalog.json).includes('outrun the law'), 'secret hints are not in the public catalog');
  const missions = await srv.call('GET', '/api/v1/missions', { token });
  assert.equal(missions.json.missions.length, 3);
  assert.equal(missions.json.daily.goals.length, 3);
  const ach = await srv.call('GET', '/api/v1/achievements', { token });
  assert.equal(ach.json.achievements.length, 20);
  assert.equal((await srv.call('GET', '/api/v1/garage')).status, 401);
});

test('credits can never go negative in the database', async () => {
  const { id } = await account();
  assert.throws(() => db().prepare('UPDATE player_progress SET credits = -1 WHERE player_id = ?').run(id), /CHECK constraint/);
  assert.throws(() => db().prepare("UPDATE player_cars SET engine = 9 WHERE player_id = ? AND car_id = 'vireo'").run(id), /CHECK constraint/);
});

test('upgrading a v2 database keeps accounts, tokens and scores', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nv-migrate-'));
  const path = join(dir, 'v2.db');
  try {
    const old = new DatabaseSync(path);
    old.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);');
    for (const m of MIGRATIONS.filter(x => x.version <= 2)) {
      old.exec(m.sql);
      old.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(m.version, m.name, 1);
    }
    old.prepare('INSERT INTO players (id, display_name, token_hash, created_at, last_seen_at, name_changed_at, races) VALUES (?, ?, ?, 1, 1, 1, 1)').run('p_old', 'Veteran', hashToken('t'.repeat(43)));
    old.prepare("INSERT INTO race_sessions (id, player_id, car_id, env_id, client_version, started_at, status) VALUES ('r_1', 'p_old', 'vireo', 'neon', '1.1.0', 1, 'accepted')").run();
    old.prepare("INSERT INTO scores (session_id, player_id, score, distance_m, top_speed_kmh, best_combo, duration_ms, car_id, created_at) VALUES ('r_1', 'p_old', 1234, 500, 200, 2, 60000, 'vireo', 2)").run();
    old.close();

    const db2 = openDatabase(path);
    try {
    assert.equal(db2.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, SCHEMA_VERSION);
    assert.deepEqual({ ...db2.prepare("SELECT player_id, provider FROM auth_identities WHERE subject = ?").get(hashToken('t'.repeat(43))) }, { player_id: 'p_old', provider: 'device' });
    assert.equal(db2.prepare('SELECT score FROM scores WHERE player_id = ?').get('p_old').score, 1234, 'scores survived the players rebuild');
    assert.ok(!db2.prepare('PRAGMA table_info(players)').all().some(c => c.name === 'token_hash'));
    assert.equal(db2.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(db2.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      db2.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
