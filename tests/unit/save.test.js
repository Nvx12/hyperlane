import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installStorage } from '../helpers/storage.js';
import { SaveManager, defaultSave, SAVE_VERSION } from '../../client/js/SaveManager.js';
import { totalXpForLevel, levelInfo } from '../../client/js/progression/engine.js';

let storage;
beforeEach(() => {
  storage = installStorage();
});

// A v2 (1.1) save, as the previous release wrote it.
const v2Save = (over = {}) => ({
  saveVersion: 2,
  credits: 48_000,
  xp: 120,
  level: 14,
  selectedCar: 'aurora',
  environment: 'desert',
  unlockedCars: ['vireo', 'kestrel', 'bruiser', 'stiletto', 'aurora'],
  cars: { vireo: { upgrades: { engine: 5, turbo: 2 }, custom: { paint: 'gold' } }, aurora: { upgrades: { engine: 5 }, custom: {} } },
  achievements: { first_ride: 111, speed_demon: 222 },
  missions: { active: [{ id: 3, type: 'overtakes', target: 20, progress: 5, credits: 100, xp: 50 }], seq: 3 },
  daily: { date: '2026-09-29', progress: { distance: 3 }, claimed: false },
  records: { score: 250_000, distance: 20_000, topSpeed: 380, combo: 10, nearMisses: 40, overtakes: 300, chase: 30, cleanDistance: 9000 },
  stats: { races: 60, distance: 400_000, playTime: 9000, nearMisses: 300, perfectOvertakes: 200, missionsCompleted: 20, creditsEarned: 90_000, carDistance: { aurora: 1000 } },
  flags: { tutorial: true, phantom: true },
  settings: { quality: 'low', steering: 'tilt', sensitivity: 1.2, shake: 0 },
  ...over,
});

test('a fresh install: no driver yet, starter car, level 1, zero credits, three missions', () => {
  const s = new SaveManager();
  assert.equal(s.data.saveVersion, SAVE_VERSION);
  assert.equal(s.data.profile, null, 'first launch asks for a driver');
  assert.deepEqual(s.data.progress.ownedCars, ['vireo']);
  assert.equal(s.data.progress.credits, 0);
  assert.equal(s.data.progress.level, 1);
  assert.equal(s.data.progress.missions.active.length, 3);
  assert.ok(s.data.progress.missions.seed.length >= 16);
});

test('driver profile: validated name, stable id, rename keeps the id', () => {
  const s = new SaveManager();
  assert.equal(s.setProfile('<b>', 'star').ok, false);
  const r = s.setProfile('  Zoë   Racer ', 'star');
  assert.equal(r.ok, true);
  assert.equal(r.profile.name, 'Zoë Racer');
  const id = r.profile.id;
  assert.match(id, /^[0-9a-f-]{16,40}$/i);
  const renamed = s.setProfile('Night Owl', 'moon');
  assert.equal(renamed.profile.id, id);
  assert.equal(renamed.profile.createdAt, r.profile.createdAt);
  assert.equal(new SaveManager().data.profile.name, 'Night Owl');
});

test('saves round-trip', () => {
  const a = new SaveManager();
  a.setProfile('Round Trip', 'bolt');
  a.data.progress.credits = 1234;
  a.data.progress.cars.vireo.upgrades.engine = 2;
  a.save();
  const b = new SaveManager();
  assert.equal(b.data.progress.credits, 1234);
  assert.equal(b.data.progress.cars.vireo.upgrades.engine, 2);
});

