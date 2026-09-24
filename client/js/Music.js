// Procedural synthwave loop. A look-ahead scheduler (setInterval, not the render loop) queues
// 16th notes slightly ahead of time; intensity (speed / combo / pursuit) fades layers in and out.

const BPM = 112;
const STEP = 60 / BPM / 4; // 16th note
const LOOKAHEAD = 0.12;
const TICK_MS = 30;

// Am – F – C – G, one bar each. Root in Hz (octave 2) and chord tones for the arpeggio.
const PROGRESSION = [
  { root: 110, chord: [440, 523.25, 659.25] },
  { root: 87.31, chord: [349.23, 440, 523.25] },
  { root: 130.81, chord: [392, 523.25, 659.25] },
  { root: 98, chord: [392, 493.88, 587.33] },
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1];
const BASS = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1];

export class Music {
  constructor(ctx, output, noiseBuffer) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1800;
    this.out.connect(this.filter);
    this.filter.connect(output);
    this.noise = noiseBuffer;
    this.step = 0;
    this.nextTime = 0;
    this.timer = 0;
    this.intensity = 0;
    this.mode = 'menu';
    this.enabled = false;
  }

  setEnabled(enabled) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.nextTime = this.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this.schedule(), TICK_MS);
      this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 0.5);
    } else {
      clearInterval(this.timer);
      this.timer = 0;
      this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
  }

  setMode(mode) {
    this.mode = mode;
    const t = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(mode === 'wreck' ? 380 : mode === 'menu' ? 1400 : 2600, t, 0.4);
  }

  setIntensity(v) {
    this.intensity = v;
  }

  schedule() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t) {
    const bar = PROGRESSION[(step >> 4) & 3];
    const s = step & 15;
    const race = this.mode === 'race';
    const i = race ? this.intensity : 0.15;

    if (s === 0) this.pad(bar, t);
    if (BASS[s] && (race || s % 4 === 0)) this.bass(bar.root, t, 0.16 + i * 0.08);
    if (race && i > 0.2 && s % 4 === 0) this.kick(t, 0.5 + i * 0.3);
    if (race && i > 0.4 && s % 2 === 1) this.hat(t, 0.05 + i * 0.05);
    if (race && i > 0.6 && (s === 4 || s === 12)) this.snare(t, 0.18);
    if (i > 0.3 || !race) this.arp(bar.chord[ARP[s]] * (i > 0.75 ? 2 : 1), t, race ? 0.035 + i * 0.03 : 0.025);
    if (race && i > 0.84 && s % 8 === 6) this.bass(bar.root * 4, t, 0.05); // pursuit tension stab
  }

  voice(type, freq, t, dur, vol, attack = 0.005) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    return osc;
  }

  pad(bar, t) {
    const dur = STEP * 16;
    for (let n = 0; n < bar.chord.length; n++) {
      const osc = this.voice('sawtooth', bar.chord[n] / 2, t, dur, 0.022, 0.4);
      osc.detune.setValueAtTime(n % 2 ? 7 : -7, t);
    }
  }

  bass(freq, t, vol) {
    this.voice('sawtooth', freq, t, STEP * 0.9, vol);
  }

  arp(freq, t, vol) {
    this.voice('square', freq, t, STEP * 0.8, vol);
  }

  kick(t, vol) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g);
    g.connect(this.out);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  noiseHit(t, vol, dur, type, freq) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  hat(t, vol) {
    this.noiseHit(t, vol, 0.05, 'highpass', 7000);
  }

  snare(t, vol) {
    this.noiseHit(t, vol, 0.16, 'bandpass', 1800);
  }
}
