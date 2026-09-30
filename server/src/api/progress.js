import { createHash } from 'node:crypto';
import * as E from '../../../client/js/progression/engine.js';
import { CARS } from '../../../client/js/balance.js';
import { CAR_PROGRESSION, GUEST_IMPORT } from '../../../client/js/progression/config.js';
import { HttpError } from '../http.js';
import { RULES } from './rateLimit.js';
import { LIMITS, MAX_KMH, parseRun, implausible } from './raceRules.js';

// Cloud progression for online accounts — the server is the authority.
//
// The client never uploads its state ("I have 500,000 credits"). It sends OPERATIONS
// (buy this car, buy this upgrade, this race happened), each with a client-generated opId.
// The server re-applies every operation with the same engine the game uses
// (client/js/progression/engine.js), inside a transaction, validating it against ITS copy:
// credits, ownership, level, ceilings, and for races the physics plausibility checks. The
// result is the canonical progression document, which the client then adopts.
//
//   - atomic: each operation is one transaction (credits and ownership change together or not
//     at all)
//   - idempotent: a retried opId returns its first outcome and is never applied twice
//   - order: operations apply in the order the client made them; one that no longer fits
//     (e.g. credits spent on another phone meanwhile) is rejected, never half-applied
//
// The race itself never waits for any of this: the client settles locally and syncs later.

const OP_ID_RE = /^[A-Za-z0-9_:-]{8,64}$/;
export const MAX_OPS = 60;
const OFFLINE_SLACK_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const UPGRADE_COLS = E.UPGRADE_KEYS; // engine, turbo, tires, brakes, nitro, armor
const STAT_COLS = [
  ['races', 'races'], ['distance', 'distance_m'], ['playTime', 'play_time_s'], ['overtakes', 'overtakes'],
  ['nearMisses', 'near_misses'], ['insaneMisses', 'insane_misses'], ['perfectOvertakes', 'perfect_overtakes'],
  ['crashes', 'crashes'], ['boostTime', 'boost_time_s'], ['policeEscapes', 'police_escapes'], ['pickups', 'pickups'],
  ['chicanes', 'chicanes'], ['legendPasses', 'legend_passes'], ['rivalsBeaten', 'rivals_beaten'], ['missionsCompleted', 'missions_completed'],
  ['dailiesCompleted', 'dailies_completed'], ['creditsEarned', 'credits_earned'],
];
const RECORD_COLS = [
  ['score', 'best_score'], ['distance', 'best_distance_m'], ['topSpeed', 'best_top_speed'], ['combo', 'best_combo'],
  ['nearMisses', 'best_near_misses'], ['overtakes', 'best_overtakes'], ['chase', 'best_chase'], ['cleanDistance', 'best_clean_distance'],
  ['heat', 'best_heat'],
];
const json = v => JSON.stringify(v);
const parse = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};
const hashRun = run => createHash('sha256').update(json(run)).digest('hex');

// Server "today" for the daily challenge. Clients send their local date; it is accepted when
// within a day of the server's (time zones), otherwise the server's own date is used.
function dailyKey(clientKey, t) {
  const day = d => new Date(d).toISOString().slice(0, 10);
  const today = day(t);
  if (typeof clientKey === 'string' && [day(t - DAY_MS), today, day(t + DAY_MS)].includes(clientKey)) return clientKey;
  return today;
}

