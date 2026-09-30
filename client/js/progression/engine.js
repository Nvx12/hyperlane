// The progression engine: the ONE set of rules for XP, levels, credits, car unlocks and
// purchases, upgrades, cosmetics, missions, the daily challenge and achievements.
//
// Pure functions over a progression document (`state`, shape below). No DOM, no storage, no
// network, no clock or randomness of its own — so the same code runs in the browser (guest
// profiles, instant feedback) and on the server (the authority for online profiles), and both
// always reach the same result for the same inputs.
//
// state = {
//   credits, xp (lifetime total), level (derived from xp), selectedCar,
//   ownedCars: [id], cars: { id: { upgrades: {engine…armor}, custom: {slot: id} } },
//   cosmetics: ['slot:id'], achievements: { id: timestamp }, feats: { phantom: true },
//   missions: { active: [...], seq, seed }, daily: { date, progress, claimed },
//   records: {...}, stats: {...}, seenUnlocks: [carId],
// }

import { CARS, UPGRADES, DEFAULT_CAR_PROFILE, STAT_RANGES, COMBO } from '../balance.js';
import { OBJECTIVES, MISSION_TEMPLATES, DAILY_GOALS } from '../data/missions.js';
import { ACHIEVEMENTS } from '../data/achievements.js';
import { COSMETICS, defaultCustom } from '../data/cosmetics.js';
import { createRng, hashString } from '../Rng.js';
import {
  XP_CURVE, LEVEL_TITLES, TIERS, CAR_PROGRESSION, UPGRADE_PRICING, COSMETIC_PRICES,
  RUN_CREDITS, RUN_XP, RUN_CAPS, MISSION_REWARDS, DAILY_REWARDS, ACHIEVEMENT_REWARDS,
} from './config.js';

export const STARTER = 'vireo';
export const UPGRADE_KEYS = Object.keys(UPGRADES);
const CAR_BY_ID = new Map(CARS.map(c => [c.id, c]));
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const fmt = n => Math.floor(n).toLocaleString('en-US');

export const getCar = id => CAR_BY_ID.get(id) || CAR_BY_ID.get(STARTER);
export const isCarId = id => CAR_BY_ID.has(id);
export const carRules = id => CAR_PROGRESSION[id] || CAR_PROGRESSION[STARTER];
export const tierOf = id => TIERS[carRules(id).tier];

// ---------------------------------------------------------------- empty documents

export const emptyRecords = () => ({ score: 0, distance: 0, topSpeed: 0, combo: 1, nearMisses: 0, overtakes: 0, chase: 0, cleanDistance: 0 });
export const emptyStats = () => ({
  races: 0, distance: 0, playTime: 0, overtakes: 0, nearMisses: 0, insaneMisses: 0, perfectOvertakes: 0,
  crashes: 0, boostTime: 0, policeEscapes: 0, pickups: 0, chicanes: 0, legendPasses: 0,
  missionsCompleted: 0, dailiesCompleted: 0, creditsEarned: 0, carDistance: {},
});
export const newCarState = id => ({ upgrades: Object.fromEntries(UPGRADE_KEYS.map(k => [k, 0])), custom: defaultCustom(getCar(id)) });

export function defaultProgress(seed = '') {
  return {
    credits: 0,
    xp: 0,
    level: 1,
    selectedCar: STARTER,
    ownedCars: [STARTER],
    cars: { [STARTER]: newCarState(STARTER) },
    cosmetics: [],
    achievements: {},
    feats: {},
    missions: { active: [], seq: 0, seed },
    daily: { date: '', progress: {}, claimed: false },
    records: emptyRecords(),
    stats: emptyStats(),
    seenUnlocks: [],
  };
}

// ---------------------------------------------------------------- level

export const xpToNext = level => XP_CURVE.BASE + XP_CURVE.STEP * level;
export const totalXpForLevel = level => XP_CURVE.BASE * (level - 1) + (XP_CURVE.STEP * (level - 1) * level) / 2;

export function titleForLevel(level) {
  let title = LEVEL_TITLES[0].title;
  for (const t of LEVEL_TITLES) if (level >= t.level) title = t.title;
  return title;
}

