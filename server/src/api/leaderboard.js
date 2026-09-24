import { HttpError } from '../http.js';
import { RULES } from './rateLimit.js';

// Best result per player, per category and period. Periods are UTC: today, this ISO week
// (Monday start), all time. Results are cached briefly so a popular board costs one query
// per category/period every few seconds, however many players are looking.
export const CATEGORIES = {
  score: 'score',
  distance: 'distance_m',
  speed: 'top_speed_kmh',
  combo: 'best_combo',
};
export const PERIODS = ['day', 'week', 'all'];
const LIMIT = 100;
const CACHE_MS = 10_000;
const DAY = 86_400_000;

export function periodStart(period, t) {
  if (period === 'all') return 0;
  const day = Math.floor(t / DAY) * DAY;
  if (period === 'day') return day;
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
  return day - weekday * DAY;
}

export function createLeaderboard(db, now) {
  const cache = new Map();
  const top = {};
  const rank = {};
  const best = {};
  for (const [cat, col] of Object.entries(CATEGORIES)) {
    // SQLite returns the other bare columns from the row holding MAX(col).
    top[cat] = db.prepare(`
      SELECT s.player_id AS playerId, p.display_name AS name, MAX(s.${col}) AS value, s.car_id AS car, s.created_at AS at
      FROM scores s JOIN players p ON p.id = s.player_id
      WHERE s.created_at >= ? AND p.flagged = 0
      GROUP BY s.player_id
      ORDER BY value DESC, at ASC
      LIMIT ${LIMIT}`);
    best[cat] = db.prepare(`SELECT MAX(${col}) AS value FROM scores WHERE player_id = ? AND created_at >= ?`);
    rank[cat] = db.prepare(`
      SELECT COUNT(*) AS better FROM (
        SELECT MAX(s.${col}) AS v FROM scores s JOIN players p ON p.id = s.player_id
        WHERE s.created_at >= ? AND p.flagged = 0 GROUP BY s.player_id
      ) WHERE v > ?`);
  }

  function entries(category, period) {
    const key = `${category}:${period}`;
    const t = now();
    const hit = cache.get(key);
    if (hit && t - hit.at < CACHE_MS) return hit.rows;
    const rows = top[category].all(periodStart(period, t));
    cache.set(key, { at: t, rows });
    return rows;
  }

  // Player's best and rank for one board, or null if they have no run in that period.
  function standing(playerId, category, period) {
    const since = periodStart(period, now());
    const mine = best[category].get(playerId, since);
    if (!mine || mine.value === null) return null;
    return { rank: rank[category].get(since, mine.value).better + 1, value: mine.value };
  }

  return {
    entries,
    standing,
    invalidate() {
      cache.clear();
    },
  };
}

export function leaderboardRoutes({ board, players, limiter }) {
  const parse = url => {
    const category = url.searchParams.get('category') || 'score';
    const period = url.searchParams.get('period') || 'week';
    if (!Object.hasOwn(CATEGORIES, category)) throw new HttpError(400, 'invalid_category', 'Unknown leaderboard category.');
    if (!PERIODS.includes(period)) throw new HttpError(400, 'invalid_period', 'Unknown leaderboard period.');
    return { category, period };
  };
  const limit = ctx => {
    const r = limiter.take(RULES.leaderboard, ctx.ip);
    if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many requests. Slow down.', { retryAfter: r.retryAfter });
  };

  return [
    {
      // Public board. With a token, entries are marked `me` and the caller's own standing is
      // included even when outside the top 100. Player ids are never returned.
      method: 'GET',
      path: '/leaderboard',
      handler(ctx) {
        limit(ctx);
        const { category, period } = parse(ctx.url);
        const me = players.authenticate(ctx.req.headers.authorization);
        const rows = board.entries(category, period).map((r, i) => ({
          rank: i + 1,
          name: r.name,
          value: r.value,
          car: r.car,
          at: new Date(r.at).toISOString(),
          me: Boolean(me && r.playerId === me.id),
        }));
        return {
          body: { category, period, entries: rows, me: me ? board.standing(me.id, category, period) : null },
          headers: { 'Cache-Control': me ? 'no-store' : 'public, max-age=10' },
        };
      },
    },
    {
      method: 'GET',
      path: '/leaderboard/me',
      auth: true,
      handler(ctx) {
        limit(ctx);
        const out = {};
        for (const category of Object.keys(CATEGORIES)) {
          out[category] = {};
          for (const period of PERIODS) out[category][period] = board.standing(ctx.player.id, category, period);
        }
        return { body: { standings: out } };
      },
    },
  ];
}
