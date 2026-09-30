// Server-side plausibility checks for submitted runs. The client is untrusted: every number
// it sends is bounded by what the game's own rules make physically possible, using the same
// balance data the client runs on. See README "Anti-cheat" for what this can and cannot stop.
import {
  CARS, UPGRADES, DIFFICULTY, SLIPSTREAM, COMBO, SCORE, NEAR_MISS, EVENTS, POLICE, RARE_TRAFFIC, PICKUPS,
  HEAT, ROADBLOCK, RIVAL, SKILL, COMBO_MILESTONES,
} from '../../../client/js/balance.js';
import { ENVIRONMENTS } from '../../../client/js/data/environments.js';
import { upgradeCeiling } from '../../../client/js/progression/engine.js';

export const CAR_IDS = new Set(CARS.map(c => c.id));
export const ENV_IDS = new Set(ENVIRONMENTS.map(e => e.id));
export const COMBO_VALUES = new Set(COMBO.TIERS.map(t => t.mult));
const MAX_MULT = Math.max(...COMBO_VALUES);

export const LIMITS = {
  SESSION_MAX_MS: 3 * 60 * 60_000, // a session can be finished for this long after it starts
  MIN_DURATION_MS: 1000,
  MAX_DURATION_MS: 3 * 60 * 60_000,
  CLOCK_SLACK_MS: 5000, // client race time vs server wall time (latency, timers)
  DISTANCE_SLACK: 1.03,
  DISTANCE_SLACK_M: 60,
  MAX_DISTANCE_M: 2_000_000,
  SPEED_SLACK: 1.03,
  // Actions can't outnumber the traffic the road spawns: the densest wave spacing is
  // ~52 m with ≤2.7 cars, i.e. about one car per 19 m. Generous caps below.
  METERS_PER_NEAR_MISS: 12,
  METERS_PER_OVERTAKE: 8,
  METERS_PER_CHICANE: 150,
  METERS_PER_LEGEND: 400,
  SCORE_FLOOR: 25_000, // headroom for short runs with bonuses
  // A pursuit needs heat to build (★2) and the escape meter to fill: well over 15 s each.
  SECONDS_PER_ESCAPE: 15,
  SECONDS_PER_RIVAL: 40, // a rival duel lasts RIVAL.DURATION and needs a lead-in
  SECONDS_PER_CHALLENGE: 20,
};

const MAX_STARS = POLICE.ESCAPE_POINTS.length - 1;
// Heat (+10 % per star) and FLOW multiply every point the run scores.
const MAX_SCALE = (1 + MAX_STARS * HEAT.SCORE_BONUS_PER_STAR) * COMBO_MILESTONES.FLOW_SCORE;
const CHALLENGE_POINTS = Math.max(...Object.values(EVENTS).filter(e => e.kind === 'challenge').map(e => e.points || 0));

// Highest speed a car can reach: engine upgrades up to its tier's ceiling, full difficulty
// bonus, slipstream, and nitro boost (also up to the ceiling) plus a slingshot surge on top.
function maxSpeedFor(car) {
  const ceiling = upgradeCeiling(car.id);
  const sum = key => UPGRADES[key].steps.slice(0, ceiling).reduce((a, b) => a + b, 0) / 100;
  const top = car.stats.topKmh * (1 + sum('engine')) * (1 + DIFFICULTY.PLAYER_SPEED_BONUS) * (1 + SLIPSTREAM.TOP_SPEED_BONUS);
  return top + car.stats.boostKmh * (1 + sum('nitro')) + SKILL.SLINGSHOT_KMH;
}
export const MAX_KMH = Object.fromEntries(CARS.map(c => [c.id, maxSpeedFor(c)]));

