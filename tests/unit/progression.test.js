import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../client/js/progression/engine.js';
import { XP_CURVE, CAR_PROGRESSION, TIERS, UPGRADE_PRICING, RUN_CAPS, GUEST_IMPORT } from '../../client/js/progression/config.js';
import { CARS, UPGRADES } from '../../client/js/balance.js';

const fresh = () => {
  const s = E.defaultProgress('test-seed');
  E.ensureMissions(s);
  return s;
};
const atLevel = (s, level) => {
  s.xp = E.totalXpForLevel(level);
  s.level = level;
  return s;
};
const run = (over = {}) => ({
  carId: 'vireo', score: 60_000, distance: 7000, durationMs: 120_000, topSpeed: 250, bestMultiplier: 5,
  nearMisses: 5, insaneMisses: 1, overtakes: 80, perfectOvertakes: 6, chicanes: 3, pickups: 3, creditChips: 0,
  crashes: 1, policeEscapes: 0, legendPasses: 0, longestChase: 0, boostTime: 12, highSpeedTime: 40, bestCleanDistance: 3000, ...over,
});

test('XP curve: one formula, each level costs more, no exponential blow-up', () => {
  for (let l = 1; l < XP_CURVE.MAX_LEVEL; l++) {
    assert.ok(E.xpToNext(l + 1) > E.xpToNext(l));
    assert.equal(E.totalXpForLevel(l + 1) - E.totalXpForLevel(l), E.xpToNext(l));
  }
  assert.ok(E.xpToNext(39) / E.xpToNext(10) < 5, 'late levels are longer, not absurd');
  assert.deepEqual(E.levelInfo(0), { level: 1, xp: 0, need: E.xpToNext(1), title: 'ROOKIE', max: false });
  const l7 = E.levelInfo(E.totalXpForLevel(7) + 10);
  assert.equal(l7.level, 7);
  assert.equal(l7.xp, 10);
  assert.equal(E.levelInfo(1e12).level, XP_CURVE.MAX_LEVEL);
});

test('every car has a tier, a price and requirements; faster tiers cost more and need more', () => {
  let prev = null;
  for (const car of CARS) {
    const r = CAR_PROGRESSION[car.id];
    assert.ok(r && TIERS[r.tier], car.id);
    if (r.starter) continue;
    const level = r.requires.find(x => x.kind === 'level').value;
    assert.ok(level >= 3, `${car.id} needs real progression`);
    if (prev && r.tier > prev.tier) assert.ok(r.price > prev.price && level > prev.level, `${car.id} climbs the ladder`);
    if (!r.legendary) prev = { tier: r.tier, price: r.price, level };
  }
  for (const id of ['stiletto', 'aurora']) {
    assert.ok(CAR_PROGRESSION[id].requires.some(x => x.kind !== 'level'), `${id} needs skill as well as level`);
  }
});

test('buying a car: locked → available → owned; credits and ownership change together', () => {
  const s = fresh();
  s.credits = 1e6;
  assert.equal(E.carStatus(s, 'kestrel').state, 'locked');
  assert.equal(E.purchaseCar(s, 'kestrel').code, 'locked');
  assert.equal(s.credits, 1e6);
  atLevel(s, 3);
  assert.equal(E.carStatus(s, 'kestrel').state, 'available');
  s.credits = CAR_PROGRESSION.kestrel.price - 1;
  assert.equal(E.purchaseCar(s, 'kestrel').code, 'insufficient_credits');
  assert.ok(!s.ownedCars.includes('kestrel'));
  s.credits = CAR_PROGRESSION.kestrel.price + 5;
  assert.equal(E.purchaseCar(s, 'kestrel').ok, true);
  assert.equal(s.credits, 5);
  assert.ok(s.ownedCars.includes('kestrel') && s.cars.kestrel);
  assert.equal(E.purchaseCar(s, 'kestrel').code, 'already_owned');
  assert.equal(E.purchaseCar(s, 'batmobile').code, 'unknown_car');
});