// Level for a lifetime XP total, plus progress inside that level.
export function levelInfo(totalXp) {
  let level = 1;
  while (level < XP_CURVE.MAX_LEVEL && totalXp >= totalXpForLevel(level + 1)) level++;
  const into = totalXp - totalXpForLevel(level);
  const need = level >= XP_CURVE.MAX_LEVEL ? 0 : xpToNext(level);
  return { level, xp: into, need, title: titleForLevel(level), max: level >= XP_CURVE.MAX_LEVEL };
}

// ---------------------------------------------------------------- car requirements

const RECORD_TEXT = {
  score: v => `Score ${fmt(v)} in one run`,
  combo: v => `Reach a x${v} combo`,
  topSpeed: v => `Reach ${v} km/h`,
  distance: v => `Drive ${v / 1000} km in one run`,
  cleanDistance: v => `Drive ${v / 1000} km without crashing`,
};
const STAT_TEXT = {
  missionsCompleted: v => `Complete ${v} missions`,
  perfectOvertakes: v => `Land ${v} perfect overtakes`,
  nearMisses: v => `Perform ${v} near misses`,
  distance: v => `Drive ${v / 1000} km in total`,
  policeEscapes: v => `Escape ${v} police pursuits`,
  races: v => `Finish ${v} races`,
};

// One requirement → { kind, text, value, target, met, secret }.
export function requirementStatus(state, req) {
  switch (req.kind) {
    case 'level': return { kind: 'level', text: `Driver level ${req.value}`, value: state.level, target: req.value, met: state.level >= req.value };
    case 'record': {
      const value = state.records[req.key] || 0;
      return { kind: 'record', key: req.key, text: RECORD_TEXT[req.key](req.value), value, target: req.value, met: value >= req.value };
    }
    case 'stat': {
      const value = state.stats[req.key] || 0;
      return { kind: 'stat', key: req.key, text: STAT_TEXT[req.key](req.value), value, target: req.value, met: value >= req.value };
    }
    case 'achievement': {
      const a = ACHIEVEMENTS.find(x => x.id === req.id);
      const met = Boolean(state.achievements[req.id]);
      return { kind: 'achievement', text: `Achievement: ${a ? a.name : req.id}`, value: met ? 1 : 0, target: 1, met };
    }
    case 'flag': {
      const met = Boolean(state.feats[req.key]);
      return { kind: 'flag', text: req.hint || 'Unknown', value: met ? 1 : 0, target: 1, met, secret: true };
    }
    default: return { kind: req.kind, text: '', value: 0, target: 1, met: false };
  }
}

// Everything the garage needs to know about a car, from this player's point of view:
// owned · available (requirements met, can be bought) · locked (requirements missing).
export function carStatus(state, id) {
  const car = getCar(id);
  const rules = carRules(id);
  const owned = state.ownedCars.includes(id);
  const requirements = rules.requires.map(r => requirementStatus(state, r));
  const unlocked = requirements.every(r => r.met);
  const secret = rules.requires.some(r => r.kind === 'flag');
  return {
    id,
    car,
    tier: rules.tier,
    tierName: TIERS[rules.tier].name,
    legendary: Boolean(rules.legendary),
    price: rules.price,
    owned,
    unlocked,
    // Secret cars stay "???" until their hidden condition is met.
    hidden: secret && !owned && !requirements.some(r => r.kind === 'flag' && r.met),
    affordable: state.credits >= rules.price,
    state: owned ? 'owned' : unlocked ? 'available' : 'locked',
    requirements,
  };
}

// Result codes are stable: the server returns them to clients as error codes.
const fail = (code, message) => ({ ok: false, code, message });
const ok = extra => ({ ok: true, ...extra });

export function purchaseCar(state, id) {
  if (!isCarId(id)) return fail('unknown_car', 'Unknown car.');
  const s = carStatus(state, id);
  if (s.owned) return fail('already_owned', 'You already own this car.');
  if (!s.unlocked) return fail('locked', 'This car is still locked.');
  if (state.credits < s.price) return fail('insufficient_credits', 'Not enough credits.');
  state.credits -= s.price;
  state.ownedCars.push(id);
  if (!state.cars[id]) state.cars[id] = newCarState(id);
  return ok({ price: s.price });
}

export function selectCar(state, id) {
  if (!isCarId(id)) return fail('unknown_car', 'Unknown car.');
  if (!state.ownedCars.includes(id)) return fail('not_owned', 'You do not own this car.');
  state.selectedCar = id;
  return ok();
}

// ---------------------------------------------------------------- upgrades

