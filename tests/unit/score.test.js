import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScoreSystem } from '../../client/js/ScoreSystem.js';
import { SCORE, COMBO } from '../../client/js/balance.js';

test('distance points scale with speed above the bonus threshold', () => {
  const s = new ScoreSystem();
  s.addDistance(100, SCORE.SPEED_BONUS_FROM_KMH); // no speed bonus
  assert.equal(s.score, 100 * SCORE.POINTS_PER_METER);
  const t = new ScoreSystem();
  t.addDistance(100, SCORE.SPEED_BONUS_FROM_KMH + SCORE.SPEED_BONUS_DIVISOR); // +1 point per meter
  assert.equal(t.score, 100 * (SCORE.POINTS_PER_METER + 1));
  assert.equal(t.distance, 100);
});

test('combo points climb through every tier in order and track the best multiplier', () => {
  const s = new ScoreSystem();
  const seen = [s.multiplier];
  for (let i = 0; i < 100; i++) {
    s.addCombo(1);
    if (s.multiplier !== seen[seen.length - 1]) seen.push(s.multiplier);
  }
  assert.deepEqual(seen, COMBO.TIERS.map(t => t.mult));
  assert.equal(s.stats.bestMultiplier, 10);
  assert.equal(s.multiplier, 10, 'capped at the top tier');
});

test('awards are multiplied by the current combo', () => {
  const s = new ScoreSystem();
  s.addCombo(COMBO.TIERS[2].at); // x3
  assert.equal(s.multiplier, 3);
  assert.equal(s.award(100), 300);
  s.addDistance(10, 0);
  assert.equal(s.score, 300 + 10 * SCORE.POINTS_PER_METER * 3);
});

test('combo decays one tier per window without risky actions', () => {
  const s = new ScoreSystem();
  s.addCombo(COMBO.TIERS[3].at); // x5
  s.update(COMBO.WINDOW - 0.01);
  assert.equal(s.multiplier, 5);
  s.update(0.02);
  assert.equal(s.multiplier, 3);
  assert.equal(s.tierChange, -1);
  s.update(COMBO.WINDOW + 0.01);
  assert.equal(s.multiplier, 2);
});

test('safe actions add combo but do not refresh the decay window', () => {
  const s = new ScoreSystem();
  s.addCombo(COMBO.TIERS[1].at); // x2, window starts
  s.update(COMBO.WINDOW - 1);
  s.addCombo(0.5, false); // plain overtake
  s.update(1.01);
  assert.equal(s.multiplier, 1, 'the window was not extended');
  const r = new ScoreSystem();
  r.addCombo(COMBO.TIERS[1].at);
  r.update(COMBO.WINDOW - 1);
  r.addCombo(1, true); // near miss refreshes
  r.update(1.01);
  assert.equal(r.multiplier, 2);
});

test('a crash breaks the combo and the clean streak', () => {
  const s = new ScoreSystem();
  s.addCombo(COMBO.TIERS[4].at);
  s.addDistance(500, 150);
  assert.equal(s.breakCombo(), 8);
  assert.equal(s.multiplier, 1);
  assert.equal(s.stats.cleanDistance, 0);
  assert.equal(s.stats.bestCleanDistance, 500);
  assert.equal(s.stats.bestMultiplier, 8, 'best multiplier survives the crash');
});

test('reset clears the run completely', () => {
  const s = new ScoreSystem();
  s.addCombo(30);
  s.addDistance(1000, 200);
  s.stats.nearMisses = 5;
  s.reset();
  assert.equal(s.score, 0);
  assert.equal(s.distance, 0);
  assert.equal(s.multiplier, 1);
  assert.equal(s.stats.nearMisses, 0);
  assert.equal(s.stats.bestMultiplier, 1);
});