test('the hypercar needs level, a score record, an achievement AND credits', () => {
  const s = fresh();
  s.credits = 1e7;
  atLevel(s, 30);
  const status = () => E.carStatus(s, 'aurora');
  assert.equal(status().state, 'locked');
  s.records.score = 1e6;
  assert.equal(status().state, 'locked', 'the achievement is still missing');
  s.achievements.combo_king = 1;
  assert.equal(status().state, 'available');
  s.credits = 10;
  assert.equal(E.purchaseCar(s, 'aurora').code, 'insufficient_credits');
});

test('the legendary car stays hidden until its secret feat, and a run is what earns the feat', () => {
  const s = fresh();
  atLevel(s, 35);
  assert.equal(E.carStatus(s, 'phantom').hidden, true);
  E.settleRun(s, run({ bestMultiplier: 10, policeEscapes: 1, distance: 9000 }), { dateKey: 'd1', now: 1 });
  assert.equal(s.feats.phantom, true);
  assert.equal(E.carStatus(s, 'phantom').hidden, false);
});

test('upgrades: tier ceiling, level gates, prices rise, the starter never becomes a hypercar', () => {
  const s = atLevel(fresh(), 1);
  s.credits = 1e7;
  assert.equal(E.upgradeCeiling('vireo'), TIERS[1].upgradeCeiling);
  assert.equal(E.buyUpgrade(s, 'vireo', 'engine').ok, true);
  assert.equal(E.buyUpgrade(s, 'vireo', 'engine').code, 'level_required');
  atLevel(s, 40);
  while (E.buyUpgrade(s, 'vireo', 'engine').ok);
  assert.equal(s.cars.vireo.upgrades.engine, TIERS[1].upgradeCeiling);
  assert.equal(E.buyUpgrade(s, 'vireo', 'engine').code, 'maxed');
  assert.equal(E.buyUpgrade(s, 'aurora', 'engine').code, 'not_owned');
  for (let n = 2; n <= 5; n++) assert.ok(E.upgradePrice('stiletto', n) > E.upgradePrice('stiletto', n - 1));
  assert.ok(E.upgradePrice('aurora', 1) > E.upgradePrice('vireo', 1));
  assert.equal(E.upgradePrice('vireo', 1), UPGRADE_PRICING.STEP_PRICES[0]);
  for (const k of E.UPGRADE_KEYS) while (E.buyUpgrade(s, 'vireo', k).ok);
  const maxedStarter = E.carProfile(s, 'vireo');
  const stockSupercar = E.carProfile(fresh(), 'stiletto', false);
  assert.ok(maxedStarter.topKmh < stockSupercar.topKmh, 'identity kept');
  assert.ok(maxedStarter.topKmh + maxedStarter.boostKmh < CARS.find(c => c.id === 'aurora').stats.topKmh + 60);
  assert.ok(Object.values(UPGRADES).every(u => u.steps.length >= TIERS[5].upgradeCeiling));
});

test('cosmetics: free, level-gated, bought once for every car', () => {
  const s = fresh();
  assert.equal(E.setCosmetic(s, 'vireo', 'paint', 'magenta').ok, true, 'free colours');
  assert.equal(E.setCosmetic(s, 'vireo', 'paint', 'lime').code, 'not_owned_item');
  s.credits = 10_000;
  assert.equal(E.buyCosmetic(s, 'paint', 'lime').code, 'level_required');
  atLevel(s, 3);
  assert.equal(E.buyCosmetic(s, 'paint', 'lime').ok, true);
  assert.equal(E.buyCosmetic(s, 'paint', 'lime').code, 'already_owned');
  assert.equal(E.setCosmetic(s, 'vireo', 'paint', 'lime').ok, true);
  assert.equal(E.buyCosmetic(s, 'paint', 'nope').code, 'unknown_item');
});

