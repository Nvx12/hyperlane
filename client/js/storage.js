// The only module that touches Web Storage. Every call is safe: storage can be missing
// (private mode, blocked site data, embedded webviews) or full, and the game must keep running
// — reads then return the fallback and writes report false. Keys live in KEYS so every piece of
// persisted data is listed in one place.

export const KEYS = {
  save: 'nightvector.save', // SaveManager: profile, progression, settings (versioned)
  saveLegacy: 'hyperlane.save', // pre-release name of the same save
  saveV1: 'hyperlane.save.v1', // first release: score/distance/mute only
  saveCorrupt: 'nightvector.save.corrupt', // unreadable save kept for inspection
  account: 'nightvector.identity', // PlayerService: online account id, name and device token
  syncQueue: 'nightvector.syncQueue', // SyncManager: progression operations not yet confirmed
  pendingRuns: 'nightvector.pendingRuns', // legacy ranked-run queue (migrated into syncQueue)
  ghost: 'nightvector.ghost', // Ghost: best-run replay samples
  analyticsId: 'nightvector.cid', // Analytics: random per-install id
};

function area() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readText(key) {
  try {
    const s = area();
    return s ? s.getItem(key) : null;
  } catch {
    return null;
  }
}

export function writeText(key, value) {
  try {
    const s = area();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readJson(key, fallback = null) {
  const raw = readText(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export const writeJson = (key, value) => writeText(key, JSON.stringify(value));

export function remove(key) {
  try {
    const s = area();
    if (s) s.removeItem(key);
  } catch {
    /* ignore */
  }
}
