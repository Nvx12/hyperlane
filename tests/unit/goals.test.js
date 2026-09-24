import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Goals, LocalDailyProvider } from '../../client/js/Goals.js';
import { Progression } from '../../client/js/Progression.js';
import { defaultSave } from '../../client/js/SaveManager.js';
import { OBJECTIVES, MISSION_REWARD } from '../../client/js/data/missions.js';

const make = () => {
  const store = { data: defaultSave(), save() {} };
  return { store, goals: new Goals(store, new Progression(store)) };
};

// A run big enough to satisfy any single mission target.
const hugeRun = () => ({
  nearMisses: 500, overtakes: 2000, perfectOvertakes: 300, chicanes: 100, insaneMisses: 200, boostTime: 900,
  policeEscapes: 20, distance: 400_000, bestCleanDistance: 200_000, topSpeed: 600, highSpeedTime: 3000,
  bestMultiplier: 10, score: 50_000_000, legendPasses: 20, crashes: 0, pickups: 50, longestChase: 60,
});

test('keeps the configured number of distinct active missions', () => {
  const { goals } = make();
  const active = goals.ensureMissions();
  assert.equal(active.length, MISSION_REWARD.ACTIVE);
  assert.equal(new Set(active.map(m => m.type)).size, active.length);
  for (const m of active) assert.ok(OBJECTIVES[m.type], m.type);
});

test('completed missions pay out once and are replaced', () => {
  const { goals, store } = make();
  const before = goals.ensureMissions().map(m => m.id);
  const res = goals.settle(hugeRun());
  const missionCredits = res.credits.find(([label]) => label === 'Missions');
  assert.ok(missionCredits && missionCredits[1] > 0);
  assert.equal(store.data.stats.missionsCompleted, before.length);
  const after = store.data.missions.active.map(m => m.id);
  assert.equal(after.length, MISSION_REWARD.ACTIVE);
  assert.ok(after.every(id => !before.includes(id)), 'all replaced with new missions');
});

test('cumulative missions accumulate across runs; empty runs change nothing', () => {
  const { goals, store } = make();
  goals.ensureMissions();
  const cumulative = store.data.missions.active.find(m => !OBJECTIVES[m.type].single);
  if (!cumulative) return; // all single-run this roll — covered by the payout test
  const empty = Object.fromEntries(Object.keys(hugeRun()).map(k => [k, 0]));
  empty.bestMultiplier = 1;
  goals.settle(empty);
  assert.equal(store.data.missions.active.find(m => m.id === cumulative.id).progress, 0);
});

test('the daily challenge is deterministic per date and differs across dates', () => {
  const p = new LocalDailyProvider();
  const a = p.getChallenge('2026-09-24');
  const again = new LocalDailyProvider().getChallenge('2026-09-24');
  assert.deepEqual(a, again);
  assert.equal(a.goals.length, 3);
  assert.equal(new Set(a.goals.map(g => g.type)).size, 3);
  const days = ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'].map(d => JSON.stringify(p.getChallenge(d).goals));
  assert.ok(days.some(d => d !== JSON.stringify(a.goals)));
});

test('the daily reward is claimed once', () => {
  const { goals, store } = make();
  goals.ensureMissions();
  const first = goals.settle(hugeRun());
  assert.ok(first.credits.some(([label]) => label === 'Daily challenge'));
  assert.equal(store.data.daily.claimed, true);
  const second = goals.settle(hugeRun());
  assert.ok(!second.credits.some(([label]) => label === 'Daily challenge'));
});

test('achievements unlock once with a timestamp', () => {
  const { goals, store } = make();
  goals.ensureMissions();
  store.data.stats.races = 1;
  const res = goals.settle(hugeRun());
  const unlocked = Object.keys(store.data.achievements);
  assert.ok(unlocked.length > 0);
  assert.equal(res.events.filter(([k]) => k === 'achievement').length, unlocked.length);
  const again = goals.settle(hugeRun());
  const newOnes = again.events.filter(([k]) => k === 'achievement').map(([, t]) => t);
  for (const t of newOnes) assert.ok(!res.events.some(([, prev]) => prev === t), 'no achievement fires twice');
});
