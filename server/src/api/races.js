import { HttpError } from '../http.js';
import { RULES } from './rateLimit.js';
import { newId } from './players.js';
import { CAR_IDS, ENV_IDS, LIMITS } from './raceRules.js';

// Race sessions. The server stamps the start time itself, so a finished run can never claim
// more race time than really passed; each session is single-use. Finishing a session is the
// same "race" operation the sync endpoint applies (progress.js) — one path for validation,
// rewards and ranking — keyed by the session, so a retried finish is answered, not re-applied.
export function raceRoutes({ db, now, limiter, board, progress, log }) {
  const q = {
    expireOpen: db.prepare("UPDATE race_sessions SET status = 'expired' WHERE player_id = ? AND status = 'open'"),
    expireOld: db.prepare("UPDATE race_sessions SET status = 'expired' WHERE status = 'open' AND started_at < ?"),
    insert: db.prepare('INSERT INTO race_sessions (id, player_id, car_id, env_id, client_version, started_at) VALUES (?, ?, ?, ?, ?, ?)'),
    get: db.prepare('SELECT * FROM race_sessions WHERE id = ? AND player_id = ?'),
    prevBest: db.prepare('SELECT MAX(score) AS best FROM scores WHERE player_id = ? AND session_id != ?'),
  };

  const take = (rule, key) => {
    const r = limiter.take(rule, key);
    if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many races too quickly. Try again shortly.', { retryAfter: r.retryAfter });
  };

  const ranks = playerId => ({
    day: board.standing(playerId, 'score', 'day'),
    week: board.standing(playerId, 'score', 'week'),
    all: board.standing(playerId, 'score', 'all'),
  });

  // Stale open sessions are expired lazily (cheap indexed update) rather than by a timer.
  let lastSweep = 0;
  function sweep(t) {
    if (t - lastSweep < 60_000) return;
    lastSweep = t;
    q.expireOld.run(t - LIMITS.SESSION_MAX_MS);
  }

  return [
    {
      method: 'POST',
      path: '/races',
      auth: true,
      async handler(ctx) {
        const body = await ctx.body();
        take(RULES.raceStart, ctx.player.id);
        const carId = body && body.carId;
        const envId = body && body.envId;
        const clientVersion = body && body.clientVersion;
        if (!CAR_IDS.has(carId)) throw new HttpError(422, 'invalid_car', 'Unknown car.');
        if (!ENV_IDS.has(envId)) throw new HttpError(422, 'invalid_environment', 'Unknown route.');
        if (typeof clientVersion !== 'string' || !/^[0-9A-Za-z.+-]{1,20}$/.test(clientVersion)) {
          throw new HttpError(422, 'invalid_version', 'Invalid client version.');
        }
        // A ranked race can only be driven in a car the account really owns.
        if (!progress.load(ctx.player.id).state.ownedCars.includes(carId)) throw new HttpError(409, 'car_not_owned', 'You do not own this car.');
        const t = now();
        sweep(t);
        const id = newId('r');
        db.exec('BEGIN');
        try {
          q.expireOpen.run(ctx.player.id); // one live session per player
          q.insert.run(id, ctx.player.id, carId, envId, clientVersion, t);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        return { status: 201, body: { sessionId: id, startedAt: new Date(t).toISOString() } };
      },
    },
    {
      method: 'POST',
      path: '/races/:id/finish',
      auth: true,
      async handler(ctx) {
        const body = await ctx.body();
        take(RULES.raceFinish, ctx.player.id);
        const session = q.get.get(ctx.params.id, ctx.player.id);
        if (!session) throw new HttpError(404, 'session_not_found', 'Race session not found.');
        const r = progress.applyOne(ctx.player, { opId: `s:${session.id}`, type: 'race', sessionId: session.id, run: body, dateKey: body && body.dateKey },
          { offlineUsed: 0, offlineBudget: 0, log });
        if (r.code === 'invalid_run') throw new HttpError(422, 'invalid_run', r.message);
        if (r.status === 404 || r.status === 409) throw new HttpError(r.status, r.code, r.message);
        if (r.ok && !r.duplicate) board.invalidate();
        if (!r.ok) return { body: { accepted: false, message: r.message, progress: progress.snapshot(ctx.player.id) } };
        const prev = q.prevBest.get(ctx.player.id, session.id).best;
        const final = q.get.get(session.id, ctx.player.id);
        return {
          body: {
            accepted: true,
            personalBest: prev === null || (final && body && body.score > prev),
            ranks: ranks(ctx.player.id),
            summary: r.summary,
            ...progress.snapshot(ctx.player.id),
          },
        };
      },
    },
  ];
}
