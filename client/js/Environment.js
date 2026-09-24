import { ENVIRONMENTS, TIME_OF_DAY, TIME_CYCLE } from './data/environments.js';
import { WORLD } from './balance.js';
import { createCanvas, rand, clamp } from './utils.js';

const PALETTE_KEYS = ['groundA', 'groundB', 'shoulder', 'roadA', 'roadB', 'rumbleA', 'rumbleB', 'wallA', 'wallB',
  'wallTop', 'slit', 'lane', 'edge', 'marker', 'tunnel', 'tunnelLight'];
const SURFACE_KEYS = new Set(['groundA', 'groundB', 'shoulder', 'roadA', 'roadB', 'wallA', 'wallB', 'tunnel']);
const WET_KEYS = new Set(['roadA', 'roadB', 'shoulder']);
const ENV_BY_ID = new Map(ENVIRONMENTS.map(e => [e.id, e]));
const BACKDROP_CACHE_LIMIT = 9;

const hexToRgb = hex => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const parseRgb = s => s.split(',').map(Number);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Deterministic 0..1 hash for per-segment prop placement.
export const hash01 = n => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const getEnvironment = id => ENV_BY_ID.get(id) || ENVIRONMENTS[0];

function skyStops(env, todKey) {
  return (env.sky && env.sky[todKey]) || TIME_OF_DAY[todKey].sky;
}

// Raw (unformatted) palette for an environment at a time of day and road wetness.
function computePalette(env, todKey, wet) {
  const tod = TIME_OF_DAY[todKey];
  const fog = parseRgb(env.fogTint && todKey !== 'night' ? env.fogTint : tod.fog);
  const out = { lamps: tod.lamps, windows: tod.windows, hazeAlpha: tod.hazeAlpha, fog, stars: tod.stars };
  for (const key of PALETTE_KEYS) {
    const hex = env.base[key];
    if (!hex) {
      out[key] = null;
      continue;
    }
    let c = hexToRgb(hex);
    if (SURFACE_KEYS.has(key)) {
      const light = WET_KEYS.has(key) ? tod.light * (1 - 0.22 * wet) : tod.light;
      c = [Math.min(255, c[0] * light), Math.min(255, c[1] * light), Math.min(255, c[2] * light)];
      c = mix(c, fog, 0.1);
    } else {
      c = mix(c, fog, 0.04);
    }
    out[key] = c;
  }
  return out;
}

// Active route, time of day and their transitions. Produces the per-frame road palette
// (as reusable strings, recomputed only when a blend or wetness step changes) and the
// cached sky/skyline canvases that are crossfaded during transitions.
export class Environment {
  constructor() {
    this.env = ENVIRONMENTS[0];
    this.tod = this.env.time;
    this.from = null; // { env, tod } during a transition
    this.blend = 1;
    this.blendStart = 0;
    this.blendStep = -1;
    this.wet = 0;
    this.wetStep = -1;
    this.tour = false;
    this.aurora = false;
    this.nextTodAt = 0;
    this.nextEnvAt = 0;
    this.detail = 1;
    this.cache = new Map();
    this.back = null; // { sky, far, near } for the current route/time
    this.backFrom = null; // the same for the route/time being blended out
    this.w = 1;
    this.h = 1;
    this.horizon = 1;
    this.palette = {};
    this.fogRgb = [0, 0, 0];
    this.lampAlpha = 1;
    this.props = buildProps();
    this.dirty = true;
  }

  rebuildProps() {
    this.props = buildProps();
  }

  start(envId, tour = false, allowRare = false) {
    this.env = getEnvironment(envId);
    this.tod = this.env.time;
    this.from = null;
    this.back = null;
    this.backFrom = null;
    this.blend = 1;
    this.tour = tour;
    this.aurora = allowRare && this.tod === 'night' && Math.random() < WORLD.AURORA_CHANCE;
    this.nextTodAt = WORLD.TIME_DISTANCE;
    this.nextEnvAt = WORLD.TOUR_DISTANCE;
    this.dirty = true;
  }

  get isTransitioning() {
    return this.from !== null;
  }

  resize(w, h, horizon) {
    this.w = w;
    this.h = h;
    this.horizon = horizon;
    this.clearBackdrops();
    this.dirty = true;
  }

  setDetail(detail) {
    if (detail === this.detail) return;
    this.detail = detail;
    this.clearBackdrops();
  }