export function createProgressStore(db, now) {
  // ---- canonical car catalog: config → cars table (idempotent upsert at startup)
  const upsertCar = db.prepare(`INSERT INTO cars (id, name, tier, price, level_required, requirements, upgrade_ceiling, legendary, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, tier = excluded.tier, price = excluded.price, level_required = excluded.level_required,
      requirements = excluded.requirements, upgrade_ceiling = excluded.upgrade_ceiling, legendary = excluded.legendary,
      sort_order = excluded.sort_order, updated_at = excluded.updated_at`);
  CARS.forEach((car, i) => {
    const rules = CAR_PROGRESSION[car.id];
    const level = (rules.requires.find(r => r.kind === 'level') || { value: 1 }).value;
    upsertCar.run(car.id, car.name, rules.tier, rules.price, level, json(rules.requires), E.upgradeCeiling(car.id), rules.legendary ? 1 : 0, i, now());
  });

  const q = {
    progress: db.prepare('SELECT * FROM player_progress WHERE player_id = ?'),
    stats: db.prepare('SELECT * FROM player_stats WHERE player_id = ?'),
    cars: db.prepare('SELECT * FROM player_cars WHERE player_id = ? ORDER BY acquired_at, car_id'),
    cosmetics: db.prepare('SELECT item FROM player_cosmetics WHERE player_id = ?'),
    achievements: db.prepare('SELECT achievement_id, unlocked_at FROM player_achievements WHERE player_id = ?'),
    insertProgress: db.prepare(`INSERT INTO player_progress (player_id, credits, xp, level, selected_car, missions, daily, feats, seen_unlocks, revision, last_sync_at, updated_at)
      VALUES (?, 0, 0, 1, ?, ?, ?, '{}', '[]', 0, ?, ?)`),
    insertStats: db.prepare('INSERT INTO player_stats (player_id) VALUES (?)'),
    updateProgress: db.prepare(`UPDATE player_progress SET credits = ?, xp = ?, level = ?, selected_car = ?, missions = ?, daily = ?, feats = ?,
      seen_unlocks = ?, revision = revision + 1, updated_at = ? WHERE player_id = ?`),
    updateStats: db.prepare(`UPDATE player_stats SET ${STAT_COLS.map(([, c]) => `${c} = ?`).join(', ')}, car_distance = ?,
      ${RECORD_COLS.map(([, c]) => `${c} = ?`).join(', ')} WHERE player_id = ?`),
    upsertPlayerCar: db.prepare(`INSERT INTO player_cars (player_id, car_id, ${UPGRADE_COLS.join(', ')}, custom, acquired_at)
      VALUES (?, ?, ${UPGRADE_COLS.map(() => '?').join(', ')}, ?, ?)
      ON CONFLICT(player_id, car_id) DO UPDATE SET ${UPGRADE_COLS.map(c => `${c} = excluded.${c}`).join(', ')}, custom = excluded.custom`),
    deletePlayerCars: db.prepare('DELETE FROM player_cars WHERE player_id = ?'),
    addCosmetic: db.prepare('INSERT OR IGNORE INTO player_cosmetics (player_id, item, acquired_at) VALUES (?, ?, ?)'),
    addAchievement: db.prepare('INSERT OR IGNORE INTO player_achievements (player_id, achievement_id, unlocked_at) VALUES (?, ?, ?)'),
    touchSync: db.prepare('UPDATE player_progress SET last_sync_at = ? WHERE player_id = ?'),
    markImported: db.prepare('UPDATE player_progress SET imported_at = ? WHERE player_id = ?'),
    op: db.prepare('SELECT status, code FROM sync_ops WHERE player_id = ? AND op_id = ?'),
    recordOp: db.prepare('INSERT INTO sync_ops (player_id, op_id, type, status, code, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    raceResult: db.prepare(`INSERT INTO race_results (player_id, op_id, session_id, source, car_id, env_id, score, distance_m, duration_ms,
      top_speed_kmh, best_combo, near_misses, overtakes, perfect_overtakes, details, status, reject_reason, credits_awarded, xp_awarded, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    raceByOp: db.prepare('SELECT status, credits_awarded, xp_awarded, reject_reason FROM race_results WHERE player_id = ? AND op_id = ?'),
    session: db.prepare('SELECT * FROM race_sessions WHERE id = ? AND player_id = ?'),
    closeSession: db.prepare('UPDATE race_sessions SET status = ?, finished_at = ?, reject_reason = ?, result_hash = ? WHERE id = ? AND status = ?'),
    score: db.prepare(`INSERT INTO scores (session_id, player_id, score, distance_m, top_speed_kmh, best_combo, duration_ms, car_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    bumpRaces: db.prepare('UPDATE players SET races = races + 1 WHERE id = ?'),
    prevBest: db.prepare('SELECT MAX(score) AS best FROM scores WHERE player_id = ? AND session_id != ?'),
  };

  function tx(fn) {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // Default rows for a new account (called inside the account-creation transaction). The
  // mission seed is the account id, so client and server roll the same missions.
  function initialize(playerId) {
    const fresh = E.defaultProgress(playerId);
    E.ensureMissions(fresh);
    const t = now();
    q.insertProgress.run(playerId, E.STARTER, json(fresh.missions), json(fresh.daily), t, t);
    q.insertStats.run(playerId);
    q.upsertPlayerCar.run(playerId, E.STARTER, ...UPGRADE_COLS.map(() => 0), json(fresh.cars[E.STARTER].custom), t);
  }

  // Rows → progression document (the engine's format).
  function load(playerId) {
    let p = q.progress.get(playerId);
    if (!p) {
      initialize(playerId); // accounts created before cloud progression existed
      p = q.progress.get(playerId);
    }
    const st = q.stats.get(playerId);
    const cars = q.cars.all(playerId);
    const achievements = {};
    for (const a of q.achievements.all(playerId)) achievements[a.achievement_id] = a.unlocked_at;
    const doc = {
      credits: p.credits,
      xp: p.xp,
      selectedCar: p.selected_car,
      ownedCars: cars.map(c => c.car_id),
      cars: Object.fromEntries(cars.map(c => [c.car_id, { upgrades: Object.fromEntries(UPGRADE_COLS.map(k => [k, c[k]])), custom: parse(c.custom, {}) }])),
      cosmetics: q.cosmetics.all(playerId).map(r => r.item),
      achievements,
      feats: parse(p.feats, {}),
      missions: parse(p.missions, {}),
      daily: parse(p.daily, {}),
      seenUnlocks: parse(p.seen_unlocks, []),
      records: Object.fromEntries(RECORD_COLS.map(([k, c]) => [k, st[c]])),
      stats: { ...Object.fromEntries(STAT_COLS.map(([k, c]) => [k, st[c]])), carDistance: parse(st.car_distance, {}) },
    };
    // Normalising also drops anything a config change retired (e.g. a removed car).
    const state = E.normalizeProgress(doc, playerId);
    E.ensureMissions(state);
    return { state, meta: p };
  }

  // Progression document → rows. Called inside the operation's transaction.
  function save(playerId, state, { replaceCars = false } = {}) {
    const t = now();
    q.updateProgress.run(state.credits, state.xp, state.level, state.selectedCar, json(state.missions), json(state.daily),
      json(state.feats), json(state.seenUnlocks), t, playerId);
    q.updateStats.run(...STAT_COLS.map(([k]) => state.stats[k]), json(state.stats.carDistance),
      ...RECORD_COLS.map(([k]) => state.records[k]), playerId);
    if (replaceCars) q.deletePlayerCars.run(playerId);
    for (const id of state.ownedCars) {
      const c = state.cars[id];
      q.upsertPlayerCar.run(playerId, id, ...UPGRADE_COLS.map(k => c.upgrades[k]), json(c.custom), t);
    }
    for (const item of state.cosmetics) q.addCosmetic.run(playerId, item, t);
    for (const [id, at] of Object.entries(state.achievements)) q.addAchievement.run(playerId, id, at);
  }

  function snapshot(playerId) {
    const { state, meta } = load(playerId);
    return { progress: state, revision: meta.revision };
  }

  // ---------------------------------------------------------------- races

  // The fastest car this player really owns (bounds offline runs claimed in any other car).
  const fastestOwned = state => state.ownedCars.reduce((best, id) => (MAX_KMH[id] > MAX_KMH[best] ? id : best), E.STARTER);

  function applyRace(player, state, op, ctx) {
    const t = now();
    const parsed = parseRun(op.run);
    if (!parsed.ok) return { ok: false, code: 'invalid_run', message: `Invalid run data (${parsed.reason}).` };
    const run = parsed.run;
    let session = null;
    let elapsed = null;
    let carId = run.carId && state.ownedCars.includes(run.carId) ? run.carId : null;
    let bounds;
    if (op.sessionId !== undefined) {
      session = typeof op.sessionId === 'string' ? q.session.get(op.sessionId, player.id) : null;
      // Another player's session looks exactly like a missing one.
      if (!session) return { ok: false, code: 'session_not_found', message: 'Race session not found.', status: 404 };
      if (session.status !== 'open') return { ok: false, code: 'session_closed', message: 'This race session is already closed.', status: 409 };
      elapsed = t - session.started_at;
      if (elapsed > LIMITS.SESSION_MAX_MS) {
        q.closeSession.run('expired', t, 'expired', hashRun(run), session.id, 'open');
        return { ok: false, code: 'session_expired', message: 'This race session has expired.', status: 409 };
      }
      carId = session.car_id;
      bounds = session.car_id;
    } else {
      // Offline run (no server session): its race time must fit in the real time that passed
      // since this account last talked to the server, shared by every offline run in the batch.
      ctx.offlineUsed += run.durationMs;
      if (ctx.offlineUsed > ctx.offlineBudget) return { ok: false, code: 'offline_budget', message: 'More offline racing reported than time allows.' };
      bounds = carId || fastestOwned(state);
    }
    const reason = run.durationMs < LIMITS.MIN_DURATION_MS ? 'too_short' : implausible(run, bounds, elapsed);
    const details = json(Object.fromEntries(['insaneMisses', 'chicanes', 'pickups', 'creditChips', 'crashes', 'policeEscapes', 'legendPasses', 'longestChase', 'boostTime', 'highSpeedTime', 'bestCleanDistance', 'escapeStars', 'heatEscaped', 'maxHeat', 'rivalsBeaten', 'challenges'].map(k => [k, run[k]])));
    const envId = run.envId || (session && session.env_id) || 'neon';
    const record = (status, rejectReason, credits, xp) => q.raceResult.run(player.id, op.opId, session ? session.id : null, session ? 'online' : 'offline',
      carId || state.selectedCar, envId, run.score, run.distance, run.durationMs, run.topSpeed, run.bestCombo, run.nearMisses, run.overtakes,
      run.perfectOvertakes, details, status, rejectReason, credits, xp, t);

    if (reason) {
      record('rejected', reason, 0, 0);
      if (session) q.closeSession.run('rejected', t, reason, hashRun(run), session.id, 'open');
      // Deliberately vague: the exact failed check is logged, not handed to the client.
      return { ok: false, code: reason === 'too_short' ? 'too_short' : 'implausible', message: reason === 'too_short' ? 'Run too short to count.' : 'This run could not be verified.', reason };
    }
    const engineRun = { ...run, carId: carId || state.selectedCar, bestMultiplier: run.bestCombo };
    const result = E.settleRun(state, engineRun, { dateKey: dailyKey(op.dateKey, t), now: t });
    record('accepted', null, result.creditsTotal, result.xp);
    let ranked = null;
    if (session) {
      q.closeSession.run('accepted', t, null, hashRun(run), session.id, 'open');
      q.score.run(session.id, player.id, run.score, Math.round(run.distance), Math.round(run.topSpeed), run.bestCombo, run.durationMs, session.car_id, t);
      q.bumpRaces.run(player.id);
      const prev = q.prevBest.get(player.id, session.id).best;
      ranked = { personalBest: prev === null || run.score > prev };
      ctx.rankedSession = true;
    }
    return {
      ok: true,
      summary: {
        creditsTotal: result.creditsTotal, xp: result.xp, level: result.levelAfter.level, levelsGained: result.levelsGained,
        events: result.events, newlyAvailable: result.newlyAvailable, capped: result.capped,
      },
      ranked,
    };
  }

  // ---------------------------------------------------------------- operations

  const HANDLERS = {
    purchaseCar: (s, op) => E.purchaseCar(s, op.carId),
    buyUpgrade: (s, op) => E.buyUpgrade(s, op.carId, op.key),
    selectCar: (s, op) => E.selectCar(s, op.carId),
    buyCosmetic: (s, op) => E.buyCosmetic(s, op.slot, op.id),
    setCosmetic: (s, op) => E.setCosmetic(s, op.carId, op.slot, op.id),
  };

  // Applies one operation atomically. Returns { opId, ok, code?, message?, duplicate?, ... }.
  function applyOne(player, op, ctx) {
    if (!op || typeof op !== 'object' || typeof op.opId !== 'string' || !OP_ID_RE.test(op.opId)) {
      return { opId: op && typeof op.opId === 'string' ? op.opId.slice(0, 64) : null, ok: false, code: 'invalid_op', message: 'Invalid operation.' };
    }
    if (op.type !== 'race' && !HANDLERS[op.type]) return { opId: op.opId, ok: false, code: 'unknown_op', message: 'Unknown operation.' };
    return tx(() => {
      const seen = q.op.get(player.id, op.opId);
      if (seen && op.type === 'race' && op.sessionId !== undefined) {
        // A session answers its exact retry; different numbers for a closed session are a replay.
        const session = typeof op.sessionId === 'string' ? q.session.get(op.sessionId, player.id) : null;
        const parsed = parseRun(op.run);
        if (!session || !parsed.ok || hashRun(parsed.run) !== session.result_hash) {
          return { opId: op.opId, ok: false, code: 'session_closed', message: 'This race session is already closed.', status: 409 };
        }
      }
      if (seen) {
        const out = { opId: op.opId, ok: seen.status === 'applied', code: seen.code || undefined, duplicate: true };
        if (op.type === 'race') {
          const r = q.raceByOp.get(player.id, op.opId);
          if (r) out.summary = { creditsTotal: r.credits_awarded, xp: r.xp_awarded };
        }
        return out;
      }
      const { state } = load(player.id);
      const r = op.type === 'race' ? applyRace(player, state, op, ctx) : HANDLERS[op.type](state, op);
      if (r.status === 404 || r.status === 409 || r.code === 'invalid_run') {
        // Not a decision about the run (unknown/closed session, malformed data): nothing is
        // consumed, so a corrected retry can still be judged.
        return { opId: op.opId, ...r };
      }
      if (r.ok) save(player.id, state);
      q.recordOp.run(player.id, op.opId, op.type, r.ok ? 'applied' : 'rejected', r.ok ? null : r.code, now());
      const { reason, ...out } = r;
      if (reason && ctx.log) ctx.log.warn('run rejected', { player: player.id, op: op.opId, reason });
      return { opId: op.opId, ...out };
    });
  }

  // A batch from the sync queue, in order. Returns per-op results and the canonical document.
  function applyBatch(player, ops, log) {
    const t = now();
    const meta = q.progress.get(player.id);
    const lastContact = meta ? meta.last_sync_at : t;
    const ctx = { offlineUsed: 0, offlineBudget: Math.max(0, t - lastContact) + OFFLINE_SLACK_MS, log, rankedSession: false };
    const results = ops.map(op => applyOne(player, op, ctx));
    q.touchSync.run(t, player.id);
    return { results, ...snapshot(player.id), rankedSession: ctx.rankedSession };
  }

  // One-time import of a guest's local progress when it goes online. Local data can't be
  // verified, so it is clamped (GUEST_IMPORT) and every owned car must still meet its
  // requirements under the clamped state. Allowed only before any operation was applied.
  function importGuest(player, raw) {
    return tx(() => {
      const { meta } = load(player.id);
      if (meta.imported_at || meta.revision > 0) throw new HttpError(409, 'import_closed', 'This account already has cloud progress.');
      const clamped = [];
      const doc = E.normalizeProgress(raw, player.id);
      const maxXp = E.totalXpForLevel(GUEST_IMPORT.MAX_LEVEL + 1) - 1;
      if (doc.xp > maxXp) {
        doc.xp = maxXp;
        clamped.push('level');
      }
      doc.level = E.levelInfo(doc.xp).level;
      if (doc.credits > GUEST_IMPORT.MAX_CREDITS) {
        doc.credits = GUEST_IMPORT.MAX_CREDITS;
        clamped.push('credits');
      }
      for (const id of doc.ownedCars) {
        for (const k of E.UPGRADE_KEYS) {
          if (doc.cars[id].upgrades[k] > GUEST_IMPORT.MAX_UPGRADE_STEP) {
            doc.cars[id].upgrades[k] = GUEST_IMPORT.MAX_UPGRADE_STEP;
            if (!clamped.includes('upgrades')) clamped.push('upgrades');
          }
        }
      }
      const kept = doc.ownedCars.filter(id => id === E.STARTER || E.carStatus({ ...doc, ownedCars: [] }, id).unlocked);
      if (kept.length !== doc.ownedCars.length) clamped.push('cars');
      for (const id of doc.ownedCars) if (!kept.includes(id)) delete doc.cars[id];
      doc.ownedCars = kept;
      if (!kept.includes(doc.selectedCar)) doc.selectedCar = E.STARTER;
      doc.missions = { active: [], seq: 0, seed: player.id };
      E.ensureMissions(doc);
      save(player.id, doc, { replaceCars: true });
      q.markImported.run(now(), player.id);
      return { clamped };
    });
  }

  return { initialize, load, snapshot, applyOne, applyBatch, importGuest };
}

// ---------------------------------------------------------------- routes

export function progressRoutes({ progress, limiter, log, board }) {
  const limit = (rule, key) => {
    const r = limiter.take(rule, key);
    if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many requests. Slow down.', { retryAfter: r.retryAfter });
  };
  // A single garage operation as a direct call (online, from the garage screen).
  const garageOp = type => async ctx => {
    const body = (await ctx.body()) || {};
    limit(RULES.garage, ctx.player.id);
    const r = progress.applyOne(ctx.player, { ...body, type }, { offlineUsed: 0, offlineBudget: 0, log });
    const status = r.ok ? 200 : r.code === 'invalid_op' || r.code === 'unknown_car' || r.code === 'unknown_upgrade' || r.code === 'unknown_item' ? 422 : 409;
    if (!r.ok && !r.duplicate) throw new HttpError(status, r.code, r.message || 'Operation rejected.');
    return { body: { result: r, ...progress.snapshot(ctx.player.id) } };
  };
  const view = ctx => progress.load(ctx.player.id).state;

  return [
    { method: 'GET', path: '/progress', auth: true, handler: ctx => ({ body: progress.snapshot(ctx.player.id) }) },
    {
      method: 'POST',
      path: '/progress/import',
      auth: true,
      maxBody: 64 * 1024,
      async handler(ctx) {
        const body = await ctx.body();
        limit(RULES.import, ctx.player.id);
        const r = progress.importGuest(ctx.player, body && body.progress);
        return { body: { clamped: r.clamped, ...progress.snapshot(ctx.player.id) } };
      },
    },
    {
      method: 'POST',
      path: '/sync',
      auth: true,
      maxBody: 96 * 1024,
      async handler(ctx) {
        const body = await ctx.body();
        limit(RULES.sync, ctx.player.id);
        const ops = body && Array.isArray(body.ops) ? body.ops : null;
        if (!ops || ops.length > MAX_OPS) throw new HttpError(422, 'invalid_batch', `Send 0–${MAX_OPS} operations.`);
        const out = progress.applyBatch(ctx.player, ops, log);
        if (out.rankedSession) {
          board.invalidate();
          const ranks = { day: board.standing(ctx.player.id, 'score', 'day'), week: board.standing(ctx.player.id, 'score', 'week'), all: board.standing(ctx.player.id, 'score', 'all') };
          for (const r of out.results) if (r.ranked) r.ranked.ranks = ranks;
        }
        return { body: { results: out.results, progress: out.progress, revision: out.revision } };
      },
    },
    { method: 'GET', path: '/cars', handler: () => ({ body: { cars: carCatalog() } }) },
    {
      method: 'GET',
      path: '/garage',
      auth: true,
      handler(ctx) {
        const s = view(ctx);
        const cars = CARS.map(c => {
          const st = E.carStatus(s, c.id);
          return {
            id: c.id, name: st.hidden ? '???' : c.name, tier: st.tier, state: st.state, price: st.price,
            requirements: st.hidden ? [] : st.requirements.map(r => ({ text: r.secret ? 'Unknown' : r.text, value: r.value, target: r.target, met: r.met })),
            upgrades: st.owned ? s.cars[c.id].upgrades : null,
          };
        });
        return { body: { credits: s.credits, level: s.level, selectedCar: s.selectedCar, cars } };
      },
    },
    { method: 'POST', path: '/garage/purchase', auth: true, handler: garageOp('purchaseCar') },
    { method: 'POST', path: '/garage/upgrade', auth: true, handler: garageOp('buyUpgrade') },
    { method: 'POST', path: '/garage/select', auth: true, handler: garageOp('selectCar') },
    { method: 'POST', path: '/garage/cosmetic', auth: true, handler: garageOp('buyCosmetic') },
    {
      method: 'GET',
      path: '/missions',
      auth: true,
      handler(ctx) {
        const s = view(ctx);
        const key = new Date().toISOString().slice(0, 10);
        const daily = E.syncDaily(s, key);
        return { body: { missions: s.missions.active, daily: { ...daily, progress: s.daily.progress, claimed: s.daily.claimed, reward: E.dailyReward(s.level) } } };
      },
    },
    {
      method: 'GET',
      path: '/achievements',
      auth: true,
      handler: ctx => ({ body: { achievements: E.achievementList(view(ctx)).map(a => ({ id: a.id, unlocked: a.unlocked, progress: a.progress, reward: a.reward })) } }),
    },
  ];
}

// Public catalog: tiers, prices and requirements as the server enforces them.
function carCatalog() {
  return CARS.map(c => {
    const r = CAR_PROGRESSION[c.id];
    const secret = r.requires.some(x => x.kind === 'flag');
    return {
      id: c.id, name: secret ? '???' : c.name, tier: r.tier, price: r.price, legendary: Boolean(r.legendary),
      upgradeCeiling: E.upgradeCeiling(c.id),
      requirements: r.requires.map(x => (x.kind === 'flag' ? { kind: 'secret' } : x)),
    };
  });
}
