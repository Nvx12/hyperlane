import { Music } from './Music.js';

// All sound is synthesized with the Web Audio API — no audio files.
// Graph: [engine | sfx | music] buses → master → compressor → speakers.
const ENGINE_GEARS = 6;
const ENGINE_UPDATE_INTERVAL = 1 / 30;

export class AudioManager {
  constructor(settings) {
    this.ctx = null;
    this.settings = { ...settings };
    this.paused = false;
    this.master = null;
    this.buses = null;
    this.engine = null;
    this.loops = null;
    this.music = null;
    this.musicMode = 'menu';
    this.noiseBuffer = null;
    this.engineTimer = 0;
    this.lastGear = 0;
    this.tireLevel = 0;
    this.sirenNodes = null;
  }

  get muted() {
    return this.settings.muted;
  }

  // Browsers only allow audio after a user gesture, so the context is created lazily.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    this.build();
    this.applySettings(this.settings);
    this.setMusicMode(this.musicMode);
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.buses = { engine: ctx.createGain(), sfx: ctx.createGain(), music: ctx.createGain() };
    for (const k in this.buses) this.buses[k].connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Engine: saw + square + sub through a resonant lowpass, with a turbo whine on top.
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.buses.engine);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 4;
    filter.connect(gain);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.connect(filter);
    const square = ctx.createOscillator();
    square.type = 'square';
    const squareGain = ctx.createGain();
    squareGain.gain.value = 0.3;
    square.connect(squareGain);
    squareGain.connect(filter);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    sub.connect(subGain);
    subGain.connect(gain);
    const turbo = ctx.createOscillator();
    turbo.type = 'sine';
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turbo.connect(turboGain);
    turboGain.connect(this.buses.engine);
    // Tunnel echo: a short feedback delay mixed in only while inside a tunnel.
    const send = ctx.createGain();
    send.gain.value = 0;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.11;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    gain.connect(send);
    send.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(this.buses.engine);
    for (const o of [saw, square, sub, turbo]) o.start();
    this.engine = { gain, filter, saw, square, sub, turbo, turboGain, send };

    // Noise loops: wind, tire squeal, rain.
    const loop = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(this.buses.sfx);
      src.start(0, Math.random());
      return { gain: g, filter: f };
    };
    this.loops = { wind: loop('bandpass', 700, 0.7), tires: loop('bandpass', 1900, 4), rain: loop('highpass', 2500, 0.5) };
    this.music = new Music(ctx, this.buses.music, this.noiseBuffer);
  }

  applySettings(settings) {
    this.settings = { ...settings };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.03);
    this.buses.engine.gain.setTargetAtTime(s.engine, t, 0.03);
    this.buses.sfx.gain.setTargetAtTime(s.sfx, t, 0.03);
    this.buses.music.gain.setTargetAtTime(s.musicEnabled ? s.music : 0, t, 0.05);
    this.music.setEnabled(s.musicEnabled && s.music > 0 && !s.muted);
  }

  suspend() {
    this.paused = true;
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    this.paused = false;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMusicMode(mode) {
    this.musicMode = mode;
    if (this.music) this.music.setMode(mode);
  }

  updateMusic(intensity) {
    if (this.music) this.music.setIntensity(intensity);
  }

  // Simulated gearbox: rpm sweeps up inside each gear and drops on each shift.
  updateEngine(dt, speedRatio, throttle, boosting, active, slipstream = 0, inTunnel = false) {
    if (!this.engine) return;
    this.engineTimer += dt;
    this.tireLevel = Math.max(0, this.tireLevel - dt * 2.5);
    if (this.engineTimer < ENGINE_UPDATE_INTERVAL) return;
    this.engineTimer = 0;
    const t = this.ctx.currentTime;
    const ratio = Math.min(1, Math.max(0, speedRatio));
    const g = ratio * ENGINE_GEARS;
    const gear = Math.min(ENGINE_GEARS - 1, Math.floor(g));
    const frac = g - gear;
    const rpm = gear === 0 ? 0.2 + frac * 0.8 : 0.35 + frac * 0.65;
    const pitch = boosting ? 1.12 : 1;
    const freq = (42 + rpm * 95 + gear * 4) * pitch;
    const e = this.engine;
    e.saw.frequency.setTargetAtTime(freq, t, 0.04);
    e.square.frequency.setTargetAtTime(freq * 0.505, t, 0.04);
    e.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.04);
    e.filter.frequency.setTargetAtTime(350 + rpm * 1500 + throttle * 500 + (boosting ? 1200 : 0), t, 0.05);
    let volume = active ? 0.05 + throttle * 0.035 + rpm * 0.03 + (boosting ? 0.03 : 0) : 0;
    if (active && gear > this.lastGear) volume *= 0.3; // shift dip
    this.lastGear = gear;
    e.gain.gain.setTargetAtTime(volume, t, 0.08);
    e.turbo.frequency.setTargetAtTime(1400 + rpm * 2200 + (boosting ? 900 : 0), t, 0.05);
    e.turboGain.gain.setTargetAtTime(active ? (throttle * rpm * 0.012 + (boosting ? 0.018 : 0)) : 0, t, 0.1);
    e.send.gain.setTargetAtTime(active && inTunnel ? 0.45 : 0, t, 0.2);
    const L = this.loops;
    L.wind.gain.gain.setTargetAtTime(active ? ratio * ratio * 0.09 + slipstream * 0.05 : 0, t, 0.1);
    L.wind.filter.frequency.setTargetAtTime(500 + ratio * 1500 + slipstream * 900, t, 0.1);
    L.tires.gain.gain.setTargetAtTime(active ? this.tireLevel * 0.12 : 0, t, 0.05);
  }

  // Called while tyres are screeching (hard braking / cornering).
  tires(dt) {
    this.tireLevel = Math.min(1, this.tireLevel + dt * 8);
  }

  rain(level) {
    if (!this.loops) return;
    this.loops.rain.gain.gain.setTargetAtTime(level * 0.08, this.ctx.currentTime, 0.4);
  }

  // Police siren: a square wave swept by a slow LFO. Nodes exist only during a pursuit.
  siren(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (on && !this.sirenNodes) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 900;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.8;
      const depth = ctx.createGain();
      depth.gain.value = 300;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2200;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.035, t, 0.3);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.buses.sfx);
      osc.start();
      lfo.start();
      this.sirenNodes = { osc, lfo, gain };
    } else if (!on && this.sirenNodes) {
      const n = this.sirenNodes;
      this.sirenNodes = null;
      n.gain.gain.setTargetAtTime(0, t, 0.2);
      n.osc.stop(t + 1);
      n.lfo.stop(t + 1);
    }
  }

  // ---------------------------------------------------------------- one-shots

  tone(freq, duration, type = 'sine', volume = 0.15, delay = 0, slideTo = 0) {
    if (!this.ctx || this.paused) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(this.buses.sfx);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  noise(duration, filterType, from, to, volume, delay = 0, q = 1, pan = 0) {
    if (!this.ctx || this.paused) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(gain);
    if (pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(this.buses.sfx);
    } else {
      gain.connect(this.buses.sfx);
    }
    src.start(t, Math.random() * Math.max(0, 1.9 - duration));
    src.stop(t + duration + 0.05);
  }

  crash(intensity = 1) {
    this.noise(0.55, 'lowpass', 3000, 150, 0.9 * intensity);
    this.tone(120, 0.4, 'sine', 0.6 * intensity, 0, 35);
    this.tone(700 + Math.random() * 400, 0.15, 'square', 0.07 * intensity);
    this.noise(0.25, 'highpass', 5000, 2500, 0.2 * intensity, 0.03);
  }

  scrape() {
    this.noise(0.14, 'bandpass', 3500, 2500, 0.16, 0, 8);
  }

  boost() {
    this.noise(0.7, 'bandpass', 250, 3500, 0.45, 0, 1.5);
    this.tone(90, 0.6, 'sawtooth', 0.07, 0, 260);
  }

  pickup(kind) {
    const notes = kind === 'repair' ? [523, 659, 784] : kind === 'credits' ? [988, 1319, 1976] : [660, 990, 1320];
    for (let i = 0; i < notes.length; i++) this.tone(notes[i], 0.14, 'triangle', 0.16, i * 0.055);
  }

  // grade: 0 close, 1 very close, 2 insane — louder, brighter whoosh plus a rising chime.
  nearMiss(side, grade = 0) {
    this.noise(0.28 + grade * 0.08, 'bandpass', 600, 2600 + grade * 900, 0.35 + grade * 0.12, 0, 2, side * 0.7);
    this.tone(1560 + grade * 260, 0.08, 'sine', 0.05 + grade * 0.02, 0.03);
    if (grade >= 2) {
      this.tone(2090, 0.18, 'triangle', 0.08, 0.08);
      this.tone(2790, 0.22, 'sine', 0.06, 0.14);
    }
  }

  overtake() {
    this.tone(1250, 0.05, 'sine', 0.04);
  }

  perfect() {
    this.tone(988, 0.08, 'triangle', 0.09);
    this.tone(1480, 0.14, 'triangle', 0.09, 0.06);
  }

  // Rising two-note stinger; pitch climbs with the combo tier.
  comboUp(tier) {
    const base = 440 * Math.pow(2, tier / 6);
    this.tone(base, 0.1, 'square', 0.06);
    this.tone(base * 1.5, 0.18, 'square', 0.06, 0.08);
    if (tier >= 4) this.tone(base * 2, 0.25, 'sawtooth', 0.04, 0.16);
  }

  comboDown() {
    this.tone(520, 0.18, 'triangle', 0.06, 0, 300);
  }

  // Countdown beeps with an engine rev blip on each count.
  countdown(go, step) {
    if (go) {
      this.tone(880, 0.5, 'square', 0.1);
      this.tone(1320, 0.5, 'sine', 0.08);
      this.tone(70, 0.6, 'sawtooth', 0.12, 0, 190);
    } else {
      this.tone(440, 0.2, 'square', 0.1);
      this.tone(55 + (3 - step) * 12, 0.35, 'sawtooth', 0.1, 0, 120 + (3 - step) * 30);
    }
  }

  eventWarn(good) {
    if (good) {
      this.tone(660, 0.12, 'triangle', 0.08);
      this.tone(990, 0.2, 'triangle', 0.08, 0.1);
    } else {
      this.tone(740, 0.14, 'square', 0.06);
      this.tone(740, 0.14, 'square', 0.06, 0.22);
    }
  }

  escape() {
    const notes = [523, 659, 784, 1047, 1319];
    for (let i = 0; i < notes.length; i++) this.tone(notes[i], 0.2, 'triangle', 0.1, i * 0.06);
  }

  thunder(intensity) {
    this.noise(1.8, 'lowpass', 600, 60, 0.7 * intensity);
    this.tone(55, 1.2, 'sine', 0.35 * intensity, 0.05, 30);
  }

  checkpoint() {
    const notes = [784, 988, 1175];
    for (let i = 0; i < notes.length; i++) this.tone(notes[i], 0.16, 'triangle', 0.14, i * 0.07);
  }

  record() {
    const notes = [523, 659, 784, 1047];
    for (let i = 0; i < notes.length; i++) this.tone(notes[i], 0.2, 'square', 0.07, i * 0.08);
  }

  gameOver() {
    this.tone(440, 0.3, 'sawtooth', 0.09, 0, 220);
    this.tone(330, 0.55, 'sawtooth', 0.09, 0.25, 110);
  }

  ui(kind) {
    if (kind === 'hover') {
      this.tone(1800, 0.03, 'sine', 0.03);
    } else if (kind === 'deny') {
      this.tone(220, 0.12, 'square', 0.07);
      this.tone(180, 0.16, 'square', 0.07, 0.08);
    } else if (kind === 'confirm') {
      this.tone(660, 0.07, 'square', 0.06);
      this.tone(990, 0.1, 'square', 0.06, 0.06);
      this.tone(1320, 0.14, 'triangle', 0.06, 0.12);
    } else {
      this.tone(700, 0.06, 'square', 0.06);
      this.tone(1050, 0.08, 'square', 0.05, 0.05);
    }
  }

  purchase() {
    this.noise(0.25, 'bandpass', 800, 4000, 0.2, 0, 3);
    const notes = [784, 1047, 1319, 1568];
    for (let i = 0; i < notes.length; i++) this.tone(notes[i], 0.12, 'triangle', 0.1, i * 0.05);
  }

  achievement() {
    const notes = [880, 1109, 1319, 1760];
    for (let i = 0; i < notes.length; i++) this.tone(notes[i], 0.22, 'sine', 0.09, i * 0.07);
    this.tone(440, 0.5, 'triangle', 0.05, 0.05);
  }

  levelUp() {
    const notes = [523, 659, 784, 1047, 1319];
    for (let i = 0; i < notes.length; i++) this.tone(notes[i], 0.25, 'square', 0.06, i * 0.09);
  }
}