test('v2 → v3: records, stats and achievements kept; the old garage and end-game credits are not', () => {
  storage.setItem('nightvector.save', JSON.stringify(v2Save()));
  const s = new SaveManager();
  const p = s.data.progress;
  assert.equal(s.data.saveVersion, SAVE_VERSION);
  assert.equal(s.data.profile, null, 'existing players create their driver once');
  assert.deepEqual(p.ownedCars, ['vireo'], 'cars are earned again under the new rules');
  assert.equal(p.selectedCar, 'vireo');
  assert.equal(p.credits, 5000, 'a head start, not end-game money');
  assert.equal(p.cars.vireo.upgrades.engine, 3, 'starter upgrades kept within its new ceiling');
  assert.equal(p.cars.vireo.custom.paint, 'factory', 'unpaid cosmetics are not kept');
  assert.equal(p.records.score, 250_000);
  assert.equal(p.stats.races, 60);
  assert.equal(p.achievements.speed_demon, 222);
  assert.equal(p.feats.phantom, true);
  let oldTotal = 120;
  for (let l = 1; l < 14; l++) oldTotal += 450 + 150 * (l - 1);
  assert.equal(p.xp, oldTotal, 'total XP kept…');
  assert.ok(p.level < 14 && p.level === levelInfo(oldTotal).level, '…and re-levelled on the slower curve');
  assert.equal(s.data.settings.steering, 'tilt');
  assert.equal(s.data.settings.quality, 'low');
  assert.equal(s.data.flags.tutorial, true);
  assert.equal(s.data.flags.rebalanced, true, 'the player is told once');
  assert.equal(s.data.environment, 'desert');
});

test('v1 (desktop-era) saves migrate through every step', () => {
  storage.setItem('nightvector.save', JSON.stringify(v2Save({ saveVersion: 1, settings: { quality: 'high', shake: 1, touch: 'on' } })));
  const s = new SaveManager();
  assert.equal(s.data.settings.quality, 'auto');
  assert.equal(s.data.settings.shake, 0.7);
  assert.ok(!('touch' in s.data.settings));
  assert.deepEqual(s.data.progress.ownedCars, ['vireo']);
});

test('migrates the v1 legacy save (score / distance / mute only)', () => {
  storage.setItem('hyperlane.save.v1', JSON.stringify({ highScore: 9001, bestDistance: 4200, muted: true }));
  const s = new SaveManager();
  assert.equal(s.data.progress.records.score, 9001);
  assert.equal(s.data.progress.records.distance, 4200);
  assert.equal(s.data.settings.muted, true);
  assert.ok(storage.getItem('nightvector.save'), 'migrated save is written under the new key');
});

test('corrupt saves are quarantined, not silently lost', () => {
  storage.setItem('nightvector.save', '{not json');
  const s = new SaveManager();
  assert.deepEqual(s.data.progress.ownedCars, ['vireo']);
  assert.equal(storage.getItem('nightvector.save.corrupt'), '{not json');
});

test('damaged or hand-edited values are sanitized', () => {
  const bad = defaultSave();
  bad.profile = { id: 'not a uuid!', name: 'x' };
  bad.progress.credits = -500;
  bad.progress.xp = 'NaN';
  bad.progress.ownedCars = ['phantom', 42, 'vireo'];
  bad.progress.cars = { phantom: { upgrades: { engine: 99 } } };
  bad.settings = { quality: 'ultra', sensitivity: 9, shake: 0.123, steering: 'mind' };
  storage.setItem('nightvector.save', JSON.stringify(bad));
  const d = new SaveManager().data;
  assert.equal(d.profile, null);
  assert.equal(d.progress.credits, 0);
  assert.equal(d.progress.xp, 0);
  assert.deepEqual(d.progress.ownedCars, ['vireo', 'phantom']);
  assert.equal(d.progress.cars.phantom.upgrades.engine, 5);
  assert.equal(d.settings.quality, 'auto');
  assert.equal(d.settings.sensitivity, 1.4);
  assert.equal(d.settings.shake, 0.35);
  assert.equal(d.settings.steering, 'touch');
});

test('guest reset keeps the driver and settings; the development reset is a brand-new first launch', () => {
  const s = new SaveManager();
  s.setProfile('Keeper', 'star');
  s.data.settings.quality = 'low';
  s.data.progress.credits = 999;
  s.data.progress.xp = totalXpForLevel(5);
  s.resetProgress();
  assert.equal(s.data.profile.name, 'Keeper');
  assert.equal(s.data.progress.credits, 0);
  s.resetAll();
  assert.equal(s.data.profile, null);
  assert.equal(s.data.settings.quality, 'low', 'device settings survive');
  assert.equal(new SaveManager().data.profile, null);
});

test('blocked storage (private mode) still yields a playable save', () => {
  storage.throwOnAccess = true;
  const s = new SaveManager();
  assert.deepEqual(s.data.progress.ownedCars, ['vireo']);
  s.save(); // must not throw
  assert.equal(s.setProfile('Private Mode', 'bolt').ok, true);
});
