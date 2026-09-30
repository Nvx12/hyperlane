// Centralized, versioned local save — one JSON document (see storage.js for the key).
// Loading always yields a complete, valid save: unknown/missing fields fall back to defaults,
// corrupted data is quarantined, and older versions are migrated step by step.
//
// save = {
//   saveVersion,
//   profile:  { id, name, avatar, createdAt } | null   — the local driver (null → first launch)
//   progress: progression document (progression/engine.js)
//   settings: device settings (never synced: controls and graphics belong to the phone)
//   flags:    device UX flags (tutorial done, one-time notices)
//   environment
// }

import { SAVE_VERSION } from './version.js';
import { KEYS, readText, writeText, readJson } from './storage.js';
import { defaultProgress, normalizeProgress, ensureMissions, STARTER } from './progression/engine.js';
import { AVATAR_IDS } from './data/avatars.js';
import { validateDisplayName } from './names.js';
export { SAVE_VERSION };

export const SHAKE_LEVELS = [0, 0.35, 0.7]; // Off | Low | Normal — phone screens need a calm camera
// v3 keeps a head start for pre-rebalance saves, but not end-game credits (see MIGRATIONS[2]).
const MIGRATED_CREDITS_MAX = 5000;

export function defaultSettings() {
  return {
    master: 0.8,
    music: 0.45,
    sfx: 0.8,
    engine: 0.7,
    muted: false, // Audio: On/Off
    musicEnabled: true,
    shake: 0.35, // Low
    quality: 'auto', // auto | low | medium | high
    autoLevel: -1, // AUTO quality learned on this device (0 low … 2 high); -1 = not measured yet
    fps: 'auto', // auto | 30 | 60
    steering: 'touch', // touch | tilt
    sensitivity: 1, // 0.6 … 1.4
    tiltCenter: 0, // tilt calibration (radians)
    haptics: true,
    ghost: true, // personal-best ghost car
    analytics: true, // anonymous usage stats (also off when the browser sends DNT/GPC)
  };
}

// A random id for the mission seed of a new local profile. Not a secret, just unique.
export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function defaultSave() {
  const progress = defaultProgress(newId());
  ensureMissions(progress);
  return {
    saveVersion: SAVE_VERSION,
    profile: null,
    progress,
    settings: defaultSettings(),
    flags: {},
    environment: 'neon',
  };
}

// saveVersion N → N+1 transforms on the raw parsed save. Add entries when the schema changes.
const MIGRATIONS = {
  // 1 → 2: mobile-first release. Shake levels were rescaled for phone screens, "high" was the
  // old default quality (not a choice) so it becomes AUTO, the touch on/off option is gone
  // (touch is the primary scheme), and existing players skip the first-race tutorial.
  1(data) {
    const s = data.settings && typeof data.settings === 'object' ? data.settings : null;
    if (s) {
      if (s.shake === 1) s.shake = 0.7;
      else if (s.shake === 0.5) s.shake = 0.35;
      if (s.quality === 'high') s.quality = 'auto';
      delete s.touch;
    }
    const races = data.stats && Number(data.stats.races);
    if (races > 0) data.flags = { ...(data.flags && typeof data.flags === 'object' ? data.flags : {}), tutorial: true };
  },
  // 2 → 3: driver profiles and the rebalanced progression. The old economy handed out cars far
  // too early, so the old garage is not carried over: players keep their records, statistics,
  // achievements and total XP (re-levelled on the new, slower curve), keep up to 5,000 credits
  // and their starter's upgrades (within its new ceiling), and earn every other car again.
  2(data) {
    const oldLevel = Math.max(1, Math.floor(Number(data.level) || 1));
    let totalXp = Math.max(0, Number(data.xp) || 0);
    for (let l = 1; l < oldLevel; l++) totalXp += 450 + 150 * (l - 1); // the v2 level curve
    const oldCars = data.cars && typeof data.cars === 'object' ? data.cars : {};
    const flags = data.flags && typeof data.flags === 'object' ? data.flags : {};
    const progress = normalizeProgress({
      credits: Math.min(MIGRATED_CREDITS_MAX, Number(data.credits) || 0),
      xp: Math.min(totalXp, 1e9),
      ownedCars: [STARTER],
      cars: oldCars[STARTER] ? { [STARTER]: { upgrades: oldCars[STARTER].upgrades } } : {},
      selectedCar: STARTER,
      achievements: data.achievements,
      feats: { phantom: flags.phantom === true },
      daily: data.daily,
      records: data.records,
      stats: data.stats,
    }, newId());
    const hadProgress = Number(data.stats && data.stats.races) > 0;
    for (const k of Object.keys(data)) if (!['saveVersion', 'settings', 'environment'].includes(k)) delete data[k];
    data.progress = progress;
    data.profile = null;
    data.flags = { tutorial: flags.tutorial === true, ...(hadProgress ? { rebalanced: true } : {}) };
  },
};

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