// Sum of the first `level` percentage steps of an upgrade, as a fraction.
export function upgradeBonus(key, level) {
  const steps = UPGRADES[key].steps;
  let total = 0;
  for (let i = 0; i < level && i < steps.length; i++) total += steps[i];
  return total / 100;
}

export const upgradeCeiling = carId => Math.min(TIERS[carRules(carId).tier].upgradeCeiling, UPGRADES.engine.steps.length);

export function upgradePrice(carId, step) {
  const raw = UPGRADE_PRICING.STEP_PRICES[step - 1] * UPGRADE_PRICING.TIER_MULTIPLIER[carRules(carId).tier];
  return Math.round(raw / 50) * 50;
}

// State of one upgrade line on one car: current level, ceiling, next price and gates.
export function upgradeInfo(state, carId, key) {
  const level = state.cars[carId] ? state.cars[carId].upgrades[key] || 0 : 0;
  const ceiling = upgradeCeiling(carId);
  const maxed = level >= ceiling;
  const next = level + 1;
  const levelRequired = maxed ? 0 : UPGRADE_PRICING.LEVEL_REQUIRED[next - 1];
  const cost = maxed ? null : upgradePrice(carId, next);
  return {
    key, level, ceiling, maxed, cost, levelRequired,
    levelLocked: !maxed && state.level < levelRequired,
    affordable: !maxed && cost !== null && state.credits >= cost,
    nextBonus: maxed ? 0 : UPGRADES[key].steps[level],
  };
}

export function buyUpgrade(state, carId, key) {
  if (!isCarId(carId)) return fail('unknown_car', 'Unknown car.');
  if (!UPGRADES[key]) return fail('unknown_upgrade', 'Unknown upgrade.');
  if (!state.ownedCars.includes(carId)) return fail('not_owned', 'You do not own this car.');
  const u = upgradeInfo(state, carId, key);
  if (u.maxed) return fail('maxed', 'This upgrade is at its maximum for this car.');
  if (u.levelLocked) return fail('level_required', `Requires driver level ${u.levelRequired}.`);
  if (state.credits < u.cost) return fail('insufficient_credits', 'Not enough credits.');
  state.credits -= u.cost;
  state.cars[carId].upgrades[key] = u.level + 1;
  return ok({ price: u.cost, level: u.level + 1 });
}

// Cheapest upgrade the player could buy next on this car (for "READY" badges and goals).
export function nextUpgrade(state, carId) {
  let best = null;
  for (const key of UPGRADE_KEYS) {
    const u = upgradeInfo(state, carId, key);
    if (u.maxed || u.levelLocked) continue;
    if (!best || u.cost < best.cost) best = { ...u, label: UPGRADES[key].label };
  }
  return best;
}

// Handling profile = base stats × upgrade bonuses. This is what the car actually drives with.
export function carProfile(state, carId, withUpgrades = true) {
  const car = getCar(carId);
  const up = withUpgrades && state.cars[carId] ? state.cars[carId].upgrades : {};
  const bonus = key => 1 + upgradeBonus(key, up[key] || 0);
  const b = car.stats;
  const tires = bonus('tires');
  const nitro = bonus('nitro');
  return {
    ...DEFAULT_CAR_PROFILE,
    topKmh: b.topKmh * bonus('engine'),
    accel: b.accel * bonus('turbo'),
    lateralMin: DEFAULT_CAR_PROFILE.lateralMin * (b.lateralMax / DEFAULT_CAR_PROFILE.lateralMax) * tires,
    lateralMax: b.lateralMax * tires,
    steerResponse: b.steerResponse * tires,
    steerRelease: b.steerResponse * 1.3 * tires,
    brake: b.brake * bonus('brakes'),
    boostKmh: b.boostKmh * nitro,
    boostAccel: b.boostAccel * nitro,
    boostDrain: b.boostDrain / nitro,
    boostRegen: b.boostRegen,
    damageMult: b.damageMult * (1 - upgradeBonus('armor', up.armor || 0)),
    width: car.width,
    length: car.length,
    height: car.height,
  };
}

// 0..1 bar values for the displayed stats.
export function statBars(profile) {
  const norm = (v, r) => clamp((v - r[0]) / (r[1] - r[0]), 0, 1);
  return {
    'TOP SPEED': norm(profile.topKmh, STAT_RANGES.TOP_SPEED),
    ACCELERATION: norm(profile.accel, STAT_RANGES.ACCELERATION),
    HANDLING: norm(profile.lateralMax, STAT_RANGES.HANDLING),
    BRAKING: norm(profile.brake, STAT_RANGES.BRAKING),
    BOOST: norm(profile.boostKmh, STAT_RANGES.BOOST),
    DURABILITY: norm(1 / profile.damageMult, STAT_RANGES.DURABILITY),
  };
}

