// Subtle haptic feedback via the Vibration API (Android browsers; iOS Safari does not expose it,
// so there this is a silent no-op). Short pulses only — never continuous vibration — with a rate
// limit so a burst of near misses doesn't turn into a buzz.

const PATTERNS = {
  tap: 8, // UI press
  near: 12, // near miss
  boost: 25, // boost ignition
  unlock: [14, 60, 14], // achievement / unlock
  hit: 45, // side swipe
  crash: [70, 40, 90], // heavy collision / wreck
};
const MIN_GAP_MS = 70;

export class Haptics {
  constructor() {
    this.supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
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
    try {
      navigator.vibrate(PATTERNS[kind] || 10);
    } catch {
      /* some embedded browsers throw instead of ignoring */
    }
  }

  stop() {
    if (!this.supported) return;
    try {
      navigator.vibrate(0);
    } catch {
      /* ignore */
    }
  }
}