// Local driver profile: a display name, an avatar and a stable id (never the name).
export function sanitizeProfile(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[0-9a-f-]{16,40}$/i.test(p.id)) return null;
  const name = validateDisplayName(p.name);
  if (!name.ok) return null;
  return {
    id: p.id,
    name: name.name,
    avatar: AVATAR_IDS.includes(p.avatar) ? p.avatar : AVATAR_IDS[0],
    createdAt: clampNum(p.createdAt, 0, 8.64e15, Date.now()),
  };
}

// Range/enum validation after migration, so hand-edited or damaged values can't break the game.
function sanitize(data) {
  const out = defaultSave();
  const d = out.settings;
  const s = data.settings && typeof data.settings === 'object' ? data.settings : {};
  for (const key of Object.keys(d)) if (typeof s[key] === typeof d[key]) d[key] = s[key];
  for (const key of ['master', 'music', 'sfx', 'engine']) d[key] = clampNum(d[key], 0, 1, defaultSettings()[key]);
  d.shake = oneOf(d.shake, SHAKE_LEVELS, 0.35);
  d.quality = oneOf(d.quality, ['auto', 'low', 'medium', 'high'], 'auto');
  d.autoLevel = oneOf(d.autoLevel, [-1, 0, 1, 2], -1);
  d.fps = oneOf(d.fps, ['auto', '30', '60'], 'auto');
  d.steering = oneOf(d.steering, ['touch', 'tilt'], 'touch');
  d.sensitivity = Math.round(clampNum(d.sensitivity, 0.6, 1.4, 1) * 10) / 10;
  d.tiltCenter = clampNum(d.tiltCenter, -1, 1, 0);
  out.profile = sanitizeProfile(data.profile);
  const seed = data.progress && data.progress.missions && data.progress.missions.seed;
  out.progress = normalizeProgress(data.progress, typeof seed === 'string' && seed ? seed : newId());
  ensureMissions(out.progress);
  const flags = data.flags && typeof data.flags === 'object' ? data.flags : {};
  for (const k of ['tutorial', 'rebalanced']) if (flags[k] === true) out.flags[k] = true;
  out.environment = typeof data.environment === 'string' ? data.environment : 'neon';
  return out;
}

function readLegacyV1() {
  const old = readJson(KEYS.saveV1);
  if (!old || typeof old !== 'object') return null;
  const save = defaultSave();
  save.progress.records.score = Number(old.highScore) || 0;
  save.progress.records.distance = Number(old.bestDistance) || 0;
  save.settings.muted = Boolean(old.muted);
  return save;
}

export class SaveManager {
  constructor() {
    this.data = this.load();
    this.pendingTimer = 0;
  }

  get progress() {
    return this.data.progress;
  }

  load() {
    const raw = readText(KEYS.save) || readText(KEYS.saveLegacy);
    if (!raw) {
      const legacy = readLegacyV1();
      if (legacy) {
        this.write(legacy);
        return legacy;
      }
      return defaultSave();
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid save');
      return sanitize(migrate(parsed));
    } catch {
      writeText(KEYS.saveCorrupt, raw); // keep it for inspection instead of silently losing it
      return defaultSave();
    }
  }

  write(data) {
    return writeText(KEYS.save, JSON.stringify(data));
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

  // Creates (or edits) the local driver profile. Returns { ok, profile } or { ok: false, message }.
  setProfile(name, avatar) {
    const check = validateDisplayName(name);
    if (!check.ok) return { ok: false, message: check.message };
    const current = this.data.profile;
    const profile = sanitizeProfile({
      id: current ? current.id : newId(),
      name,
      avatar,
      createdAt: current ? current.createdAt : Date.now(),
    });
    if (!profile) return { ok: false, message: 'Invalid profile.' };
    this.data.profile = profile;
    this.save();
    return { ok: true, profile };
  }

  // Replaces the progression document (e.g. with the server's canonical copy).
  replaceProgress(doc) {
    const seed = this.data.progress.missions.seed;
    this.data.progress = normalizeProgress(doc, seed);
    ensureMissions(this.data.progress);
  }

  // Fresh progression, same driver and settings (guest "Reset progress").
  resetProgress() {
    this.data.progress = defaultSave().progress;
    delete this.data.flags.rebalanced;
    this.save();
  }

  // Development reset: profile, progression, garage, missions and statistics — a brand-new
  // first launch. Settings survive (they belong to the device).
  resetAll() {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  }
}