  clearBackdrops() {
    this.cache.clear();
    this.back = null;
    this.backFrom = null;
  }

  beginTransition(env, tod, distance) {
    this.from = { env: this.env, tod: this.tod };
    this.backFrom = this.back;
    this.back = null;
    this.env = env;
    this.tod = tod;
    this.blendStart = distance;
    this.blend = 0;
    this.blendStep = -1;
  }

  // Builds the next time-of-day / route backdrops shortly before they're needed, one canvas
  // per frame, so transitions never hitch.
  prewarm(distance) {
    if (this.from) return;
    let env = this.env;
    let tod = this.tod;
    if (distance >= this.nextTodAt - WORLD.PREWARM_DISTANCE) {
      tod = TIME_CYCLE[(TIME_CYCLE.indexOf(this.tod) + 1) % TIME_CYCLE.length];
    } else if (this.tour && distance >= this.nextEnvAt - WORLD.PREWARM_DISTANCE) {
      env = ENVIRONMENTS[(ENVIRONMENTS.indexOf(this.env) + 1) % ENVIRONMENTS.length];
    } else {
      return;
    }
    if (!this.cache.has(this.skyKey(env, tod))) this.sky(env, tod);
    else if (!this.cache.has(`line|${env.id}|${tod}|false`)) this.skyline(env, tod, false);
    else if (!this.cache.has(`line|${env.id}|${tod}|true`)) this.skyline(env, tod, true);
  }

  update(distance, wet) {
    this.prewarm(distance);
    if (!this.from) {
      if (distance >= this.nextTodAt) {
        this.nextTodAt += WORLD.TIME_DISTANCE;
        const next = TIME_CYCLE[(TIME_CYCLE.indexOf(this.tod) + 1) % TIME_CYCLE.length];
        this.beginTransition(this.env, next, distance);
      } else if (this.tour && distance >= this.nextEnvAt) {
        this.nextEnvAt += WORLD.TOUR_DISTANCE;
        const idx = ENVIRONMENTS.indexOf(this.env);
        this.beginTransition(ENVIRONMENTS[(idx + 1) % ENVIRONMENTS.length], this.tod, distance);
      }
    }
    if (this.from) {
      this.blend = clamp((distance - this.blendStart) / WORLD.BLEND_DISTANCE, 0, 1);
      const step = Math.round(this.blend * 40);
      if (step !== this.blendStep) {
        this.blendStep = step;
        this.dirty = true;
      }
      if (this.blend >= 1) {
        this.from = null;
        this.backFrom = null;
        this.dirty = true;
      }
    }
    const wetStep = Math.round(wet * 20);
    if (wetStep !== this.wetStep) {
      this.wetStep = wetStep;
      this.wet = wet;
      this.dirty = true;
    }
    if (this.dirty) this.recomputePalette();
  }

  recomputePalette() {
    this.dirty = false;
    const to = computePalette(this.env, this.tod, this.wet);
    let p = to;
    if (this.from) {
      const from = computePalette(this.from.env, this.from.tod, this.wet);
      const t = this.blendStep / 40;
      p = { ...to };
      for (const key of PALETTE_KEYS) {
        if (!from[key] || !to[key]) p[key] = t < 0.5 ? from[key] : to[key];
        else p[key] = mix(from[key], to[key], t);
      }
      p.lamps = from.lamps + (to.lamps - from.lamps) * t;
      p.fog = mix(from.fog, to.fog, t);
    }
    const out = this.palette;
    for (const key of PALETTE_KEYS) out[key] = p[key] ? rgb(p[key]) : null;
    out.laneGlow = rgba(p.lane, 0.16);
    out.edgeGlow = rgba(p.edge, 0.2);
    out.wallGlow = rgba(p.wallTop, 0.16);
    out.slit = p.slit ? rgba(p.slit, 0.75) : null;
    this.fogRgb = p.fog;
    this.lampAlpha = p.lamps;
  }

  // ---------------------------------------------------------------- cached backdrops

  skyKey(env, tod) {
    return `sky|${env.id}|${tod}|${this.aurora && tod === 'night'}`;
  }

