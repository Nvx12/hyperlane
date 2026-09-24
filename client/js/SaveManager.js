// Centralized, versioned persistence. One JSON document in LocalStorage.
// Loading always yields a complete, valid save: unknown/missing fields fall back to defaults,
// corrupted data is quarantined, and older versions are migrated step by step.

import { SAVE_VERSION } from './version.js';

const KEY = 'nightvector.save';
const PREVIOUS_KEY = 'hyperlane.save'; // same schema, stored under the pre-release name
const LEGACY_KEY = 'hyperlane.save.v1'; // v1 of the game stored only score/distance/mute
export { SAVE_VERSION };

export function defaultSettings() {
  return {
    master: 0.8,
    music: 0.45,
    sfx: 0.8,
    engine: 0.7,
    muted: false,
    musicEnabled: true,
    shake: 1, // 0 | 0.5 | 1
    quality: 'high', // low | medium | high
    touch: 'auto', // auto | on | off
  };
}

export function defaultSave() {
  return {
    saveVersion: SAVE_VERSION,
    credits: 0,
    xp: 0,
    level: 1,
    selectedCar: 'vireo',
    environment: 'neon',
    unlockedCars: ['vireo'],
    cars: {}, // carId → { upgrades: {engine..armor}, custom: {...} }
    achievements: {}, // id → unlock timestamp
    missions: { active: [], completed: 0, seq: 0 },
    daily: { date: '', progress: {}, claimed: false },
    records: {
      score: 0, distance: 0, topSpeed: 0, combo: 1, nearMisses: 0, overtakes: 0, chase: 0, cleanDistance: 0,
    },
    stats: {
      races: 0, distance: 0, playTime: 0, overtakes: 0, nearMisses: 0, insaneMisses: 0, perfectOvertakes: 0,
      crashes: 0, boostTime: 0, policeEscapes: 0, pickups: 0, chicanes: 0, legendPasses: 0,
      missionsCompleted: 0, dailiesCompleted: 0, creditsEarned: 0, carDistance: {},
    },
    flags: {}, // secret unlocks and one-off events
    settings: defaultSettings(),
  };
}

// Copies values from `source` onto `target` where the types match, recursing into objects.
// Keys that exist only in `target` keep their defaults; unknown extra keys are kept for maps.
function mergeInto(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    const value = source[key];
    const current = target[key];
    if (current === undefined) {
      target[key] = value; // dynamic maps (cars, achievements, carDistance, flags)
    } else if (Array.isArray(current)) {
      if (Array.isArray(value)) target[key] = value;
    } else if (current !== null && typeof current === 'object') {
      if (value && typeof value === 'object' && !Array.isArray(value)) mergeInto(current, value);
    } else if (typeof current === typeof value && (typeof value !== 'number' || Number.isFinite(value))) {
      target[key] = value;
    }
  }
  return target;
}

// saveVersion N → N+1 transforms. Add entries here when the schema changes.
const MIGRATIONS = {};

function migrate(data) {
  let version = Number(data.saveVersion) || 0;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (step) step(data);
    version++;
  }
  data.saveVersion = SAVE_VERSION;
  return data;
}

const clampNum = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const oneOf = (v, options, fallback) => (options.includes(v) ? v : fallback);

// Range/enum validation after type-merging, so hand-edited or damaged values can't break the game.
function sanitize(data) {
  const d = defaultSettings();
  const s = data.settings;
  for (const key of ['master', 'music', 'sfx', 'engine']) s[key] = clampNum(s[key], 0, 1, d[key]);
  s.shake = oneOf(s.shake, [0, 0.5, 1], d.shake);
  s.quality = oneOf(s.quality, ['low', 'medium', 'high'], d.quality);
  s.touch = oneOf(s.touch, ['auto', 'on', 'off'], d.touch);
  for (const key of Object.keys(s)) if (!(key in d)) delete s[key]; // drop retired options
  data.credits = Math.floor(clampNum(data.credits, 0, 1e9, 0));
  data.xp = clampNum(data.xp, 0, 1e9, 0);
  data.level = Math.floor(clampNum(data.level, 1, 999, 1));
  if (!data.unlockedCars.includes('vireo')) data.unlockedCars.unshift('vireo');
  data.unlockedCars = data.unlockedCars.filter(id => typeof id === 'string');
  if (!Array.isArray(data.missions.active)) data.missions.active = [];
  return data;
}

function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw);
    const save = defaultSave();
    save.records.score = Number(old.highScore) || 0;
    save.records.distance = Number(old.bestDistance) || 0;
    save.settings.muted = Boolean(old.muted);
    return save;
  } catch {
    return null;
  }
}

export class SaveManager {
  constructor() {
    this.data = this.load();
    this.pendingTimer = 0;
  }

  load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY) || localStorage.getItem(PREVIOUS_KEY);
    } catch {
      return defaultSave(); // storage blocked: play without persistence
    }
    if (!raw) {
      const legacy = readLegacy();
      if (legacy) {
        this.write(legacy);
        return legacy;
      }
      return defaultSave();
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid save');
      return sanitize(mergeInto(defaultSave(), migrate(parsed)));
    } catch {
      try {
        localStorage.setItem(`${KEY}.corrupt`, raw); // keep it for inspection instead of silently losing it
      } catch {
        /* ignore */
      }
      return defaultSave();
    }
  }

  write(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  // Writes happen only at meaningful moments (end of run, purchase, settings change),
  // never per frame. saveSoon() coalesces bursts such as slider drags.
  save() {
    clearTimeout(this.pendingTimer);
    this.pendingTimer = 0;
    this.write(this.data);
  }

  saveSoon() {
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => this.save(), 400);
  }

  reset() {
    this.data = defaultSave();
    this.save();
  }
}
