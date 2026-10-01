// Generates the ORIGINAL placeholder police-chase track (client/audio/police-chase-placeholder.wav).
// It is synthesized here from scratch — no samples, nothing taken from any recording — so the
// chase music system can be built and tested until a licensed track is dropped in.
//
//   node tools/audio/make-chase-placeholder.mjs
//
// Layout (140 BPM, A minor): 1 bar riser intro, then a 4-bar loop. In data/audio.js:
//   startTime 0 (the intro plays once) · loopStart = 1 bar · loopEnd = end of file.
// Notes that ring past the end of the loop are wrapped to the loop start, so the loop is seamless.
import { writeFileSync, mkdirSync } from 'node:fs';

const RATE = 16000;
const BPM = 140;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const INTRO_BARS = 1;
const LOOP_BARS = 4;
const LEN = Math.round((INTRO_BARS + LOOP_BARS) * BAR * RATE);
const LOOP_START = Math.round(INTRO_BARS * BAR * RATE);
const out = new Float32Array(LEN);

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

// Adds a sample; in the loop region, anything past the end wraps to the loop start.
function put(i, v) {
  if (i >= LEN) i = LOOP_START + ((i - LOOP_START) % (LEN - LOOP_START));
  if (i >= 0) out[i] += v;
}

function osc(type, phase) {
  const p = phase - Math.floor(phase);
  if (type === 'saw') return 2 * p - 1;
  if (type === 'square') return p < 0.5 ? 1 : -1;
  return Math.sin(2 * Math.PI * p);
}

// A synth note with an exponential decay and a one-pole lowpass (cutoff sweeps down).
function note(t, dur, freq, vol, type = 'saw', cutoff = 2000, cutoffEnd = cutoff, decay = 6) {
  const start = Math.round(t * RATE);
  const n = Math.round(dur * RATE);
  let y = 0;
  for (let k = 0; k < n; k++) {
    const x = k / n;
    const fc = cutoff + (cutoffEnd - cutoff) * x;
    const a = 1 - Math.exp((-2 * Math.PI * fc) / RATE);
    const raw = osc(type, (freq * k) / RATE) + 0.5 * osc(type, (freq * 1.006 * k) / RATE);
    y += a * (raw - y);
    const env = Math.min(1, k / (0.004 * RATE)) * Math.exp(-decay * x);
    put(start + k, y * env * vol);
  }
}

function kick(t, vol = 0.9) {
  const start = Math.round(t * RATE);
  const n = Math.round(0.28 * RATE);
  let phase = 0;
  for (let k = 0; k < n; k++) {
    const x = k / n;
    phase += (48 + 110 * Math.exp(-x * 14)) / RATE;
    put(start + k, Math.sin(2 * Math.PI * phase) * Math.exp(-x * 5) * vol);
  }
}

function noiseHit(t, dur, vol, highpass = 0.6) {
  const start = Math.round(t * RATE);
  const n = Math.round(dur * RATE);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const r = rand();
    const hp = r - highpass * prev; // crude highpass: brighter with a higher coefficient
    prev = r;
    put(start + k, hp * Math.exp((-6 * k) / n) * vol);
  }
}

// Am – Am – F – G (bass roots, Hz) and stab chords.
const ROOTS = [55, 55, 43.65, 49];
const STABS = [[220, 261.6, 329.6], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
const s16 = BEAT / 4;

// Intro: a rising noise sweep and a siren-like two-tone (original, generic) building into bar 2.
for (let k = 0; k < 16; k++) {
  const t = k * s16;
  noiseHit(t, s16 * 0.9, 0.05 + 0.18 * (k / 16), 0.2 + 0.7 * (k / 16));
  if (k % 4 === 0) note(t, s16 * 3.5, k % 8 === 0 ? 659 : 587, 0.05 + 0.05 * (k / 16), 'square', 1800, 1200, 2);
}
for (let k = 0; k < 4; k++) kick(k * BEAT, 0.3 + k * 0.15);

// The loop: driving 16th bass, four-on-the-floor, snare on 2 & 4, 8th hats, offbeat stabs and a
// short alarm lead motif every second bar.
for (let bar = 0; bar < LOOP_BARS; bar++) {
  const t0 = (INTRO_BARS + bar) * BAR;
  const root = ROOTS[bar];
  for (let s = 0; s < 16; s++) {
    const t = t0 + s * s16;
    const oct = s % 4 === 3 ? 2 : 1;
    note(t, s16 * 0.95, root * oct, 0.22, 'saw', 900, 250, 4);
    if (s % 4 === 0) kick(t);
    if (s === 4 || s === 12) noiseHit(t, 0.16, 0.32, 0.3);
    if (s % 2 === 0) noiseHit(t + s16, 0.04, 0.09, 0.95);
    if (s === 2 || s === 6 || s === 10 || s === 14) for (const f of STABS[bar]) note(t, s16 * 1.5, f, 0.045, 'square', 2600, 900, 5);
  }
  if (bar % 2 === 1) {
    const motif = [880, 784, 880, 988, 880, 784, 659, 784];
    motif.forEach((f, i) => note(t0 + i * s16 * 2, s16 * 1.8, f, 0.06, 'square', 3000, 1600, 3));
  }
}

// Normalise with a soft clip, then 16-bit mono WAV.
let peak = 0;
for (let i = 0; i < LEN; i++) peak = Math.max(peak, Math.abs(out[i]));
const gain = 0.89 / peak;
const pcm = Buffer.alloc(LEN * 2);
for (let i = 0; i < LEN; i++) pcm.writeInt16LE(Math.round(Math.tanh(out[i] * gain * 1.2) * 32767 * 0.95), i * 2);
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
const dir = new URL('../../client/audio/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('police-chase-placeholder.wav', dir), Buffer.concat([header, pcm]));
console.log(`police-chase-placeholder.wav · ${(LEN / RATE).toFixed(3)} s · loopStart ${(LOOP_START / RATE).toFixed(4)} s · ${Math.round((44 + pcm.length) / 1024)} KB`);