  // Small LRU: backdrops are full-width canvases, so only the handful in use (current,
  // transitioning, prewarmed) stay alive; a world tour would otherwise hoard ~45 of them.
  cached(key, build) {
    let c = this.cache.get(key);
    if (c) {
      this.cache.delete(key);
      this.cache.set(key, c);
      return c;
    }
    c = build();
    this.cache.set(key, c);
    if (this.cache.size > BACKDROP_CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
    return c;
  }

  sky(env, tod) {
    return this.cached(this.skyKey(env, tod), () => buildSky(env, tod, this.w, this.h, this.horizon, this.aurora && tod === 'night', this.detail));
  }

  skyline(env, tod, near) {
    return this.cached(`line|${env.id}|${tod}|${near}`, () => buildSkyline(env, tod, this.w, this.h, near, this.detail));
  }

  backdrop(env, tod) {
    return { sky: this.sky(env, tod), far: this.skyline(env, tod, false), near: this.skyline(env, tod, true) };
  }

  // Canvas references are resolved only when the route/time/size changes, never per frame.
  ensureBackdrops() {
    if (!this.back) this.back = this.backdrop(this.env, this.tod);
    if (this.from && !this.backFrom) this.backFrom = this.backdrop(this.from.env, this.from.tod);
  }

  renderSky(ctx) {
    this.ensureBackdrops();
    if (this.from) {
      ctx.drawImage(this.backFrom.sky, 0, 0);
      ctx.globalAlpha = this.blend;
      ctx.drawImage(this.back.sky, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      ctx.drawImage(this.back.sky, 0, 0);
    }
  }

  renderSkyline(ctx, cam, offset) {
    this.ensureBackdrops();
    const scale = cam.width / 1280;
    if (this.from) {
      ctx.globalAlpha = 1 - this.blend;
      drawLayers(ctx, cam, this.backFrom, offset, scale);
      ctx.globalAlpha = this.blend;
    }
    drawLayers(ctx, cam, this.back, offset, scale);
    ctx.globalAlpha = 1;
  }
}

function drawLayers(ctx, cam, back, offset, scale) {
  drawTiled(ctx, back.far, offset * 0.45 * scale, cam.horizonY - back.far.height + 4);
  drawTiled(ctx, back.near, offset * scale, cam.horizonY - back.near.height + 4);
}

function drawTiled(ctx, tile, offset, y) {
  const w = tile.width;
  const ox = ((offset % w) + w) % w;
  ctx.drawImage(tile, -ox - w, y);
  ctx.drawImage(tile, -ox, y);
  ctx.drawImage(tile, -ox + w, y);
}

// ---------------------------------------------------------------- sky

function buildSky(env, todKey, w, h, horizon, aurora, detail) {
  const tod = TIME_OF_DAY[todKey];
  const stops = skyStops(env, todKey);
  const height = horizon + Math.ceil(h * 0.12);
  const c = createCanvas(w, height);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.5, stops[1]);
  g.addColorStop(0.85, stops[2]);
  g.addColorStop(1, stops[3]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, height);

  const stars = Math.round(((w * h) / 6500) * tod.stars * (0.4 + 0.6 * detail));
  for (let i = 0; i < stars; i++) {
    ctx.globalAlpha = rand(0.15, 0.85);
    ctx.fillStyle = Math.random() < 0.15 ? '#9ff4ff' : '#ffffff';
    const s = Math.random() < 0.08 ? 2 : 1;
    ctx.fillRect(Math.random() * w, Math.random() * horizon * 0.8, s, s);
  }
  ctx.globalAlpha = 1;

  if (aurora) drawAurora(ctx, w, horizon);
  if (env.id === 'rain') drawClouds(ctx, w, horizon, detail);

  const sun = tod.sun;
  const sx = w * sun.x;
  const sy = horizon * sun.y;
  const sr = h * sun.r;
  const glow = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * (sun.type === 'sun' ? 4 : 5));
  glow.addColorStop(0, `rgba(${sun.glow},${env.id === 'rain' ? 0.12 : 0.35})`);
  glow.addColorStop(1, `rgba(${sun.glow},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, height);
  if (env.id !== 'rain') {
    if (sun.type === 'moon') {
      ctx.fillStyle = sun.color;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,150,200,0.35)';
      ctx.beginPath();
      ctx.arc(sx - sr * 0.3, sy - sr * 0.2, sr * 0.22, 0, Math.PI * 2);
      ctx.arc(sx + sr * 0.35, sy + sr * 0.3, sr * 0.14, 0, Math.PI * 2);
      ctx.fill();
    } else {
      drawSun(ctx, sx, sy, sr, sun);
    }
  }

  const haze = env.haze || tod.haze;
  ctx.save();
  ctx.translate(w / 2, horizon);
  ctx.scale(1, 0.28);
  const hz = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.6);
  hz.addColorStop(0, `rgba(${haze},${tod.hazeAlpha})`);
  hz.addColorStop(1, `rgba(${haze},0)`);
  ctx.fillStyle = hz;
  ctx.fillRect(-w, -w, w * 2, w * 2);
  ctx.restore();
  return c;
}

// Retro striped sun (stripes cut out of its lower half).
function drawSun(ctx, x, y, r, sun) {
  const c = createCanvas(r * 2 + 4, r * 2 + 4);
  const sctx = c.getContext('2d');
  const g = sctx.createLinearGradient(0, 0, 0, r * 2);
  g.addColorStop(0, sun.color);
  g.addColorStop(1, '#ff4f7a');
  sctx.fillStyle = g;
  sctx.beginPath();
  sctx.arc(r + 2, r + 2, r, 0, Math.PI * 2);
  sctx.fill();
  if (sun.stripes) {
    sctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) {
      const sy = r + 2 + r * (0.15 + i * 0.15);
      sctx.fillRect(0, sy, r * 2 + 4, Math.max(1.5, r * (0.02 + i * 0.012)));
    }
  }
  ctx.drawImage(c, x - r - 2, y - r - 2);
}

function drawAurora(ctx, w, horizon) {
  const bands = [['61, 255, 162', 0.22], ['200, 107, 255', 0.16], ['34, 230, 255', 0.14]];
  for (let b = 0; b < bands.length; b++) {
    const [color, alpha] = bands[b];
    const base = horizon * (0.25 + b * 0.12);
    const g = ctx.createLinearGradient(0, base - horizon * 0.2, 0, base + horizon * 0.1);
    g.addColorStop(0, `rgba(${color},0)`);
    g.addColorStop(0.7, `rgba(${color},${alpha})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, base + horizon * 0.1);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, base + Math.sin(x * 0.006 + b * 2) * horizon * 0.06 - horizon * 0.2);
    ctx.lineTo(w, base + horizon * 0.1);
    ctx.closePath();
    ctx.fill();
  }
}

