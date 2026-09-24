import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installStorage } from '../helpers/storage.js';
import { SaveManager, defaultSave, SAVE_VERSION } from '../../client/js/SaveManager.js';

let storage;
beforeEach(() => {
  storage = installStorage();
});

test('a fresh install gets a complete default save', () => {
  const s = new SaveManager();
  assert.deepEqual(s.data, defaultSave());
});

test('saves round-trip', () => {
  const a = new SaveManager();
  a.data.credits = 1234;
  a.data.cars.vireo = { upgrades: { engine: 2 }, custom: {} };
  a.save();
  const b = new SaveManager();
  assert.equal(b.data.credits, 1234);
  assert.equal(b.data.cars.vireo.upgrades.engine, 2);
});

test('migrates the v1 legacy save (score / distance / mute only)', () => {
  storage.setItem('hyperlane.save.v1', JSON.stringify({ highScore: 9001, bestDistance: 4200, muted: true }));
  const s = new SaveManager();
  assert.equal(s.data.records.score, 9001);
  assert.equal(s.data.records.distance, 4200);
  assert.equal(s.data.settings.muted, true);
  assert.equal(s.data.saveVersion, SAVE_VERSION);
  assert.ok(storage.getItem('nightvector.save'), 'migrated save is written under the new key');
});

test('reads the pre-release key when the new one is absent', () => {
  storage.setItem('hyperlane.save', JSON.stringify({ ...defaultSave(), credits: 77 }));
  assert.equal(new SaveManager().data.credits, 77);
});

test('missing fields are filled in from defaults (older partial saves)', () => {
  storage.setItem('nightvector.save', JSON.stringify({ saveVersion: 0, credits: 50, stats: { races: 3 } }));
  const s = new SaveManager();
  assert.equal(s.data.credits, 50);
  assert.equal(s.data.stats.races, 3);
  assert.equal(s.data.stats.distance, 0);
  assert.deepEqual(s.data.settings, defaultSave().settings);
  assert.equal(s.data.saveVersion, SAVE_VERSION);
});

test('corrupt saves are quarantined, not silently lost', () => {
  storage.setItem('nightvector.save', '{this is not json');
  const s = new SaveManager();
  assert.deepEqual(s.data, defaultSave());
  assert.equal(storage.getItem('nightvector.save.corrupt'), '{this is not json');
});

test('damaged or hand-edited values are sanitized', () => {
  storage.setItem('nightvector.save', JSON.stringify({
    ...defaultSave(),
    credits: -500.7,
    level: 0,
    xp: 'lots',
    unlockedCars: ['phantom', 42],
    settings: { master: 7, quality: 'ultra', shake: 3, touch: 'maybe', retiredOption: true },
  }));
  const d = new SaveManager().data;
  assert.equal(d.credits, 0);
  assert.equal(d.level, 1);
  assert.equal(d.xp, 0);
  assert.deepEqual(d.unlockedCars, ['vireo', 'phantom']);
  assert.equal(d.settings.master, 1);
  assert.equal(d.settings.quality, 'high');
  assert.equal(d.settings.shake, 1);
  assert.equal(d.settings.touch, 'auto');
  assert.ok(!('retiredOption' in d.settings));
});

test('blocked storage (private mode) still yields a playable save', () => {
  storage.throwOnAccess = true;
  const s = new SaveManager();
  assert.deepEqual(s.data, defaultSave());
  assert.doesNotThrow(() => s.save());
});
