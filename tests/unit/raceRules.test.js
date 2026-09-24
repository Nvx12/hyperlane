import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_KMH, parseRun, implausible, maxScore } from '../../server/src/api/raceRules.js';
import { CARS, UPGRADES, DIFFICULTY } from '../../client/js/balance.js';

const session = (car = 'vireo', startedAt = 0) => ({ car_id: car, started_at: startedAt });
const run = (over = {}) => ({
  score: 42000, distance: 6000, topSpeed: 228, bestCombo: 5, durationMs: 120_000,
  nearMisses: 24, overtakes: 60, perfectOvertakes: 6, ...over,
});

test('speed ceilings cover every car at full upgrades, difficulty and boost', () => {
  for (const car of CARS) {
    const engine = UPGRADES.engine.steps.reduce((a, b) => a + b, 0) / 100;
    const fullTop = car.stats.topKmh * (1 + engine) * (1 + DIFFICULTY.PLAYER_SPEED_BONUS);
    assert.ok(MAX_KMH[car.id] > fullTop + car.stats.boostKmh, car.id);
    assert.ok(MAX_KMH[car.id] < 700, `${car.id} ceiling stays meaningful`);
  }
});

test('parseRun enforces types and the combo tier set', () => {
  assert.equal(parseRun(run()).ok, true);
  for (const bad of [null, 'x', run({ score: -1 }), run({ score: 1.5 }), run({ bestCombo: 4 }), run({ distance: Infinity }),
    run({ topSpeed: '200' }), run({ durationMs: 5 * 3600_000 }), run({ nearMisses: -2 })]) {
    assert.equal(parseRun(bad).ok, false, JSON.stringify(bad));
  }
});

test('believable runs pass for every car', () => {
  for (const car of CARS) assert.equal(implausible(run(), session(car.id), 125_000), null, car.id);
});

test('each plausibility check rejects its target', () => {
  const t = 125_000;
  assert.equal(implausible(run(), session(), 30_000), 'duration_exceeds_wall_clock');
  assert.equal(implausible(run({ topSpeed: 1000 }), session(), t), 'speed');
  assert.equal(implausible(run({ distance: 60_000, topSpeed: 380 }), session(), t), 'distance_vs_time');
  assert.equal(implausible(run({ distance: 6000, topSpeed: 120 }), session(), t), 'distance_vs_speed');
  assert.equal(implausible(run({ nearMisses: 900 }), session(), t), 'near_misses');
  assert.equal(implausible(run({ overtakes: 2000 }), session(), t), 'overtakes');
  assert.equal(implausible(run({ perfectOvertakes: 61 }), session(), t), 'perfect_overtakes');
  assert.equal(implausible(run({ score: 1e9 }), session(), t), 'score');
  assert.equal(implausible(run({ bestCombo: 10, nearMisses: 0, overtakes: 0, perfectOvertakes: 0, distance: 100, topSpeed: 150, durationMs: 5000 }), session(), t), 'combo');
  assert.equal(implausible(run(), session('batmobile'), t), 'car');
});

test('score ceiling grows with distance and actions', () => {
  const small = maxScore({ distance: 1000, nearMisses: 0, overtakes: 0, perfectOvertakes: 0 }, 'vireo');
  const big = maxScore({ distance: 10_000, nearMisses: 50, overtakes: 100, perfectOvertakes: 10 }, 'vireo');
  assert.ok(big > small * 5);
});
