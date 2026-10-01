import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChaseMusic } from '../../client/js/ChaseMusic.js';
import { Signals } from '../../client/js/Signals.js';
import { AUDIO } from '../../client/js/data/audio.js';

// resolveSection only reads the config, so it can be tested without an AudioContext.
const section = (over, duration) => {
  const m = Object.create(ChaseMusic.prototype);
  m.cfg = { ...AUDIO.policeChase, ...over };
  return m.resolveSection(duration);
};

test('chase track section: entry point, loop points and END are honoured', () => {
  assert.deepEqual(section({ startTime: 12, loopStart: 20, loopEnd: 52 }, 180), { start: 12, loopStart: 20, loopEnd: 52 });
  assert.deepEqual(section({ startTime: 0, loopStart: 0, loopEnd: null }, 90), { start: 0, loopStart: 0, loopEnd: 90 });
});

test('chase track section: bad values fall back to something that plays (never silence)', () => {
  // END past the end of the file → end of file.
  assert.equal(section({ startTime: 0, loopStart: 5, loopEnd: 500 }, 60).loopEnd, 60);
  // Loop start at/after END → loop the whole section.
  assert.equal(section({ startTime: 0, loopStart: 70, loopEnd: 60 }, 90).loopStart, 0);
  // Entry after END → enter at the loop start.
  assert.equal(section({ startTime: 80, loopStart: 10, loopEnd: 60 }, 90).start, 10);
  // Negative numbers are ignored.
  assert.deepEqual(section({ startTime: -3, loopStart: -1, loopEnd: -5 }, 30), { start: 0, loopStart: 0, loopEnd: 30 });
});

test('audio config is complete and centralised', () => {
  const c = AUDIO.policeChase;
  for (const k of ['file', 'volume', 'startTime', 'loopStart', 'fadeIn', 'fadeOut', 'escapeHold', 'crashFadeOut']) assert.ok(k in c, k);
  assert.equal(c.heatCutoff.length, 6);
  assert.equal(c.heatGain.length, 6);
  assert.equal(AUDIO.mix.sirenMax.length, 6);
  assert.ok(c.volume > 0 && c.volume <= 1);
  assert.ok(AUDIO.mix.sirenMax.every(v => v < 0.1), 'sirens stay under the music');
});

test('signals: listeners run in order, can be removed, and are counted', () => {
  const s = new Signals();
  const seen = [];
  const off = s.on('chase:engaged', d => seen.push(['a', d.level]));
  s.on('chase:engaged', d => seen.push(['b', d.level]));
  s.emit('chase:engaged', { level: 3 });
  off();
  s.emit('chase:engaged', { level: 4 });
  s.emit('nothing', {});
  assert.deepEqual(seen, [['a', 3], ['b', 3], ['b', 4]]);
  assert.equal(s.count(), 1);
});