function drawClouds(ctx, w, horizon, detail) {
  const n = Math.round(14 * (0.5 + 0.5 * detail));
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w;
    const y = rand(0.05, 0.7) * horizon;
    const rx = rand(0.1, 0.25) * w;
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '30,38,56' : '44,54,76'},${rand(0.25, 0.5)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- skylines

function silhouette(env, todKey, near) {
  const low = hexToRgb(skyStops(env, todKey)[2]);
  return mix(low, [4, 2, 10], near ? 0.84 : 0.66);
}

function buildSkyline(env, todKey, w, h, near, detail) {
  const type = env.skyline;
  const tall = type === 'mountains' ? (near ? 0.2 : 0.27) : type === 'mesa' ? (near ? 0.13 : 0.19) : (near ? 0.15 : 0.21);
  const tileW = Math.ceil(w * 1.25);
  const height = Math.ceil(h * tall);
  const c = createCanvas(tileW, height);
  const ctx = c.getContext('2d');
  const k = h / 720;
  const body = silhouette(env, todKey, near);
  if (type === 'city') drawCity(ctx, tileW, height, k, near, rgb(body), TIME_OF_DAY[todKey].windows, detail, env.id === 'rain');
  else if (type === 'mesa') drawMesas(ctx, tileW, height, k, near, body);
  else if (type === 'coast') drawCoast(ctx, tileW, height, k, near, body, todKey);
  else drawMountains(ctx, tileW, height, k, near, body, todKey);
  return c;
}

function drawCity(ctx, tileW, height, k, near, bodyColor, windows, detail, rainy) {
  const windowColors = rainy ? ['#9fdcff', '#ffe0a0', '#7ff3ff'] : near ? ['#ffcf7a', '#7ff3ff', '#ff7ac8'] : ['#b58cff', '#ff9ad5', '#8fd8ff'];
  let x = rand(0, 20) * k;
  while (x < tileW) {
    const bw = rand(near ? 26 : 18, near ? 78 : 52) * k;
    if (x + bw > tileW) break; // leave the seam as a natural gap so the tile wraps cleanly
    const bh = height * (Math.random() < 0.15 ? rand(0.8, 1) : rand(0.25, 0.75));
    const top = height - bh;
    ctx.fillStyle = bodyColor;
    ctx.fillRect(x, top, bw, bh);
    ctx.fillStyle = near ? 'rgba(255,45,149,0.22)' : 'rgba(180,120,255,0.18)';
    ctx.fillRect(x, top, bw, Math.max(1, k));
    const cellW = 5 * k;
    const cellH = 7 * k;
    const lit = (near ? 0.22 : 0.16) * (0.5 + 0.5 * detail);
    for (let wy = top + cellH; wy < height - cellH; wy += cellH) {
      for (let wx = x + cellW * 0.6; wx < x + bw - cellW; wx += cellW) {
        if (Math.random() > lit) continue;
        ctx.globalAlpha = rand(0.35, near ? 0.95 : 0.6) * windows;
        ctx.fillStyle = windowColors[(Math.random() * windowColors.length) | 0];
        ctx.fillRect(wx, wy, cellW * 0.5, cellH * 0.45);
      }
    }
    ctx.globalAlpha = 1;
    if (near && Math.random() < 0.18 && bh > height * 0.4) {
      ctx.save();
      const neon = Math.random() < 0.5 ? '#ff2d95' : '#22e6ff';
      ctx.shadowColor = neon;
      ctx.shadowBlur = 10;
      ctx.fillStyle = neon;
      ctx.globalAlpha = 0.4 + 0.6 * windows;
      ctx.fillRect(x + bw * 0.4, top + bh * 0.12, Math.max(2, 3 * k), bh * 0.35);
      ctx.restore();
    }
    if (bh > height * 0.7) {
      ctx.fillStyle = '#ff3355';
      ctx.fillRect(x + bw / 2 - k, top - 6 * k, 2 * k, 2 * k);
    }
    x += bw + rand(-3, 7) * k;
  }
}

function drawMesas(ctx, tileW, height, k, near, body) {
  ctx.fillStyle = rgb(near ? body : mix(body, [120, 60, 80], 0.15));
  let x = rand(0, 40) * k;
  while (x < tileW) {
    const bw = rand(near ? 90 : 60, near ? 260 : 180) * k;
    if (x + bw > tileW) break;
    const bh = height * rand(0.35, 1);
    const slope = bw * rand(0.08, 0.2);
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x + slope, height - bh);
    ctx.lineTo(x + bw - slope, height - bh);
    ctx.lineTo(x + bw, height);
    ctx.closePath();
    ctx.fill();
    // Rock strata lines
    ctx.fillStyle = 'rgba(255,140,90,0.08)';
    for (let s = 1; s < 4; s++) ctx.fillRect(x + slope * 0.6, height - bh + (bh * s) / 4, bw - slope * 1.2, Math.max(1, k));
    ctx.fillStyle = rgb(near ? body : mix(body, [120, 60, 80], 0.15));
    x += bw + rand(40, 220) * k;
  }
  // Low dunes along the base
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let dx = 0; dx <= tileW; dx += 30 * k) ctx.lineTo(dx, height - (Math.sin(dx * 0.01) * 0.5 + 0.5) * height * 0.12);
  ctx.lineTo(tileW, height);
  ctx.closePath();
  ctx.fill();
}