test('run rewards: skill pays more than mileage; caps stop one run from skipping the ladder', () => {
  const cruise = E.runRewards(run({ nearMisses: 0, insaneMisses: 0, perfectOvertakes: 0, chicanes: 0, bestMultiplier: 1, score: 20_000 }), 1);
  const risky = E.runRewards(run({ nearMisses: 25, insaneMisses: 6, perfectOvertakes: 20, chicanes: 8, bestMultiplier: 8, score: 120_000 }), 1);
  const sum = r => r.credits.reduce((a, [, v]) => a + v, 0);
  assert.ok(sum(risky) > sum(cruise) * 2.5, `${sum(risky)} vs ${sum(cruise)}`);
  assert.ok(risky.xp > cruise.xp * 1.5);
  const absurd = E.runRewards(run({ distance: 200_000, score: 50_000_000, nearMisses: 900, perfectOvertakes: 800, overtakes: 5000 }), 1);
  assert.equal(absurd.capped, true);
  assert.ok(sum(absurd) <= RUN_CAPS.CREDITS_SOFT(1) * RUN_CAPS.HARD + 10);
  assert.ok(absurd.xp <= RUN_CAPS.XP_SOFT(1) * RUN_CAPS.HARD + 1);
});

test('settling a run updates records, stats, missions, achievements, credits and level in one pass', () => {
  const s = fresh();
  const res = E.settleRun(s, run(), { dateKey: '2026-09-30', now: 123 });
  assert.equal(s.stats.races, 1);
  assert.equal(s.records.score, 60_000);
  assert.ok(res.beaten.includes('score'));
  assert.ok(s.achievements.first_ride);
  assert.equal(s.credits, res.creditsTotal);
  assert.equal(s.stats.creditsEarned, res.creditsTotal);
  assert.equal(s.xp, res.xp);
  assert.equal(s.level, E.levelInfo(s.xp).level);
  assert.equal(s.missions.active.length, 3);
  assert.equal(s.stats.carDistance.vireo, 7000);
});

test('"new car available" is announced once, when the requirements are first met', () => {
  const s = fresh();
  s.xp = E.totalXpForLevel(3) - 1;
  const res = E.settleRun(s, run(), { dateKey: 'd', now: 1 });
  assert.ok(s.level >= 3);
  assert.deepEqual(res.newlyAvailable, ['kestrel']);
  assert.ok(res.events.some(([, t]) => t === 'NEW CAR AVAILABLE · Kestrel GT'));
  assert.deepEqual(E.settleRun(s, run(), { dateKey: 'd', now: 2 }).newlyAvailable, []);
});

test('the next goal points at the lowest locked tier with its progress', () => {
  const s = fresh();
  const goal = E.nextGoal(s);
  assert.equal(goal.carId, 'kestrel');
  assert.deepEqual(goal.lines.map(l => l.kind), ['level', 'credits']);
  assert.equal(E.progressText(goal.lines[0]), '1 / 3');
});

test('normalizeProgress repairs damaged documents without inventing progress', () => {
  const d = E.normalizeProgress({
    credits: -50, xp: 'lots', ownedCars: ['vireo', 'batmobile', 'kestrel'], selectedCar: 'batmobile',
    cars: { kestrel: { upgrades: { engine: 99, turbo: -3 }, custom: { paint: 'gold' } } },
    cosmetics: ['paint:gold', 'hack:thing'], achievements: { first_ride: 5, fake: 1 }, feats: { phantom: 'yes' },
    missions: { active: [{ type: 'nope' }, { type: 'overtakes', target: 10, progress: 3, credits: 1e9, xp: 5 }] },
  }, 'seed');
  assert.equal(d.credits, 0);
  assert.equal(d.xp, 0);
  assert.deepEqual(d.ownedCars, ['vireo', 'kestrel']);
  assert.equal(d.selectedCar, 'vireo');
  assert.equal(d.cars.kestrel.upgrades.engine, E.upgradeCeiling('kestrel'));
  assert.equal(d.cars.kestrel.upgrades.turbo, 0);
  assert.equal(d.cars.kestrel.custom.paint, 'gold', 'owned cosmetic kept');
  assert.deepEqual(d.cosmetics, ['paint:gold']);
  assert.deepEqual(Object.keys(d.achievements), ['first_ride']);
  assert.equal(d.feats.phantom, undefined);
  assert.equal(d.missions.active.length, 1);
  assert.ok(d.missions.active[0].credits < 1e9);
  assert.ok(GUEST_IMPORT.MAX_LEVEL < CAR_PROGRESSION.stiletto.requires[0].value, 'imports can never reach supercars directly');
});
