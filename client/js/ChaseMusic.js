// The police chase track: one decoded AudioBuffer, played by at most one AudioBufferSourceNode
// at a time through gain → heat filter → the music bus. Web Audio loop points (not an <audio>
// element) give a gapless loop of a configured section: startTime → loopEnd once, then
// loopStart → loopEnd. Suspending the AudioContext (pause, background) freezes it in place.
export class ChaseMusic {
  constructor(ctx, output, cfg) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.buffer = null;
    this.status = 'idle'; // idle · loading · ready · missing · error · disabled
    this.source = null;
    this.stopAt = 0; // context time the current source is scheduled to stop (0 = not stopping)
    this.heatLevel = 0;
    this.starts = 0; // sources created (debug: proves no overlap / no restart per unit)
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = cfg.heatCutoff[0];
    this.filter.Q.value = 0.5;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.filter);
    this.filter.connect(output);
  }

  get ready() {
    return this.status === 'ready';
  }

  // True while audible or fading in; false once a fade-out has been scheduled.
  get playing() {
    return Boolean(this.source) && this.stopAt === 0;
  }

  // Decodes once; the encoded bytes may already have been fetched (see prefetch in AudioManager).
  async load(bytesPromise) {
    if (this.status !== 'idle') return;
    if (!this.cfg.enabled || !this.cfg.file) {
      this.status = 'disabled';
      return;
    }
    this.status = 'loading';
    try {
      const bytes = await bytesPromise;
      if (!bytes) {
        this.status = 'missing';
        return;
      }
      // decodeAudioData detaches the ArrayBuffer; it runs off the main thread in browsers.
      this.buffer = await new Promise((resolve, reject) => this.ctx.decodeAudioData(bytes, resolve, reject));
      this.section = this.resolveSection(this.buffer.duration);
      this.status = 'ready';
    } catch {
      this.buffer = null;
      this.status = 'error';
    }
  }

  // Clamps the configured points to the file so a typo can't produce silence or a crash.
  resolveSection(duration) {
    const c = this.cfg;
    const end = c.loopEnd && c.loopEnd > 0 && c.loopEnd <= duration ? c.loopEnd : duration;
    const loopStart = c.loopStart >= 0 && c.loopStart < end - 0.25 ? c.loopStart : 0;
    const start = c.startTime >= 0 && c.startTime < end - 0.05 ? c.startTime : loopStart;
    return { start, loopStart, loopEnd: end };
  }

  // Fade in over `fade` seconds. If the previous chase is still fading out, it is brought back
  // up instead of starting a second copy (no overlap, no restart from the entry point).
  start(fade) {
    if (!this.ready) return false;
    const t = this.ctx.currentTime;
    const target = this.cfg.volume * this.cfg.heatGain[this.heatLevel];
    if (this.source && this.stopAt > t) {
      this.stopAt = 0; // cancel the pending stop (see tick)
      this.ramp(target, fade * 0.5);
      return true;
    }
    this.kill();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.loopStart = this.section.loopStart;
    src.loopEnd = this.section.loopEnd;
    src.connect(this.gain);
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(0, t);
    this.gain.gain.linearRampToValueAtTime(target, t + fade);
    src.start(t, this.section.start);
    this.source = src;
    this.stopAt = 0;
    this.starts++;
    return true;
  }

  // Keep playing for `hold` seconds, then fade out over `fade` and stop the source.
  // A second call may only shorten a fade already under way (bust, then a wreck).
  stop(fade, hold = 0) {
    if (!this.source) return;
    const t = this.ctx.currentTime;
    if (this.stopAt && t + hold + fade + 0.05 >= this.stopAt) return;
    const g = this.gain.gain;
    const now = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(now, t);
    g.setValueAtTime(now, t + hold);
    g.linearRampToValueAtTime(0, t + hold + fade);
    this.stopAt = t + hold + fade + 0.05;
  }

  // Called every frame: stops the source once its fade-out has finished. (Done here rather than
  // with a scheduled source.stop() so a new chase can still take the fading track back.)
  tick() {
    if (this.source && this.stopAt && this.ctx.currentTime >= this.stopAt) this.kill();
  }

  // Immediate silence (restart, leaving the race): no tail, nothing left running.
  kill() {
    if (!this.source) return;
    const src = this.source;
    this.source = null;
    this.stopAt = 0;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    src.disconnect();
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
  }

  // Heat treatment: the filter opens and the level rises a little with each star.
  setHeat(level) {
    this.heatLevel = Math.max(0, Math.min(5, level | 0));
    const t = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(this.cfg.heatCutoff[this.heatLevel], t, 0.6);
    if (this.playing) this.ramp(this.cfg.volume * this.cfg.heatGain[this.heatLevel], 0.8);
  }

  ramp(value, time) {
    const t = this.ctx.currentTime;
    const g = this.gain.gain;
    const now = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(now, t);
    g.linearRampToValueAtTime(value, t + Math.max(0.02, time));
  }
}
