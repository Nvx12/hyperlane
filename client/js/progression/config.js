// ProgressionConfig — every number that shapes the economy and the unlock path lives here:
// XP curve, car tiers/prices/requirements, upgrade prices and ceilings, cosmetic prices, run
// rewards (with caps), mission / daily / achievement rewards, and guest-import limits.
//
// Shared by the client (guest play, instant feedback) and the server (authority for online
// profiles), so both always apply the same rules. Physics/handling stats stay in balance.js.
//
// Tuned with tools/balance/simulate.mjs against real bot runs (tools/balance/run-samples.json).
// Change a value → re-run the simulation → check the targets in docs/progression.md.

// ---------------------------------------------------------------- driver level

// XP needed to go from level L to L+1 grows linearly (BASE + STEP·L), so the total to reach a
// level grows quadratically — steady, never exponential. Simulated: level 2 after one run, level 10
// after ~31 casual runs, level 20 after ~156 (tools/balance/simulate.mjs).
export const XP_CURVE = { BASE: 0, STEP: 350, MAX_LEVEL: 40 };

export const LEVEL_TITLES = [
  { level: 1, title: 'ROOKIE' },
  { level: 5, title: 'STREET RACER' },
  { level: 10, title: 'PRO' },
  { level: 17, title: 'ELITE' },
  { level: 26, title: 'LEGEND' },
  { level: 34, title: 'ICON' },
];

// ---------------------------------------------------------------- cars

// Tiers give each car a place on the ladder and cap how far upgrades can take it, so a
// starter never turns into a hypercar and every car keeps its identity.
export const TIERS = {
  1: { name: 'STREET', upgradeCeiling: 3 },
  2: { name: 'SPORT', upgradeCeiling: 4 },
  3: { name: 'PERFORMANCE', upgradeCeiling: 5 },
  4: { name: 'SUPERCAR', upgradeCeiling: 5 },
  5: { name: 'HYPERCAR', upgradeCeiling: 5 },
};

// Unlock = every requirement met (level + skill/progress goals). Then the car can be bought
// for `price`. Both are needed for the powerful cars, so grinding credits alone never skips
// the skill path and a single lucky run never skips the level path.
// Requirement kinds: level · record (best in one run) · stat (lifetime total) · achievement ·
// flag (a secret feat recorded in progress.feats — only the engine sets these, from run results)
export const CAR_PROGRESSION = {
  vireo: { tier: 1, price: 0, starter: true, requires: [] },
  kestrel: { tier: 2, price: 2500, requires: [{ kind: 'level', value: 3 }] },
  bruiser: {
    tier: 2, price: 7500,
    requires: [{ kind: 'level', value: 7 }, { kind: 'stat', key: 'missionsCompleted', value: 8 }],
  },
  wisp: {
    tier: 3, price: 16000,
    requires: [{ kind: 'level', value: 11 }, { kind: 'stat', key: 'perfectOvertakes', value: 120 }],
  },
  stiletto: {
    tier: 4, price: 42000,
    requires: [{ kind: 'level', value: 17 }, { kind: 'record', key: 'score', value: 150000 }, { kind: 'record', key: 'combo', value: 8 }],
  },
  aurora: {
    tier: 5, price: 85000,
    requires: [{ kind: 'level', value: 26 }, { kind: 'record', key: 'score', value: 200000 }, { kind: 'achievement', id: 'combo_king' }],
  },
  phantom: {
    tier: 5, price: 120000, legendary: true,
    requires: [{ kind: 'level', value: 30 }, { kind: 'flag', key: 'phantom', hint: 'Legends say it only appears to those who outrun the law at the very peak of a combo.' }],
  },
};

// ---------------------------------------------------------------- upgrades

