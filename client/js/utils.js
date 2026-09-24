export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpRange = (range, t) => range[0] + (range[1] - range[0]) * t;
export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
export const sign = v => (v < 0 ? -1 : 1);

// Frame-rate independent exponential smoothing toward a target.
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

export const approach = (current, target, maxDelta) =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);

export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

// Mixes a #rrggbb color toward white (amount > 0) or black (amount < 0).
export function shadeColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  const r = Math.round(((n >> 16) & 255) + (target - ((n >> 16) & 255)) * p);
  const g = Math.round(((n >> 8) & 255) + (target - ((n >> 8) & 255)) * p);
  const b = Math.round((n & 255) + (target - (n & 255)) * p);
  return `rgb(${r},${g},${b})`;
}
