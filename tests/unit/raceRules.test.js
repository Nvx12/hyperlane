import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_KMH, parseRun, implausible, maxScore } from '../../server/src/api/raceRules.js';
import { CARS, UPGRADES, DIFFICULTY } from '../../client/js/balance.js';
import { upgradeCeiling } from '../../client/js/progression/engine.js';

const run = (over = {}) => ({
  score: 42000, distance: 6000, topSpeed: 228, bestCombo: 5, durationMs: 120_000,
  nearMisses: 24, insaneMisses: 3, overtakes: 60, perfectOvertakes: 6, chicanes: 2, pickups: 3, creditChips: 1,
  crashes: 1, policeEscapes: 0, legendPasses: 0, longestChase: 0, boostTime: 12, highSpeedTime: 40, bestCleanDistance: 3000, ...over,
});

test('speed ceilings cover every car at its tier ceiling, difficulty and boost', () => {
  for (const car of CARS) {
    const engine = UPGRADES.engine.steps.slice(0, upgradeCeiling(car.id)).reduce((a, b) => a + b, 0) / 100;
    const fullTop = car.stats.topKmh * (1 + engine) * (1 + DIFFICULTY.PLAYER_SPEED_BONUS);
    assert.ok(MAX_KMH[car.id] > fullTop + car.stats.boostKmh, car.id);
    assert.ok(MAX_KMH[car.id] < 700, `${car.id} ceiling stays meaningful`);
  }
  assert.ok(MAX_KMH.vireo < MAX_KMH.stiletto, 'a maxed starter stays well below a supercar');
});

test('parseRun enforces types, the combo tier set, and accepts both combo field names', () => {
  assert.equal(parseRun(run()).ok, true);
  const alt = { ...run(), bestMultiplier: 5 };
  delete alt.bestCombo;
  assert.equal(parseRun(alt).run.bestCombo, 5);
  for (const bad of [null, 'x', [], run({ score: -1 }), run({ score: 1.5 }), run({ bestCombo: 4 }), run({ distance: Infinity }),
    run({ topSpeed: '200' }), run({ durationMs: 5 * 3600_000 }), run({ nearMisses: -2 }), run({ carId: 'batmobile' }),
    run({ envId: '../etc' }), run({ boostTime: -1 }), run({ creditChips: 0.5 })]) {
    assert.equal(parseRun(bad).ok, false, JSON.stringify(bad));
  }
});

test('believable runs pass for every car', () => {
  for (const car of CARS) assert.equal(implausible(parseRun(run()).run, car.id, 125_000), null, car.id);
});

test('each plausibility check rejects its target', () => {
  const t = 125_000;
  const check = over => implausible(parseRun(run(over)).run, 'vireo', t);
  assert.equal(implausible(parseRun(run()).run, 'vireo', 30_000), 'duration_exceeds_wall_clock');
  assert.equal(check({ topSpeed: 1000 }), 'speed');
  assert.equal(check({ distance: 60_000, topSpeed: 300 }), 'distance_vs_time');
  assert.equal(check({ distance: 6000, topSpeed: 120 }), 'distance_vs_speed');
  assert.equal(check({ nearMisses: 900 }), 'near_misses');
  assert.equal(check({ insaneMisses: 25 }), 'insane_misses');
  assert.equal(check({ overtakes: 2000 }), 'overtakes');
  assert.equal(check({ perfectOvertakes: 61 }), 'perfect_overtakes');
  assert.equal(check({ chicanes: 80 }), 'chicanes');
  assert.equal(check({ legendPasses: 30 }), 'legend_passes');
  assert.equal(check({ pickups: 200 }), 'pickups');
  assert.equal(check({ creditChips: 4 }), 'credit_chips');
  assert.equal(check({ policeEscapes: 9 }), 'police');
  assert.equal(check({ longestChase: 90 }), 'chase');
  assert.equal(check({ boostTime: 500 }), 'timers');
  assert.equal(check({ bestCleanDistance: 9000 }), 'clean_distance');
  assert.equal(check({ score: 1e9 }), 'score');
  assert.equal(implausible(parseRun(run({ bestCombo: 10, nearMisses: 0, insaneMisses: 0, overtakes: 0, perfectOvertakes: 0, distance: 100, topSpeed: 150, durationMs: 5000, bestCleanDistance: 0, boostTime: 0, highSpeedTime: 0, pickups: 0, creditChips: 0, chicanes: 0 })).run, 'vireo', t), 'combo');
  assert.equal(implausible(parseRun(run()).run, 'batmobile', t), 'car');
});

test('offline runs (no wall clock) are still bounded by physics', () => {
  assert.equal(implausible(parseRun(run()).run, 'vireo', null), null);
  assert.equal(implausible(parseRun(run({ distance: 60_000, topSpeed: 300 })).run, 'vireo', null), 'distance_vs_time');
});

test('score ceiling grows with distance and actions', () => {
  const small = maxScore({ distance: 1000, nearMisses: 0, overtakes: 0, perfectOvertakes: 0 }, 'vireo');
  const big = maxScore({ distance: 10_000, nearMisses: 50, overtakes: 100, perfectOvertakes: 10 }, 'vireo');
  assert.ok(big > small * 5);
});
