import { hasPlugin, call } from './native.js';

// Subtle haptic feedback. In the native app it uses the OS haptics engine (Capacitor Haptics:
// real taptic/vibrator effects on Android and iPhone); in browsers the Vibration API (Android;
// iOS Safari doesn't expose it, so there it's a silent no-op). Short pulses only — never
// continuous vibration — with a rate limit so a burst of near misses doesn't turn into a buzz.
// One call per game event, never per frame; failures are ignored (gameplay never depends on it).

const PATTERNS = {
  tap: 8, // UI press
  near: 12, // near miss
  boost: 25, // boost ignition
  unlock: [14, 60, 14], // achievement / unlock
  hit: 45, // side swipe
  crash: [70, 40, 90], // heavy collision / wreck
};
// Native equivalents of the patterns above.
const NATIVE = {
  tap: ['impact', { style: 'LIGHT' }],
  near: ['impact', { style: 'LIGHT' }],
  boost: ['impact', { style: 'MEDIUM' }],
  unlock: ['notification', { type: 'SUCCESS' }],
  hit: ['impact', { style: 'MEDIUM' }],
  crash: ['impact', { style: 'HEAVY' }],
};
const MIN_GAP_MS = 70;

export class Haptics {
  constructor() {
    this.native = hasPlugin('Haptics');
    this.supported = this.native || (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function');
    this.enabled = true;
    this.last = 0;
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!this.enabled) this.stop();
  }

  pulse(kind) {
    if (!this.supported || !this.enabled || document.hidden) return;
    const now = performance.now();
    // Crashes always get through; everything else respects the gap.
    if (kind !== 'crash' && now - this.last < MIN_GAP_MS) return;
    this.last = now;
    if (this.native) {
      const [method, options] = NATIVE[kind] || NATIVE.tap;
      call('Haptics', method, options);
      return;
    }
    try {
      navigator.vibrate(PATTERNS[kind] || 10);
    } catch {
      /* some embedded browsers throw instead of ignoring */
    }
  }

  stop() {
    if (!this.supported || this.native) return; // native effects are one-shot: nothing to stop
    try {
      navigator.vibrate(0);
    } catch {
      /* ignore */
    }
  }
}
