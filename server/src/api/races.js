import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { RULES } from './rateLimit.js';
import { newId } from './players.js';
import { CAR_IDS, ENV_IDS, LIMITS, parseRun, implausible } from './raceRules.js';

// Race sessions. The server stamps the start time itself, so a finished run can never claim
// more race time than really passed; each session is single-use; finishing is idempotent so
// the client can safely retry after a network failure.
export function raceRoutes({ db, now, log, limiter, board }) {
  const q = {
    expireOpen: db.prepare("UPDATE race_sessions SET status = 'expired' WHERE player_id = ? AND status = 'open'"),
    expireOld: db.prepare("UPDATE race_sessions SET status = 'expired' WHERE status = 'open' AND started_at < ?"),
    insert: db.prepare('INSERT INTO race_sessions (id, player_id, car_id, env_id, client_version, started_at) VALUES (?, ?, ?, ?, ?, ?)'),
    get: db.prepare('SELECT * FROM race_sessions WHERE id = ? AND player_id = ?'),
    close: db.prepare('UPDATE race_sessions SET status = ?, finished_at = ?, reject_reason = ?, result_hash = ? WHERE id = ? AND status = ?'),
    score: db.prepare(`INSERT INTO scores (session_id, player_id, score, distance_m, top_speed_kmh, best_combo, duration_ms, car_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    bumpRaces: db.prepare('UPDATE players SET races = races + 1 WHERE id = ?'),
    prevBest: db.prepare('SELECT MAX(score) AS best FROM scores WHERE player_id = ? AND session_id != ?'),
  };

  const take = (rule, key) => {
    const r = limiter.take(rule, key);
    if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many races too quickly. Try again shortly.', { retryAfter: r.retryAfter });
  };
  const hashRun = run => createHash('sha256').update(JSON.stringify(run)).digest('hex');

  function result(player, session, accepted, run) {
    if (!accepted) {
      // Deliberately vague: the exact failed check is logged, not handed to the client.
      return { accepted: false, message: 'This run could not be verified, so it was not ranked.' };
    }
    const prev = q.prevBest.get(player.id, session.id).best;
    return {
      accepted: true,
      personalBest: prev === null || run.score > prev,
      ranks: {
        day: board.standing(player.id, 'score', 'day'),
        week: board.standing(player.id, 'score', 'week'),
        all: board.standing(player.id, 'score', 'all'),
      },
    };
  }

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
        // Another player's session looks exactly like a missing one.
        if (!session) throw new HttpError(404, 'session_not_found', 'Race session not found.');
        const parsed = parseRun(body);
        if (!parsed.ok) throw new HttpError(422, 'invalid_run', `Invalid run data (${parsed.reason}).`);
        const run = parsed.run;
        const hash = hashRun(run);

        if (session.status !== 'open') {
          // Retry of the same submission: answer as before. Anything else is a replay.
          if (session.result_hash === hash && (session.status === 'accepted' || session.status === 'rejected')) {
            return { body: result(ctx.player, session, session.status === 'accepted', run) };
          }
          throw new HttpError(409, 'session_closed', 'This race session is already closed.');
        }

        const t = now();
        if (t - session.started_at > LIMITS.SESSION_MAX_MS) {
          q.close.run('expired', t, 'expired', hash, session.id, 'open');
          throw new HttpError(409, 'session_expired', 'This race session has expired.');
        }
        if (run.durationMs < LIMITS.MIN_DURATION_MS) {
          q.close.run('rejected', t, 'too_short', hash, session.id, 'open');
          return { body: { accepted: false, message: 'Run too short to rank.' } };
        }

        const reason = implausible(run, session, t);
        db.exec('BEGIN');
        try {
          const changed = q.close.run(reason ? 'rejected' : 'accepted', t, reason, hash, session.id, 'open').changes;
          if (!changed) throw new HttpError(409, 'session_closed', 'This race session is already closed.');
          if (!reason) {
            q.score.run(session.id, ctx.player.id, run.score, Math.round(run.distance), Math.round(run.topSpeed), run.bestCombo, run.durationMs, session.car_id, t);
            q.bumpRaces.run(ctx.player.id);
          }
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        if (reason) {
          log.warn('run rejected', { player: ctx.player.id, session: session.id, reason });
        } else {
          board.invalidate();
        }
        return { body: result(ctx.player, session, !reason, run) };
      },
    },
  ];
}