// ---------------------------------------------------------------- cosmetics

export function cosmeticInfo(state, slot, id) {
  const item = COSMETICS[slot] && COSMETICS[slot].find(o => o.id === id);
  if (!item) return null;
  const key = `${slot}:${id}`;
  const price = COSMETIC_PRICES[key] || 0;
  const levelRequired = item.level || 1;
  return {
    item, key, price, levelRequired,
    owned: price === 0 || state.cosmetics.includes(key),
    levelLocked: state.level < levelRequired,
    affordable: state.credits >= price,
  };
}

export function buyCosmetic(state, slot, id) {
  const c = cosmeticInfo(state, slot, id);
  if (!c) return fail('unknown_item', 'Unknown item.');
  if (c.owned) return fail('already_owned', 'You already own this item.');
  if (c.levelLocked) return fail('level_required', `Requires driver level ${c.levelRequired}.`);
  if (state.credits < c.price) return fail('insufficient_credits', 'Not enough credits.');
  state.credits -= c.price;
  state.cosmetics.push(c.key);
  return ok({ price: c.price });
}

export function setCosmetic(state, carId, slot, id) {
  if (!state.ownedCars.includes(carId)) return fail('not_owned', 'You do not own this car.');
  const c = cosmeticInfo(state, slot, id);
  if (!c) return fail('unknown_item', 'Unknown item.');
  if (!c.owned) return fail('not_owned_item', 'Buy this item first.');
  state.cars[carId].custom[slot] = id;
  return ok();
}

// ---------------------------------------------------------------- missions & daily

// Missions are rolled from the profile's own seed, so the client and the server generate the
// very same missions for the same profile without talking to each other.
export function ensureMissions(state) {
  const m = state.missions;
  m.active = m.active.filter(x => x && OBJECTIVES[x.type]);
  while (m.active.length < MISSION_REWARDS.ACTIVE) {
    const used = new Set(m.active.map(x => x.type));
    const options = MISSION_TEMPLATES.filter(t => !used.has(t.type) && (t.minLevel || 1) <= state.level);
    m.seq++;
    const rng = createRng(hashString(`${m.seed}:mission:${m.seq}`));
    const t = options[Math.floor(rng.next() * options.length)];
    m.active.push({
      id: m.seq,
      type: t.type,
      target: t.target(state.level),
      progress: 0,
      credits: MISSION_REWARDS.CREDITS(state.level),
      xp: MISSION_REWARDS.XP(state.level),
    });
  }
  return m.active;
}

export function missionValue(m, run) {
  const obj = OBJECTIVES[m.type];
  const v = run ? obj.stat(run) : 0;
  return obj.single ? Math.max(m.progress, v) : m.progress + v;
}

export const objectiveText = (type, target) => OBJECTIVES[type].text(target);

// Deterministic daily challenge for a date (YYYY-MM-DD): the same for every player that day.
const dailyCache = new Map();
export function dailyChallenge(key) {
  let challenge = dailyCache.get(key);
  if (challenge) return challenge;
  const rng = createRng(hashString(`nightvector-daily-${key}`));
  const pool = DAILY_GOALS.slice();
  const goals = [];
  while (goals.length < 3 && pool.length) {
    const def = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    const target = def.values ? rng.pick(def.values) : rng.int(def.range[0], def.range[1]);
    goals.push({ type: def.type, target, text: objectiveText(def.type, target) });
  }
  challenge = { key, goals };
  if (dailyCache.size > 8) dailyCache.clear();
  dailyCache.set(key, challenge);
  return challenge;
}

export function syncDaily(state, key) {
  const d = state.daily;
  if (d.date !== key) {
    d.date = key;
    d.progress = {};
    d.claimed = false;
  }
  return dailyChallenge(key);
}

export function dailyValue(state, goal, run) {
  const obj = OBJECTIVES[goal.type];
  const stored = state.daily.progress[goal.type] || 0;
  const v = run ? obj.stat(run) : 0;
  return obj.single ? Math.max(stored, v) : stored + v;
}