function drawCoast(ctx, tileW, height, k, near, body, todKey) {
  ctx.fillStyle = rgb(body);
  if (near) {
    // Cliffs occupy part of the tile, leaving open ocean elsewhere.
    const start = tileW * 0.55;
    ctx.beginPath();
    ctx.moveTo(start, height);
    let y = height * 0.7;
    for (let x = start; x <= tileW * 0.98; x += 14 * k) {
      y = clamp(y + rand(-0.08, 0.06) * height, height * 0.15, height * 0.8);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(tileW * 0.98, height);
    ctx.closePath();
    ctx.fill();
    // Lighthouse
    const lx = tileW * 0.7;
    ctx.fillRect(lx, height * 0.1, 6 * k, height * 0.5);
    ctx.fillStyle = todKey === 'night' ? '#ffe9a0' : '#f4f4f4';
    ctx.fillRect(lx - k, height * 0.08, 8 * k, 6 * k);
  } else {
    for (let i = 0; i < 4; i++) {
      const cx = rand(0.05, 0.95) * tileW;
      const rw = rand(60, 160) * k;
      const rh = rand(0.15, 0.4) * height;
      ctx.beginPath();
      ctx.ellipse(cx, height, rw, rh, 0, Math.PI, 0);
      ctx.fill();
    }
  }
}

function drawMountains(ctx, tileW, height, k, near, body, todKey) {
  ctx.fillStyle = rgb(near ? body : mix(body, [90, 100, 140], 0.25));
  ctx.beginPath();
  ctx.moveTo(0, height);
  let y = height * 0.5;
  const peaks = [];
  const step = (near ? 18 : 26) * k;
  for (let x = 0; x <= tileW + step; x += step) {
    y = clamp(y + rand(-0.14, 0.14) * height, height * 0.05, height * 0.85);
    // Ease the last points back toward the start height so the tile wraps without a seam.
    if (x > tileW - step * 6) y += (height * 0.5 - y) * 0.35;
    ctx.lineTo(Math.min(x, tileW), y);
    if (y < height * 0.3) peaks.push([x, y]);
  }
  ctx.lineTo(tileW, height);
  ctx.closePath();
  ctx.fill();
  if (!near && todKey !== 'night') {
    ctx.fillStyle = 'rgba(240,240,255,0.35)';
    for (const [px, py] of peaks) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - 10 * k, py + 12 * k);
      ctx.lineTo(px + 10 * k, py + 12 * k);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------- roadside prop sprites

function buildProps() {
  return {
    palm: makePalm(),
    cactus: makeCactus(),
    pine: makePine(),
    post: makePost(),
    billboards: ['NEO-COLA', 'VOLTEK', 'SKYLINE FM', 'DRIVE FAST', 'KAIJU NOODLES'].map(makeBillboard),
  };
}

function makePalm() {
  const c = createCanvas(160, 240);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#1b0f18';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(70, 240);
  ctx.quadraticCurveTo(62, 130, 92, 44);
  ctx.stroke();
  ctx.strokeStyle = '#120a14';
  ctx.lineWidth = 7;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.9;
    const len = 62 + (i % 2) * 14;
    ctx.beginPath();
    ctx.moveTo(92, 44);
    ctx.quadraticCurveTo(92 + Math.cos(a) * len * 0.6, 44 + Math.sin(a) * len * 0.3 - 10, 92 + Math.cos(a) * len, 44 + Math.sin(a) * len * 0.35 + 26);
    ctx.stroke();
  }
  return c;
}

function makeCactus() {
  const c = createCanvas(90, 160);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1d2a16';
  const rr = (x, y, w, h) => {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
  };
  rr(35, 10, 22, 150);
  rr(10, 50, 16, 50);
  ctx.fillRect(10, 90, 30, 14);
  rr(66, 36, 16, 44);
  ctx.fillRect(52, 72, 30, 14);
  return c;
}

function makePine() {
  const c = createCanvas(100, 220);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b120f';
  ctx.fillRect(45, 180, 10, 40);
  ctx.fillStyle = '#0c1a14';
  for (let i = 0; i < 4; i++) {
    const top = 10 + i * 42;
    const half = 18 + i * 10;
    ctx.beginPath();
    ctx.moveTo(50, top);
    ctx.lineTo(50 + half, top + 70);
    ctx.lineTo(50 - half, top + 70);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

function makePost() {
  const c = createCanvas(20, 80);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d8dce8';
  ctx.fillRect(6, 10, 8, 70);
  ctx.fillStyle = '#16161c';
  ctx.fillRect(6, 30, 8, 10);
  ctx.save();
  ctx.shadowColor = '#ffb020';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#ffb020';
  ctx.fillRect(7, 14, 6, 10);
  ctx.restore();
  return c;
}

function makeBillboard(text, i) {
  const c = createCanvas(320, 220);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#16121f';
  ctx.fillRect(150, 120, 20, 100);
  const colors = ['#ff2d95', '#22e6ff', '#ffc247', '#3dffa2', '#b36bff'];
  const color = colors[i % colors.length];
  ctx.fillStyle = '#0c0916';
  ctx.fillRect(10, 10, 300, 120);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.strokeRect(16, 16, 288, 108);
  ctx.fillStyle = color;
  ctx.font = '900 34px Orbitron, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 70, 270);
  return c;
}