// Price of upgrade step n (1-based) = STEP_PRICES[n-1] × tier multiplier, rounded to 50.
// Step n also needs driver level LEVEL_REQUIRED[n-1] ("upgrade tiers").
export const UPGRADE_PRICING = {
  STEP_PRICES: [400, 900, 1700, 3000, 4800],
  TIER_MULTIPLIER: { 1: 1, 2: 1.6, 3: 2.4, 4: 3.4, 5: 4.6 },
  LEVEL_REQUIRED: [1, 2, 5, 9, 14],
};

// ---------------------------------------------------------------- cosmetics

// Level gates live in data/cosmetics.js (what it looks like); prices live here. Items with
// no price are free for everyone. Bought once, usable on every car.
export const COSMETIC_PRICES = {
  'paint:lime': 500, 'paint:pearl': 800, 'paint:crimson': 1500, 'paint:midnight': 2500, 'paint:gold': 8000,
  'underglow:green': 500, 'underglow:amber': 1200, 'underglow:violet': 2000, 'underglow:white': 3500,
  'rim:bronze': 700, 'rim:gold': 1800, 'rim:neon': 3000,
  'headlight:amber': 700, 'headlight:violet': 2200,
  'trail:plasma': 400, 'trail:ember': 1800, 'trail:ghost': 4000,
};

// ---------------------------------------------------------------- run rewards

// Skill pays more than mileage: distance is a small share, risky driving the rest. Plain
// overtakes and holding speed (easy to farm by cruising) pay almost nothing.
export const RUN_CREDITS = {
  PER_KM: 8,
  PER_1000_SCORE: 1.2,
  OVERTAKE: 0.25,
  NEAR_MISS: 8,
  INSANE_BONUS: 10,
  PERFECT_OVERTAKE: 6,
  CHICANE: 10,
  POLICE_ESCAPE: 100,
  LEGEND_PASS: 100,
  CREDIT_CHIP: 50,
  COMBO_TIER: [0, 15, 35, 70, 120, 200], // by best combo tier reached (x1 … x10)
  NEW_BEST_SCORE: 100,
};

export const RUN_XP = {
  RACE: 30,
  PER_KM: 11,
  PER_1000_SCORE: 0.8,
  NEAR_MISS: 8,
  PERFECT_OVERTAKE: 6,
  CHICANE: 8,
  POLICE_ESCAPE: 40,
  COMBO_TIER: [0, 5, 15, 30, 60, 100], // by best combo tier reached (x1 … x10)
};

// One exceptional run can't bypass the ladder: beyond the soft cap a run's credits/XP count at
// OVER_RATE, and never beyond HARD × soft cap. Caps grow with level so later runs stay rewarding.
export const RUN_CAPS = {
  CREDITS_SOFT: level => 900 + 60 * level,
  XP_SOFT: level => 700 + 45 * level,
  OVER_RATE: 0.35,
  HARD: 2,
};

// ---------------------------------------------------------------- goals

export const MISSION_REWARDS = {
  CREDITS: level => 100 + 25 * level,
  XP: level => 60 + 15 * level,
  ACTIVE: 3,
};

export const DAILY_REWARDS = {
  CREDITS: level => 500 + 50 * level,
  XP: level => 250 + 25 * level,
};

// Credits per achievement (XP = half). Definitions (names, conditions) are in data/achievements.js.
export const ACHIEVEMENT_REWARDS = {
  first_ride: 100, speed_demon: 150, light_speed: 600, too_close: 300, insanity: 500, road_king: 800,
  marathon: 600, untouchable: 800, boost_addict: 300, clean_getaway: 250, escape_artist: 800,
  combo_king: 700, perfectionist: 400, chicane_master: 400, gearhead: 300, collector: 3000,
  high_roller: 500, globetrotter: 1000, legend_spotter: 300, ghost: 2000,
};

// ---------------------------------------------------------------- guest → online import

// Linking a guest profile to an online account imports its progress once, clamped: local data
// can't be verified, so the import can never carry more than a moderate head start.
export const GUEST_IMPORT = {
  MAX_LEVEL: 12,
  MAX_CREDITS: 20000,
  MAX_UPGRADE_STEP: 3,
};
