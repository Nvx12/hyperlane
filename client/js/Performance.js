// Render budget, graphics quality and frame pacing for phones.
//
// Quality only changes cosmetics and render resolution — traffic, physics, collisions and scoring
// are identical at every level. The canvas is never sized at CSS px × full devicePixelRatio:
// each tier caps the effective DPR *and* the total pixel count, because on phones the limit is
// GPU fill rate (a 20:9 screen at DPR 3 would otherwise be ~3 million pixels per frame).

export const QUALITY_LEVELS = ['low', 'medium', 'high'];

export const QUALITY = {
  // detail: 0..1 cosmetic density (rain, skyline windows, speed streaks, dust, trails)
  low: { detail: 0.35, maxDpr: 1, pixels: 0.5e6, particles: 140 },
  medium: { detail: 0.65, maxDpr: 1.5, pixels: 1.0e6, particles: 300 },
  high: { detail: 1, maxDpr: 2, pixels: 1.7e6, particles: 520 },
};

// AUTO ladder below LOW: shave render resolution, then halve the frame rate (stable 30 beats a
// stuttering 45). Only reached when the device is genuinely struggling.
const EXTRA_STEPS = [{ scale: 0.85 }, { scale: 0.75 }, { scale: 0.75, fps: 30 }];

const SLOW_RATIO = 1.1; // AUTO: average interval above target × this (≈55 fps at 60) = step cosmetics down
const FLOOR_RATIO = 1.3; // manual tiers: only fall back to 30 fps below ≈46 fps (a choice is respected)
const SLOW_GRACE = 3; // seconds of struggle before stepping down
const FAST_CPU_RATIO = 0.35; // CPU work under this share of the budget = headroom
const FAST_GRACE = 12; // seconds of headroom before trying one step up (AUTO only)

// Initial AUTO tier from coarse capability signals — never from the user-agent string. It is only
// a starting point: the measured frame times take over after a few seconds of racing.
export function detectLevel(nav = navigator) {
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory; // Chromium only; undefined on Safari/Firefox
  if ((mem && mem <= 2) || cores <= 2) return 0;
  if (mem && mem >= 6 && cores >= 8) return 2;
  return 1;
}

export class PerformanceManager {
  constructor() {
    this.mode = 'auto';
    this.fpsSetting = 'auto';
    this.step = 1; // index into the ladder: 0 high, 1 medium, 2 low, 3+ extra steps
    this.ceiling = 0; // best step allowed (raised after a failed step-up)
    this.frameAvg = 16.7;
    this.workAvg = 4;
    this.slowTime = 0;
    this.fastTime = 0;
    this.lastProcessed = 0;
    this.floor30 = false; // manual tiers with FPS "auto": 30 fps fallback when struggling
    this.probing = -1; // step we moved up to on trial; failing there pins the ceiling below it
    this.changed = false; // set when the learned AUTO level should be saved
  }

  // settings.quality: auto | low | medium | high; settings.fps: auto | 30 | 60
  configure(settings) {
    const key = `${settings.quality}|${settings.fps}`;
    if (key === this.configKey) return; // only a real quality/FPS change resets adaptation
    this.configKey = key;
    this.fpsSetting = settings.fps;
    if (settings.quality === 'auto') {
      if (this.mode !== 'auto') {
        const learned = settings.autoLevel;
        this.step = 2 - (learned >= 0 ? learned : detectLevel());
        this.ceiling = 0;
      }
      this.mode = 'auto';
    } else {
      this.mode = settings.quality;
      this.step = 2 - QUALITY_LEVELS.indexOf(settings.quality);
      this.ceiling = this.step;
    }
    this.slowTime = 0;
    this.fastTime = 0;
    this.floor30 = false;
    this.probing = -1;
  }

  get levelName() {
    return QUALITY_LEVELS[Math.max(0, 2 - Math.min(this.step, 2))];
  }

  get preset() {
    return QUALITY[this.levelName];
  }

  // Level (0..2) worth remembering for the next session, or -1 when not in AUTO.
  get learnedLevel() {
    return this.mode === 'auto' ? 2 - Math.min(this.step, 2) : -1;
  }

  get extra() {
    return this.step > 2 ? EXTRA_STEPS[this.step - 3] : null;
  }

  get targetFps() {
    if (this.fpsSetting === '30') return 30;
    if (this.fpsSetting === '60') return 60;
    const extra = this.extra;
    return (extra && extra.fps) || this.floor30 ? 30 : 60;
  }

  // Internal render scale for a CSS viewport. Never above the tier's DPR cap or pixel budget,
  // never below native 1× unless the AUTO ladder asked for it.
  renderScale(cssW, cssH, dpr) {
    const q = this.preset;
    const budget = Math.max(1, Math.sqrt(q.pixels / (cssW * cssH)));
    let scale = Math.min(dpr || 1, q.maxDpr, budget);
    const extra = this.extra;
    if (extra && extra.scale) scale = Math.min(scale, extra.scale);
    return scale;
  }

  // Frame pacing: returns false for rAF callbacks that should be skipped. Caps 90/120 Hz
  // displays at 60 fps (battery, heat) and implements the 30 fps mode.
  // Menus render the attract drive at 30 fps: nobody needs 60 behind a menu, and phones stay cool.
  shouldProcess(now, inMenu) {
    const fps = inMenu ? 30 : this.targetFps;
    const minInterval = 1000 / fps - 2;
    if (now - this.lastProcessed < minInterval) return false;
    this.lastProcessed = now;
    return true;
  }

  // Feed one processed frame: interval since the previous processed frame and the CPU time the
  // frame took. Returns true when the effective quality changed (caller re-applies settings).
  sample(intervalMs, workMs, racing) {
    if (intervalMs <= 0 || intervalMs > 250) return false;
    this.frameAvg += (intervalMs - this.frameAvg) * 0.05;
    this.workAvg += (workMs - this.workAvg) * 0.05;
    if (!racing) {
      this.slowTime = 0;
      this.fastTime = 0;
      return false;
    }
    const target = 1000 / this.targetFps;
    const dt = intervalMs / 1000;
    const slowRatio = this.mode === 'auto' ? SLOW_RATIO : FLOOR_RATIO;
    if (this.frameAvg > target * slowRatio) {
      this.fastTime = 0;
      this.slowTime += dt;
      if (this.slowTime < SLOW_GRACE) return false;
      this.slowTime = 0;
      this.frameAvg = target;
      if (this.mode === 'auto') {
        if (this.step >= 2 + EXTRA_STEPS.length) return false;
        // A trial step-up that fails pins the ceiling: never retry above it this session.
        if (this.step === this.probing) this.ceiling = this.step + 1;
        this.probing = -1;
        this.step++;
        this.changed = true;
        return true;
      }
      // Manual tiers keep the player's resolution; their only fallback is 30 fps (FPS "auto").
      if (this.fpsSetting !== 'auto' || this.floor30) return false;
      this.floor30 = true;
      return true;
    }
    this.slowTime = 0;
    // Step up only on real CPU headroom at the target rate (AUTO only, one tier at a time).
    if (this.mode === 'auto' && this.step > this.ceiling && this.workAvg < target * FAST_CPU_RATIO && this.frameAvg < target * 1.08) {
      this.fastTime += dt;
      if (this.fastTime > FAST_GRACE) {
        this.fastTime = 0;
        this.step--;
        this.probing = this.step;
        this.changed = true;
        return true;
      }
    } else {
      this.fastTime = 0;
    }
    return false;
  }
}