export const dailyReward = level => ({ credits: DAILY_REWARDS.CREDITS(level), xp: DAILY_REWARDS.XP(level) });

// ---------------------------------------------------------------- achievements

export const achievementReward = id => ACHIEVEMENT_REWARDS[id] || 0;

export function achievementContext(state, run) {
  const st = state.stats;
  const r = state.records;
  const x = run || null;
  const add = k => st[k] + (x ? x[k] || 0 : 0);
  let maxed = 0;
  for (const id of state.ownedCars) {
    const up = state.cars[id] ? state.cars[id].upgrades : {};
    const ceiling = upgradeCeiling(id);
    for (const k of UPGRADE_KEYS) if ((up[k] || 0) >= ceiling) maxed = 1;
  }
  return {
    life: {
      races: st.races,
      nearMisses: add('nearMisses'),
      insaneMisses: add('insaneMisses'),
      distance: add('distance'),
      boostTime: add('boostTime'),
      policeEscapes: add('policeEscapes'),
      perfectOvertakes: add('perfectOvertakes'),
      chicanes: add('chicanes'),
      legendPasses: add('legendPasses'),
      creditsEarned: st.creditsEarned,
      dailiesCompleted: st.dailiesCompleted,
    },
    best: {
      topSpeed: Math.max(r.topSpeed, x ? x.topSpeed : 0),
      distance: Math.max(r.distance, x ? x.distance : 0),
      cleanDistance: Math.max(r.cleanDistance, x ? x.bestCleanDistance : 0),
      combo: Math.max(r.combo, x ? x.bestMultiplier : 1),
    },
    maxedUpgrades: maxed,
    standardCars: CARS.filter(c => !carRules(c.id).legendary && state.ownedCars.includes(c.id)).length,
    phantom: state.ownedCars.includes('phantom') ? 1 : 0,
  };
}

export function achievementList(state) {
  const ctx = achievementContext(state, null);
  return ACHIEVEMENTS.map(a => ({
    ...a,
    reward: achievementReward(a.id),
    unlocked: Boolean(state.achievements[a.id]),
    progress: Math.min(1, a.value(ctx) / a.target),
  }));
}

// ---------------------------------------------------------------- run settlement

// The secret car's condition: escape the police while holding a x10 combo.
export const phantomFeat = run => run.bestMultiplier >= 10 && run.policeEscapes > 0;

// Credits and XP a run earns on its own (missions/achievements/daily add theirs later),
// after the per-run caps for the player's level.
export function runRewards(run, level) {
  const c = RUN_CREDITS;
  const km = run.distance / 1000;
  const tier = Math.max(0, COMBO.TIERS.findIndex(t => t.mult === run.bestMultiplier));
  const lines = [
    ['Distance', km * c.PER_KM],
    ['Score', (run.score / 1000) * c.PER_1000_SCORE],
    ['Overtakes', run.overtakes * c.OVERTAKE + run.perfectOvertakes * c.PERFECT_OVERTAKE],
    ['Near misses', run.nearMisses * c.NEAR_MISS + run.insaneMisses * c.INSANE_BONUS],
    [`Best combo x${run.bestMultiplier}`, c.COMBO_TIER[tier] || 0],
    ['Chicanes', run.chicanes * c.CHICANE],
    ['Police escapes', run.policeEscapes * c.POLICE_ESCAPE],
    ['Bonuses', run.legendPasses * c.LEGEND_PASS + (run.creditChips || 0) * c.CREDIT_CHIP],
  ];
  const rawCredits = lines.reduce((sum, [, v]) => sum + v, 0);
  const x = RUN_XP;
  const rawXp = x.RACE + km * x.PER_KM + (run.score / 1000) * x.PER_1000_SCORE + run.nearMisses * x.NEAR_MISS
    + run.perfectOvertakes * x.PERFECT_OVERTAKE + run.chicanes * x.CHICANE + run.policeEscapes * x.POLICE_ESCAPE + (x.COMBO_TIER[tier] || 0);
  const cap = (raw, soft) => (raw <= soft ? raw : Math.min(soft * RUN_CAPS.HARD, soft + (raw - soft) * RUN_CAPS.OVER_RATE));
  const credits = cap(rawCredits, RUN_CAPS.CREDITS_SOFT(level));
  const xp = cap(rawXp, RUN_CAPS.XP_SOFT(level));
  const scale = rawCredits > 0 ? credits / rawCredits : 0;
  return {
    credits: lines.map(([label, v]) => [label, Math.round(v * scale)]).filter(([, v]) => v > 0),
    xp: Math.round(xp),
    capped: credits < rawCredits || xp < rawXp,
  };
}

