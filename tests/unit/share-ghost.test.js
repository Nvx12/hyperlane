import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeChallenge, decodeChallenge } from '../../client/js/Share.js';
import { Ghost } from '../../client/js/Ghost.js';
import { CAMERA } from '../../client/js/config.js';

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

test('challenge links round-trip', () => {
  const c = decodeChallenge(encodeChallenge({ name: 'Night Owl', score: 42318.7, distance: 6012.4, env: 'desert' }));
  assert.deepEqual(c, { name: 'Night Owl', score: 42318, distance: 6012, env: 'desert' });
});

test('challenge without a valid name falls back to "A rival"', () => {
  const c = decodeChallenge(encodeChallenge({ name: '', score: 100, distance: 50, env: 'neon' }));
  assert.equal(c.name, 'A rival');
});

test('tampered or hostile challenge links are rejected', () => {
  const bad = [
    '', 'x'.repeat(500), '%%%', 'not-base64!',
    b64({ v: 2, s: 10, d: 1, e: 'neon' }),
    b64({ v: 1, s: -5, d: 1, e: 'neon' }),
    b64({ v: 1, s: 1.5, d: 1, e: 'neon' }),
    b64({ v: 1, s: 1e12, d: 1, e: 'neon' }),
    b64({ v: 1, s: 10, d: 1, e: 'moon' }),
    b64({ v: 1, s: 10, d: 1, e: 'neon', n: '<img src=x onerror=alert(1)>' }),
    b64({ v: 1, s: 10, d: 1, e: 'neon', n: 'a' }),
    b64(['array']),
  ];
  for (const p of bad) assert.equal(decodeChallenge(p), null, p.slice(0, 40));
});

test('ghost records at 4 Hz and replays interpolated positions', () => {
  const g = new Ghost();
  g.enabled = true;
  g.startRun();
  for (let t = 0; t <= 20; t += 1 / 60) g.record(t, t * 50, Math.sin(t)); // 50 m/s
  assert.ok(g.recD.length >= 80 && g.recD.length <= 82);
  assert.equal(g.finishRun(1000, 'vireo'), true);

  g.startRun();
  const e = g.place(10, 10 * 50 - 30); // player 30 m behind the ghost
  assert.ok(Math.abs(e.ahead - 30) < 0.5);
  assert.ok(Math.abs(e.z - (CAMERA.PLAYER_DEPTH + 30)) < 0.5);
  assert.equal(g.place(25, 0), null, 'ghost disappears where its run ended');
  assert.equal(g.place(10, 10 * 50 + 20), null, 'ghost behind the camera is not placed');
});

test('ghost is only replaced by a better, long-enough run', () => {
  const g = new Ghost();
  g.startRun();
  for (let t = 0; t <= 20; t += 0.25) g.record(t, t * 40, 0);
  assert.equal(g.finishRun(500, 'vireo'), true);
  g.startRun();
  for (let t = 0; t <= 20; t += 0.25) g.record(t, t * 40, 0);
  assert.equal(g.finishRun(400, 'vireo'), false, 'lower score keeps the old ghost');
  g.startRun();
  for (let t = 0; t <= 3; t += 0.25) g.record(t, t * 40, 0);
  assert.equal(g.finishRun(9999, 'vireo'), false, 'too short to become a ghost');
  g.enabled = false;
  g.startRun();
  assert.equal(g.place(5, 0), null, 'disabled ghost is never placed');
});
