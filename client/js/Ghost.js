import { CAMERA, ROAD } from './config.js';

// Personal-best ghost: a translucent replay of the player's best-scoring run. It never
// collides and never affects traffic — it's only drawn. Recorded as distance/lateral samples
// every 0.25 s of race time (ints: decimeters and centimeters), so a 15-minute run is ~3600
// samples, well under 40 KB in localStorage.
const KEY = 'nightvector.ghost';
const SAMPLE = 0.25;
const MAX_SAMPLES = 3600;
const MIN_SAMPLES = 40; // runs shorter than 10 s don't replace the ghost
const GHOST_LENGTH = 4.4;

function load() {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (g && g.v === 1 && Array.isArray(g.d) && Array.isArray(g.x) && g.d.length === g.x.length && g.d.length >= MIN_SAMPLES
      && Number.isFinite(g.score)) return g;
  } catch {
    /* corrupt or unavailable: no ghost */
  }
  return null;
}

export class Ghost {
  constructor() {
    this.best = load();
    this.enabled = true;
    this.active = null;
    this.recD = [];
    this.recX = [];
    // Reused render entity (sorted with traffic by the renderer).
    this.entity = { kind: 'ghost', x: 0, z: 0, sortZ: 0, length: GHOST_LENGTH, ahead: 0 };
  }

  get bestScore() {
    return this.best ? this.best.score : 0;
  }

  startRun() {
    this.recD.length = 0;
    this.recX.length = 0;
    this.active = this.enabled ? this.best : null;
  }

  // Called every simulation step while racing.
  record(runTime, distance, x) {
    if (this.recD.length >= MAX_SAMPLES) return;
    while (this.recD.length * SAMPLE <= runTime && this.recD.length < MAX_SAMPLES) {
      this.recD.push(Math.round(distance * 10));
      this.recX.push(Math.round(x * 100));
    }
  }

  // Positions the ghost for this frame. Returns the entity when it should be drawn, else null.
  place(runTime, playerDistance) {
    const g = this.active;
    if (!g) return null;
    const f = runTime / SAMPLE;
    const i = Math.floor(f);
    if (i >= g.d.length - 1) return null; // the ghost's run ended here
    const t = f - i;
    const d = (g.d[i] + (g.d[i + 1] - g.d[i]) * t) / 10;
    const x = (g.x[i] + (g.x[i + 1] - g.x[i]) * t) / 100;
    const e = this.entity;
    e.ahead = d - playerDistance;
    e.z = CAMERA.PLAYER_DEPTH + e.ahead;
    e.x = x;
    e.sortZ = e.z - GHOST_LENGTH / 2;
    if (e.sortZ < CAMERA.NEAR_CLIP + 0.3 || e.sortZ > ROAD.DRAW_DISTANCE) return null;
    return e;
  }

  // Keeps the run as the new ghost if it beat the stored one. Returns true if replaced.
  finishRun(score, carId) {
    if (this.recD.length < MIN_SAMPLES || score <= this.bestScore) return false;
    this.best = { v: 1, score, car: carId, d: this.recD.slice(), x: this.recX.slice() };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.best));
    } catch {
      /* quota or private mode: ghost lasts for this session */
    }
    return true;
  }

  clear() {
    this.best = null;
    this.active = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