// Updates personal records; returns the keys that were beaten this run.
export function updateRecords(state, run) {
  const r = state.records;
  const beaten = [];
  const check = (key, value) => {
    if (value > r[key]) {
      if (r[key] > 0 || key === 'score') beaten.push(key);
      r[key] = value;
    }
  };
  check('score', Math.floor(run.score));
  check('distance', run.distance);
  check('topSpeed', Math.round(run.topSpeed));
  check('combo', run.bestMultiplier);
  check('nearMisses', run.nearMisses);
  check('overtakes', run.overtakes);
  check('chase', run.longestChase || 0);
  check('cleanDistance', run.bestCleanDistance);
  return beaten;
}

function addLifetimeStats(state, run) {
  const st = state.stats;
  st.races++;
  st.distance += run.distance;
  st.playTime += run.durationMs / 1000;
  for (const k of ['overtakes', 'nearMisses', 'insaneMisses', 'perfectOvertakes', 'crashes', 'boostTime', 'policeEscapes', 'pickups', 'chicanes', 'legendPasses']) {
    st[k] += run[k] || 0;
  }
  st.carDistance[run.carId] = (st.carDistance[run.carId] || 0) + run.distance;
}

// Cars whose requirements are all met but that aren't owned yet.
const availableCars = state => CARS.filter(c => !state.ownedCars.includes(c.id) && carStatus(state, c.id).unlocked).map(c => c.id);

// Applies one finished run to the progression document and returns the result summary.
// ctx: { dateKey } — the daily challenge day the run counts toward.
export function settleRun(state, run, ctx) {
  const events = [];
  const credits = [];
  let xp = 0;
  const availableBefore = new Set(availableCars(state));
  const levelBefore = levelInfo(state.xp);
  const startLevel = state.level;

  if (phantomFeat(run)) state.feats.phantom = true;
  const beaten = updateRecords(state, run);
  addLifetimeStats(state, run);

  const own = runRewards(run, startLevel);
  for (const line of own.credits) credits.push(line);
  xp += own.xp;
  if (beaten.includes('score') && state.stats.races > 1) credits.push(['New best score', RUN_CREDITS.NEW_BEST_SCORE]);

  // Missions: rewards fixed when the mission was rolled.
  let missionCredits = 0;
  const remaining = [];
  for (const m of state.missions.active) {
    const done = missionValue(m, run) >= m.target;
    if (!OBJECTIVES[m.type].single) m.progress = Math.min(m.target, m.progress + OBJECTIVES[m.type].stat(run));
    if (done) {
      missionCredits += m.credits;
      xp += m.xp;
      state.stats.missionsCompleted++;
      events.push(['mission', `MISSION COMPLETE · ${objectiveText(m.type, m.target)}`]);
    } else {
      remaining.push(m);
    }
  }
  state.missions.active = remaining;
  if (missionCredits) credits.push(['Missions', missionCredits]);

  // Daily challenge
  const daily = syncDaily(state, ctx.dateKey);
  for (const g of daily.goals) state.daily.progress[g.type] = dailyValue(state, g, run);
  if (!state.daily.claimed && daily.goals.every(g => (state.daily.progress[g.type] || 0) >= g.target)) {
    const reward = dailyReward(startLevel);
    state.daily.claimed = true;
    state.stats.dailiesCompleted++;
    credits.push(['Daily challenge', reward.credits]);
    xp += reward.xp;
    events.push(['unlock', 'DAILY CHALLENGE COMPLETE']);
  }

  // Achievements (each pays once)
  let achCredits = 0;
  const actx = achievementContext(state, null);
  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.id] || a.value(actx) < a.target) continue;
    state.achievements[a.id] = ctx.now || 1;
    const reward = achievementReward(a.id);
    achCredits += reward;
    xp += Math.round(reward / 2);
    events.push(['achievement', `ACHIEVEMENT · ${a.name}`]);
  }
  if (achCredits) credits.push(['Achievements', achCredits]);

  const creditsTotal = credits.reduce((sum, [, v]) => sum + v, 0);
  state.credits += creditsTotal;
  state.stats.creditsEarned += creditsTotal;
  state.xp += xp;
  const levelAfter = levelInfo(state.xp);
  state.level = levelAfter.level;
  const levelsGained = [];
  for (let l = levelBefore.level + 1; l <= levelAfter.level; l++) levelsGained.push(l);
  if (levelsGained.length) events.unshift(['unlock', `LEVEL ${levelAfter.level} · ${levelAfter.title}`]);
  ensureMissions(state);

  // "New unlock available": requirements met for the first time (announced once per car).
  const newlyAvailable = [];
  for (const id of availableCars(state)) {
    if (availableBefore.has(id) || state.seenUnlocks.includes(id)) continue;
    state.seenUnlocks.push(id);
    newlyAvailable.push(id);
    events.unshift(['unlock', `NEW CAR AVAILABLE · ${getCar(id).name}`]);
  }

  return { credits, creditsTotal, xp, capped: own.capped, levelBefore, levelAfter, levelsGained, beaten, events, newlyAvailable };
}

