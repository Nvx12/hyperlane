import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progression, upgradeBonus, xpForLevel, getCar } from '../../client/js/Progression.js';
import { defaultSave } from '../../client/js/SaveManager.js';
import { CARS, UPGRADES, UPGRADE_COSTS, XP, CREDITS } from '../../client/js/balance.js';

const make = (patch = {}) => {
  const store = { data: Object.assign(defaultSave(), patch), saves: 0, save() { this.saves++; } };
  return { store, prog: new Progression(store) };
};

test('upgrade bonuses sum their steps and diminish', () => {
  for (const [key, u] of Object.entries(UPGRADES)) {
    assert.equal(upgradeBonus(key, 0), 0);
    assert.equal(upgradeBonus(key, u.steps.length), u.steps.reduce((a, b) => a + b, 0) / 100);
    assert.equal(upgradeBonus(key, 99), upgradeBonus(key, u.steps.length), 'levels beyond max add nothing');
    for (let i = 1; i < u.steps.length; i++) assert.ok(u.steps[i] <= u.steps[i - 1], `${key} steps never grow`);
  }
});

test('buying an upgrade spends credits and changes the driving profile', () => {
  const { store, prog } = make({ credits: 100_000 });
  const before = prog.getCarProfile('vireo').topKmh;
  const cost = prog.upgradeCost('vireo', 'engine');
  assert.equal(cost, Math.round((UPGRADE_COSTS[0] * getCar('vireo').tier) / 10) * 10);
  assert.equal(prog.buyUpgrade('vireo', 'engine'), true);
  assert.equal(store.data.credits, 100_000 - cost);
  assert.equal(store.saves, 1);
  assert.ok(prog.getCarProfile('vireo').topKmh > before);
});

test('upgrades are refused when broke, maxed, or for locked cars', () => {
  const { prog, store } = make({ credits: 10 });
  assert.equal(prog.buyUpgrade('vireo', 'engine'), false);
  store.data.credits = 1e9;
  for (let i = 0; i < UPGRADES.engine.steps.length; i++) assert.equal(prog.buyUpgrade('vireo', 'engine'), true);
  assert.equal(prog.upgradeCost('vireo', 'engine'), null);
  assert.equal(prog.buyUpgrade('vireo', 'engine'), false);
  assert.equal(prog.buyUpgrade('stiletto', 'engine'), false, 'locked car');
});

test('pricier cars cost more to upgrade', () => {
  const { prog } = make();
  const cheap = prog.upgradeCost('vireo', 'turbo');
  const pricey = prog.upgradeCost('aurora', 'turbo');
  assert.ok(pricey > cheap);
});

test('XP levels up through the curve and carries the remainder', () => {
  const { prog, store } = make();
  const gained = prog.addXp(xpForLevel(1) + xpForLevel(2) + 10);
  assert.deepEqual(gained, [2, 3]);
  assert.equal(store.data.level, 3);
  assert.equal(store.data.xp, 10);
  assert.equal(xpForLevel(2) - xpForLevel(1), XP.LEVEL_GROWTH);
});

test('records only report genuinely beaten values', () => {
  const { prog } = make();
  const run = { score: 5000, distance: 2000, topSpeed: 210, bestMultiplier: 3, nearMisses: 4, overtakes: 10, longestChase: 0, bestCleanDistance: 800 };
  // First run: zero-valued records are filled silently; score and combo (base x1) are announced.
  assert.deepEqual(prog.updateRecords(run), ['score', 'combo']);
  assert.deepEqual(prog.updateRecords({ ...run, score: 4000 }), []);
  assert.deepEqual(prog.updateRecords({ ...run, score: 6000, topSpeed: 230 }), ['score', 'topSpeed']);
});

test('car unlocks follow their conditions', () => {
  const { prog, store } = make();
  assert.deepEqual(prog.checkUnlocks(), []);
  const kestrel = CARS.find(c => c.id === 'kestrel');
  store.data.stats.distance = kestrel.unlock.value;
  assert.deepEqual(prog.checkUnlocks().map(c => c.id), ['kestrel']);
  assert.ok(prog.isUnlocked('kestrel'));
  assert.deepEqual(prog.checkUnlocks(), [], 'unlocks fire once');
  assert.equal(prog.selectCar('kestrel'), true);
  assert.equal(prog.selectCar('phantom'), false);
});

test('run rewards: skill pays more than mileage', () => {
  const { prog } = make();
  const base = { distance: 5000, score: 20000, overtakes: 20, perfectOvertakes: 0, nearMisses: 0, insaneMisses: 0, bestMultiplier: 1, highSpeedTime: 0, chicanes: 0, bonusCredits: 0 };
  const careful = prog.runRewards(base);
  const risky = prog.runRewards({ ...base, nearMisses: 30, insaneMisses: 5, perfectOvertakes: 6, bestMultiplier: 5 });
  const total = r => r.credits.reduce((s, [, v]) => s + v, 0);
  assert.ok(total(risky) > total(careful) * 1.5);
  assert.ok(risky.xp > careful.xp);
  assert.ok(careful.credits.some(([label, v]) => label === 'Distance' && v === Math.round(5 * CREDITS.PER_KM)));
});