// Upper bound on score for a run: distance points at max speed, multiplier, the open-highway
// bonus and the heat/FLOW scale, plus every countable action (with the skill bonuses it can
// trigger) at max multiplier, plus per-km road bonuses and the pursuit/rival/challenge rewards.
export function maxScore(run, carId) {
  const kmh = MAX_KMH[carId];
  const perMeter = SCORE.POINTS_PER_METER + Math.max(0, kmh - SCORE.SPEED_BONUS_FROM_KMH) / SCORE.SPEED_BONUS_DIVISOR;
  const distancePts = run.distance * perMeter * MAX_MULT * (EVENTS.openHighway.scoreBonus || 1) * MAX_SCALE;
  const nearMiss = NEAR_MISS[0].points * SKILL.TRUCK_NEAR_MISS_MULT + SKILL.PERFECT_DODGE_POINTS;
  const overtake = SCORE.OVERTAKE + RARE_TRAFFIC.PASS_POINTS / 10 + SKILL.SLINGSHOT_POINTS + POLICE.PASS_POINTS;
  const actions = run.nearMisses * nearMiss + run.perfectOvertakes * SCORE.PERFECT_OVERTAKE + run.overtakes * overtake;
  const perKm = SCORE.CHECKPOINT + Math.max(EVENTS.roadwork.points, EVENTS.accident.points) + ROADBLOCK.POINTS + POLICE.PATROL_POINTS
    + SCORE.CHICANE * 4 + SCORE.PICKUP * 4 + SCORE.SPEED_STREAK * 4;
  const periodic = (run.distance / 1000 + 1) * perKm;
  const bonuses = (run.policeEscapes || 0) * POLICE.ESCAPE_POINTS[MAX_STARS] + (run.rivalsBeaten || 0) * RIVAL.POINTS + (run.challenges || 0) * CHALLENGE_POINTS;
  return (distancePts + (actions + periodic + bonuses) * MAX_MULT * MAX_SCALE) * 1.1 + LIMITS.SCORE_FLOOR;
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const COUNTERS = [
  'nearMisses', 'insaneMisses', 'overtakes', 'perfectOvertakes', 'chicanes', 'pickups', 'creditChips', 'crashes', 'policeEscapes', 'legendPasses', 'longestChase',
  'escapeStars', 'heatEscaped', 'maxHeat', 'rivalsBeaten', 'challenges',
];
const SECONDS = ['boostTime', 'highSpeedTime'];

// Shape check. Returns { ok, run } with a normalised run, or { ok: false, reason }. Older
// clients send only the ranking fields; the extra counters then default to 0.
export function parseRun(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'malformed' };
  const r = {
    carId: body.carId,
    envId: body.envId,
    score: body.score,
    distance: body.distance,
    topSpeed: body.topSpeed,
    bestCombo: body.bestCombo !== undefined ? body.bestCombo : body.bestMultiplier,
    durationMs: body.durationMs,
    bestCleanDistance: body.bestCleanDistance === undefined ? 0 : body.bestCleanDistance,
  };
  for (const k of COUNTERS) r[k] = body[k] === undefined ? 0 : body[k];
  for (const k of SECONDS) r[k] = body[k] === undefined ? 0 : body[k];
  if (r.carId !== undefined && !CAR_IDS.has(r.carId)) return { ok: false, reason: 'carId' };
  if (r.envId !== undefined && !ENV_IDS.has(r.envId)) return { ok: false, reason: 'envId' };
  if (!isInt(r.score, 0, 1e10)) return { ok: false, reason: 'score' };
  if (!isNum(r.distance, 0, LIMITS.MAX_DISTANCE_M)) return { ok: false, reason: 'distance' };
  if (!isNum(r.topSpeed, 0, 2000)) return { ok: false, reason: 'topSpeed' };
  if (!COMBO_VALUES.has(r.bestCombo)) return { ok: false, reason: 'bestCombo' };
  if (!isInt(r.durationMs, 0, LIMITS.MAX_DURATION_MS)) return { ok: false, reason: 'durationMs' };
  if (!isNum(r.bestCleanDistance, 0, LIMITS.MAX_DISTANCE_M)) return { ok: false, reason: 'bestCleanDistance' };
  for (const k of COUNTERS) if (!isInt(r[k], 0, 1e6)) return { ok: false, reason: k };
  for (const k of SECONDS) if (!isNum(r[k], 0, LIMITS.MAX_DURATION_MS / 1000)) return { ok: false, reason: k };
  return { ok: true, run: r };
}

