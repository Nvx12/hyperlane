import { HttpError } from '../http.js';
import { RULES } from './rateLimit.js';

// Privacy-conscious product analytics. Accepts small batches of whitelisted events with
// coarse, flat properties. What is NOT collected: IP addresses (used only for rate limiting,
// never stored), player ids, names, tokens, user agents, precise timestamps from the client,
// or free text. The client id is a random per-install value the player can reset by clearing
// site data, and it is not linked to the leaderboard profile.
export const EVENT_NAMES = new Set([
  'session_start', 'race_start', 'race_end', 'upgrade_bought', 'car_unlocked', 'car_selected',
  'mission_complete', 'daily_complete', 'achievement', 'level_up', 'profile_created',
  'share', 'challenge_opened', 'challenge_accepted', 'pwa_installed', 'gamepad', 'settings_changed',
  'error',
]);
const MAX_EVENTS = 25;
const MAX_PROPS = 8;
const MAX_STRING = 40;
const PROP_KEY = /^[a-z][a-z0-9_]{0,23}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{16,32}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,20}$/;
const RETENTION_MS = 90 * 86_400_000;

function cleanProps(props) {
  if (props === undefined || props === null) return null;
  if (typeof props !== 'object' || Array.isArray(props)) return undefined;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (++n > MAX_PROPS || !PROP_KEY.test(k)) return undefined;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= MAX_STRING && /^[\w .:/-]*$/.test(v)) out[k] = v;
    else return undefined;
  }
  return n ? out : null;
}

export function eventRoutes({ db, config, now, limiter, log }) {
  const insert = db.prepare('INSERT INTO events (name, client_id, props, app_version, created_at) VALUES (?, ?, ?, ?, ?)');
  const prune = db.prepare('DELETE FROM events WHERE created_at < ?');
  let lastPrune = 0;

  return [
    {
      method: 'POST',
      path: '/events',
      maxBody: 16 * 1024,
      async handler(ctx) {
        const body = await ctx.body();
        // Disabled by the operator: accept and drop, so old clients don't retry forever.
        if (!config.analyticsEnabled) return { status: 204 };
        const limit = limiter.take(RULES.events, ctx.ip);
        if (!limit.ok) throw new HttpError(429, 'rate_limited', 'Too many analytics batches.', { retryAfter: limit.retryAfter });
        if (!body || !CLIENT_ID.test(body.clientId) || !VERSION.test(body.appVersion) || !Array.isArray(body.events)) {
          throw new HttpError(422, 'invalid_batch', 'Invalid analytics batch.');
        }
        if (body.events.length === 0) return { status: 204 };
        if (body.events.length > MAX_EVENTS) throw new HttpError(422, 'invalid_batch', 'Too many events in one batch.');

        const t = now();
        const rows = [];
        for (const e of body.events) {
          if (!e || !EVENT_NAMES.has(e.name)) continue; // unknown events are dropped, not fatal
          const props = cleanProps(e.props);
          if (props === undefined) continue;
          rows.push([e.name, props ? JSON.stringify(props) : null]);
        }
        db.exec('BEGIN');
        try {
          for (const [name, props] of rows) insert.run(name, body.clientId, props, body.appVersion, t);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        if (t - lastPrune > 86_400_000) {
          lastPrune = t;
          const removed = prune.run(t - RETENTION_MS).changes;
          if (removed) log.info('analytics retention', { removed });
        }
        return { status: 204 };
      },
    },
  ];
}