// In-race checks (client only): newly completed goals, each reported once per run.
export function liveCompletions(state, run, dateKey, notified) {
  const out = [];
  for (const m of state.missions.active) {
    const key = `m${m.id}`;
    if (!notified.has(key) && missionValue(m, run) >= m.target) {
      notified.add(key);
      out.push(['mission', 'Mission complete', objectiveText(m.type, m.target)]);
    }
  }
  const daily = syncDaily(state, dateKey);
  if (!state.daily.claimed && !notified.has('daily') && daily.goals.every(g => dailyValue(state, g, run) >= g.target)) {
    notified.add('daily');
    out.push(['unlock', 'Daily challenge complete', 'Reward at the finish']);
  }
  const ctx = achievementContext(state, run);
  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.id] || notified.has(a.id)) continue;
    if (a.value(ctx) >= a.target) {
      notified.add(a.id);
      out.push(['achievement', 'Achievement unlocked', a.name]);
    }
  }
  return out;
}

// "11 / 15", "2.4 km / 10.0 km", "Done" — progress text for a requirement or goal line.
export function progressText(r) {
  if (r.kind === 'achievement' || r.kind === 'flag') return r.met ? 'Done' : 'Not yet';
  const km = r.key === 'distance' || r.key === 'cleanDistance';
  const f = v => (km ? `${(v / 1000).toFixed(1)} km` : fmt(v));
  return `${f(Math.min(r.value, r.target))} / ${f(r.target)}`;
}

// ---------------------------------------------------------------- next goal

// The single most useful goal to show after a race: the next car (with its progress), else the
// closest mission. Returns { kind, title, lines: [{ text, value, target }] }.
export function nextGoal(state) {
  let bestCar = null;
  for (const c of CARS) {
    const s = carStatus(state, c.id);
    if (s.owned || s.hidden) continue;
    const reqs = s.requirements.filter(r => !r.secret);
    const parts = reqs.map(r => Math.min(1, r.value / r.target)).concat(Math.min(1, state.credits / Math.max(1, s.price)));
    const ratio = parts.reduce((a, b) => a + b, 0) / parts.length;
    // Prefer the lowest tier still missing; within a tier, the closest one.
    if (!bestCar || s.tier < bestCar.s.tier || (s.tier === bestCar.s.tier && ratio > bestCar.ratio)) bestCar = { s, ratio };
  }
  if (bestCar) {
    const s = bestCar.s;
    const lines = s.requirements.filter(r => !r.secret).map(r => ({ text: r.text, value: r.value, target: r.target, met: r.met, kind: r.kind, key: r.key }));
    lines.push({ text: 'Credits', value: state.credits, target: s.price, met: state.credits >= s.price, kind: 'credits' });
    return { kind: 'car', carId: s.id, title: `${s.tierName} · ${s.car.name}`, state: s.state, lines };
  }
  let best = null;
  for (const m of state.missions.active) {
    const r = Math.min(1, missionValue(m, null) / m.target);
    if (!best || r > best.r) best = { m, r };
  }
  if (!best) return null;
  return { kind: 'mission', title: 'Next mission', lines: [{ text: objectiveText(best.m.type, best.m.target), value: missionValue(best.m, null), target: best.m.target, met: false, kind: 'mission' }] };
}

// ---------------------------------------------------------------- validation

const num = (v, min, max, fallback = min) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback);
const int = (v, min, max, fallback = min) => Math.floor(num(v, min, max, fallback));
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const DATE_RE = /^[0-9A-Za-z-]{1,16}$/;
const MAX_XP = totalXpForLevel(XP_CURVE.MAX_LEVEL) + 1e6;