// Plausibility: returns null when believable, else a short reason code.
//   boundsCarId — the car whose physics bound the run (the session's car, or for offline runs
//                 the fastest car the player actually owns)
//   elapsedMs   — server wall time the run had (session start → now), or null for offline runs
//                 (their time is checked against the offline budget instead)
export function implausible(run, boundsCarId, elapsedMs) {
  const maxKmh = MAX_KMH[boundsCarId];
  if (!maxKmh) return 'car';
  if (elapsedMs !== null && run.durationMs > elapsedMs + LIMITS.CLOCK_SLACK_MS) return 'duration_exceeds_wall_clock';
  if (run.topSpeed > maxKmh * LIMITS.SPEED_SLACK) return 'speed';
  const seconds = (elapsedMs === null ? run.durationMs : Math.min(run.durationMs, elapsedMs)) / 1000;
  if (run.distance > (maxKmh / 3.6) * seconds * LIMITS.DISTANCE_SLACK + LIMITS.DISTANCE_SLACK_M) return 'distance_vs_time';
  if (run.distance > 200 && run.topSpeed < (run.distance / Math.max(1, seconds)) * 3.6 * 0.95) return 'distance_vs_speed';
  if (run.nearMisses > run.distance / LIMITS.METERS_PER_NEAR_MISS + 5) return 'near_misses';
  if (run.insaneMisses > run.nearMisses) return 'insane_misses';
  if (run.overtakes > run.distance / LIMITS.METERS_PER_OVERTAKE + 5) return 'overtakes';
  if (run.perfectOvertakes > run.overtakes) return 'perfect_overtakes';
  if (run.chicanes > run.distance / LIMITS.METERS_PER_CHICANE + 3) return 'chicanes';
  if (run.legendPasses > Math.min(run.overtakes, run.distance / LIMITS.METERS_PER_LEGEND + 2)) return 'legend_passes';
  if (run.pickups > run.distance / (PICKUPS.INTERVAL[0] / 2) + 3) return 'pickups';
  if (run.creditChips > run.pickups) return 'credit_chips';
  if (run.policeEscapes > Math.floor(seconds / LIMITS.SECONDS_PER_ESCAPE) + 1) return 'police';
  if (run.maxHeat > MAX_STARS || run.heatEscaped > run.maxHeat) return 'heat';
  if (run.escapeStars > run.policeEscapes * MAX_STARS || run.heatEscaped > (run.policeEscapes > 0 ? MAX_STARS : 0)) return 'escape_stars';
  if (run.longestChase > seconds + 1) return 'chase';
  if (run.rivalsBeaten > Math.floor(seconds / LIMITS.SECONDS_PER_RIVAL) + 1) return 'rivals';
  if (run.challenges > Math.floor(seconds / LIMITS.SECONDS_PER_CHALLENGE) + 1) return 'challenges';
  if (run.boostTime > seconds + 1 || run.highSpeedTime > seconds + 1) return 'timers';
  if (run.bestCleanDistance > run.distance + 1) return 'clean_distance';
  if (run.score > maxScore(run, boundsCarId)) return 'score';
  // Reaching a multiplier needs combo points, which only actions give (≥1 point each).
  const tier = COMBO.TIERS.find(t => t.mult === run.bestCombo);
  if (tier.at > (run.nearMisses * NEAR_MISS[0].combo + run.overtakes * 3 + (run.distance / 1000 + 1) * 8)) return 'combo';
  return null;
}
