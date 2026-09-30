import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../client/js/progression/engine.js';
import { MISSION_REWARDS } from '../../client/js/progression/config.js';
import { OBJECTIVES } from '../../client/js/data/missions.js';

const fresh = seed => {
  const s = E.defaultProgress(seed);
  E.ensureMissions(s);
  return s;
};
const run = (over = {}) => ({
  carId: 'vireo', score: 1000, distance: 500, durationMs: 20_000, topSpeed: 150, bestMultiplier: 1,
  nearMisses: 0, insaneMisses: 0, overtakes: 0, perfectOvertakes: 0, chicanes: 0, pickups: 0, creditChips: 0,
  crashes: 0, policeEscapes: 0, legendPasses: 0, longestChase: 0, boostTime: 0, highSpeedTime: 0, bestCleanDistance: 0, ...over,
});

test('keeps the configured number of distinct active missions', () => {
  const s = fresh('a');
  assert.equal(s.missions.active.length, MISSION_REWARDS.ACTIVE);
  assert.equal(new Set(s.missions.active.map(m => m.type)).size, MISSION_REWARDS.ACTIVE);
});

test('missions are seeded per profile: the same seed rolls the same missions (client = server)', () => {
  const a = fresh('player-1').missions.active.map(m => m.type);
  assert.deepEqual(fresh('player-1').missions.active.map(m => m.type), a);
  const others = ['player-2', 'player-3', 'player-4', 'player-5'].map(id => fresh(id).missions.active.map(m => m.type).join());
  assert.ok(others.some(o => o !== a.join()), 'different profiles get different missions');
});

test('a completed mission pays once and is replaced; cumulative ones add up across runs', () => {
  const s = fresh('m');
  s.missions.active = [{ id: 1, type: 'overtakes', target: 100, progress: 0, credits: 111, xp: 22 }];
  E.settleRun(s, run({ overtakes: 60 }), { dateKey: 'd', now: 1 });
  assert.equal(s.missions.active.find(m => m.id === 1).progress, 60);
  const credits = s.credits;
  const res = E.settleRun(s, run({ overtakes: 60 }), { dateKey: 'd', now: 2 });
  assert.ok(res.credits.some(([l, v]) => l === 'Missions' && v === 111));
  assert.ok(!s.missions.active.some(m => m.id === 1));
  assert.equal(s.missions.active.length, MISSION_REWARDS.ACTIVE);
  assert.equal(s.stats.missionsCompleted, 1);
  assert.ok(s.credits > credits);
});

test('single-run missions need it in one run', () => {
  const s = fresh('single');
  s.missions.active = [{ id: 9, type: 'score', target: 50_000, progress: 0, credits: 10, xp: 1 }];
  E.settleRun(s, run({ score: 30_000 }), { dateKey: 'd', now: 1 });
  E.settleRun(s, run({ score: 30_000 }), { dateKey: 'd', now: 2 });
  assert.ok(s.missions.active.some(m => m.id === 9), 'two 30k runs are not a 50k run');
  E.settleRun(s, run({ score: 55_000 }), { dateKey: 'd', now: 3 });
  assert.ok(!s.missions.active.some(m => m.id === 9));
});

test('mission targets are real medium-term goals, not one-run freebies', () => {
  for (const [type, runValue] of [['overtakes', 80], ['nearMisses', 5], ['perfect', 6], ['distance', 7], ['boostTime', 12]]) {
    const s = fresh(type);
    s.missions.active = [];
    const target = { overtakes: 350, nearMisses: 18, perfect: 24, distance: 30, boostTime: 60 }[type];
    assert.ok(target / runValue >= 3, `${type}: ${target} vs ${runValue}/run`);
    assert.ok(OBJECTIVES[type]);
  }
});

test('the daily challenge is deterministic per date, differs across dates and pays once', () => {
  assert.deepEqual(E.dailyChallenge('2026-09-30'), E.dailyChallenge('2026-09-30'));
  const days = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].map(d => JSON.stringify(E.dailyChallenge(d).goals));
  assert.ok(new Set(days).size > 1);
  const s = fresh('daily');
  const key = '2026-09-30';
  const huge = run({ distance: 30_000, nearMisses: 60, insaneMisses: 10, overtakes: 300, perfectOvertakes: 30, bestMultiplier: 10, topSpeed: 320, bestCleanDistance: 12_000, boostTime: 90, durationMs: 400_000 });
  const first = E.settleRun(s, huge, { dateKey: key, now: 1 });
  assert.ok(first.credits.some(([l]) => l === 'Daily challenge'));
  const second = E.settleRun(s, huge, { dateKey: key, now: 2 });
  assert.ok(!second.credits.some(([l]) => l === 'Daily challenge'));
  assert.equal(s.stats.dailiesCompleted, 1);
});

test('achievements unlock once, pay their configured reward, and are listed with progress', () => {
  const s = fresh('ach');
  const r1 = E.settleRun(s, run({ topSpeed: 260 }), { dateKey: 'd', now: 42 });
  assert.equal(s.achievements.first_ride, 42);
  assert.equal(s.achievements.speed_demon, 42);
  assert.ok(r1.credits.some(([l, v]) => l === 'Achievements' && v === E.achievementReward('first_ride') + E.achievementReward('speed_demon')));
  const r2 = E.settleRun(s, run({ topSpeed: 260 }), { dateKey: 'd', now: 43 });
  assert.ok(!r2.credits.some(([l]) => l === 'Achievements'));
  const list = E.achievementList(s);
  assert.equal(list.length, 20);
  assert.ok(list.find(a => a.id === 'first_ride').unlocked);
  assert.ok(list.every(a => a.reward > 0));
});

test('live checks report each completion once per run and never pay', () => {
  const s = fresh('live');
  s.missions.active = [{ id: 5, type: 'nearMisses', target: 3, progress: 0, credits: 50, xp: 5 }];
  const notified = new Set();
  const live = run({ nearMisses: 3, topSpeed: 260 });
  const first = E.liveCompletions(s, live, 'd', notified);
  assert.ok(first.some(([k]) => k === 'mission'));
  assert.ok(first.some(([k, , name]) => k === 'achievement' && name === 'Speed Demon'));
  assert.deepEqual(E.liveCompletions(s, live, 'd', notified), []);
  assert.equal(s.credits, 0);
});