// Any input (an old local save, hand-edited storage, a guest import sent to the server)
// becomes a complete, internally consistent progression document: known ids only, numbers in
// range, upgrades within each car's ceiling, level derived from XP, selected car owned.
// It does NOT decide whether the progress was earned — the server applies extra limits to
// imports (see GUEST_IMPORT) and only trusts its own settled runs after that.
export function normalizeProgress(raw, seed = '') {
  const d = defaultProgress(seed);
  if (!isObj(raw)) return d;
  d.credits = int(raw.credits, 0, 1e9);
  d.xp = int(raw.xp, 0, MAX_XP);
  d.level = levelInfo(d.xp).level;

  const owned = Array.isArray(raw.ownedCars) ? raw.ownedCars.filter(isCarId) : [];
  d.ownedCars = [...new Set([STARTER, ...owned])];
  const cosmetics = Array.isArray(raw.cosmetics) ? raw.cosmetics : [];
  d.cosmetics = [...new Set(cosmetics.filter(k => typeof k === 'string' && k in COSMETIC_PRICES))];
  d.cars = {};
  for (const id of d.ownedCars) {
    const src = isObj(raw.cars) && isObj(raw.cars[id]) ? raw.cars[id] : {};
    const car = newCarState(id);
    const ceiling = upgradeCeiling(id);
    for (const k of UPGRADE_KEYS) car.upgrades[k] = int(isObj(src.upgrades) ? src.upgrades[k] : 0, 0, ceiling);
    if (isObj(src.custom)) {
      for (const slot of Object.keys(car.custom)) {
        const c = cosmeticInfo(d, slot, src.custom[slot]);
        if (c && c.owned) car.custom[slot] = src.custom[slot];
      }
    }
    d.cars[id] = car;
  }
  d.selectedCar = d.ownedCars.includes(raw.selectedCar) ? raw.selectedCar : STARTER;

  if (isObj(raw.achievements)) {
    for (const a of ACHIEVEMENTS) if (raw.achievements[a.id]) d.achievements[a.id] = int(raw.achievements[a.id], 1, 8.64e15, 1);
  }
  if (isObj(raw.feats) && raw.feats.phantom === true) d.feats.phantom = true;
  d.seenUnlocks = Array.isArray(raw.seenUnlocks) ? [...new Set(raw.seenUnlocks.filter(isCarId))] : [];

  const m = isObj(raw.missions) ? raw.missions : {};
  d.missions.seed = typeof m.seed === 'string' && m.seed.length <= 64 ? m.seed : seed;
  d.missions.seq = int(m.seq, 0, 1e9);
  d.missions.active = (Array.isArray(m.active) ? m.active : []).filter(x => isObj(x) && OBJECTIVES[x.type]).slice(0, MISSION_REWARDS.ACTIVE).map(x => ({
    id: int(x.id, 0, 1e9),
    type: x.type,
    target: num(x.target, 1, 1e9, 1),
    progress: num(x.progress, 0, 1e9),
    credits: int(x.credits, 0, MISSION_REWARDS.CREDITS(XP_CURVE.MAX_LEVEL)),
    xp: int(x.xp, 0, MISSION_REWARDS.XP(XP_CURVE.MAX_LEVEL)),
  }));

  const daily = isObj(raw.daily) ? raw.daily : {};
  d.daily.date = typeof daily.date === 'string' && DATE_RE.test(daily.date) ? daily.date : '';
  d.daily.claimed = daily.claimed === true;
  if (isObj(daily.progress)) for (const k of Object.keys(OBJECTIVES)) if (k in daily.progress) d.daily.progress[k] = num(daily.progress[k], 0, 1e9);

  const records = isObj(raw.records) ? raw.records : {};
  for (const k of Object.keys(d.records)) d.records[k] = num(records[k], k === 'combo' ? 1 : 0, 1e10, d.records[k]);
  const stats = isObj(raw.stats) ? raw.stats : {};
  for (const k of Object.keys(d.stats)) if (k !== 'carDistance') d.stats[k] = num(stats[k], 0, 1e12);
  if (isObj(stats.carDistance)) for (const id of Object.keys(stats.carDistance)) if (isCarId(id)) d.stats.carDistance[id] = num(stats.carDistance[id], 0, 1e12);
  return d;
}
