// Guards the progression targets (docs/progression.md) against config changes: a small run of
// the balancing simulation over the recorded bot runs, from brand-new profiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../../tools/balance/simulate.mjs';

const res = simulate(40);
const median = (type, key) => res[type][key].runs.p50;

test('first session: an upgrade within ~3 runs, the first new car within ~6', () => {
  for (const type of ['casual', 'skilled', 'expert']) {
    assert.ok(median(type, 'firstUpgrade') <= 3, `${type} first upgrade ${median(type, 'firstUpgrade')}`);
    const car = median(type, 'kestrel');
    assert.ok(car >= 2 && car <= 7, `${type} first car ${car}`);
  }
});

test('fast cars are not handed out early, and are not an absurd grind either', () => {
  const casual = key => median('casual', key);
  assert.ok(casual('wisp') >= 35 && casual('wisp') <= 110, `performance ${casual('wisp')}`);
  assert.ok(casual('stiletto') >= 100 && casual('stiletto') <= 300, `supercar ${casual('stiletto')}`);
  assert.ok(casual('aurora') >= 250 && casual('aurora') <= 700, `hypercar ${casual('aurora')}`);
  assert.ok(res.casual.aurora.share >= 0.95, 'every casual player gets there eventually');
});

test('the ladder is ordered, and skill shortens it', () => {
  for (const type of ['casual', 'skilled', 'expert']) {
    const order = ['kestrel', 'bruiser', 'wisp', 'stiletto', 'aurora'].map(k => median(type, k));
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${type}: ${order}`);
  }
  assert.ok(median('expert', 'stiletto') < median('casual', 'stiletto') * 0.9);
  assert.ok(median('expert', 'aurora') < median('casual', 'aurora'));
});
