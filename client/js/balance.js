// Gameplay balance. Every value that shapes difficulty, scoring, rewards or progression lives
// here so tuning never requires hunting through systems code. Rendering / physics-engine
// constants stay in config.js.

// ---------------------------------------------------------------- difficulty & traffic density

// Run difficulty (0..1) follows racing time, not distance, so slow driving can't park the game
// in the warm-up. [seconds, difficulty] points, linearly interpolated:
//   0–30 s warm-up · 30–60 s moderate · 1–2 min challenging · 2–4 min intense · 4+ min expert.
// Past the end it stays at 1 — pressure then comes from events, weather and police, not density.
export const DIFFICULTY = {
  TIMELINE: [[0, 0], [30, 0.08], [60, 0.3], [120, 0.55], [240, 0.85], [360, 1]],
  // [start, end] pairs below are interpolated by difficulty.
  SPAWN_GAP: [115, 52], // meters of player travel between traffic waves
  MAX_PER_WAVE: [1.35, 2.7],
  LANE_CHANGE: [0.05, 0.6], // spontaneous lane-change rate multiplier
  TRAFFIC_SPEED: [1, 1.2],
  SAFE_TIME: [0.65, 0.46], // seconds of closing speed that must stay free of full-width walls (touch reaction margin)
  ROAD_CURVE: [0.018, 0.042],
  PLAYER_SPEED_BONUS: 0.1, // player top speed grows up to +10% with difficulty
  PATTERN_MIN: 0.3,
  PATTERN_CHANCE: 0.22,
};

export const VEHICLE_TYPES = {
  sedan: {
    width: 1.8, length: 4.6, height: 1.45, ppm: 110,
    speedKmh: [95, 130], weight: [1, 0.8],
    colors: ['#2b3a67', '#5b2a86', '#1f5f5b', '#6b6f7a', '#8a1c3b'],
    personalities: { normal: 1, slow: 0.5, fast: 0.2, aggressive: 0.15, erratic: 0.15 },
  },
  sports: {
    width: 1.9, length: 4.4, height: 1.2, ppm: 110,
    speedKmh: [135, 170], weight: [0.2, 0.55],
    colors: ['#d4145a', '#ffb000', '#1c9bd8', '#e8e8f0'],
    personalities: { normal: 0.4, fast: 1, aggressive: 0.7, erratic: 0.25 },
  },
  suv: {
    width: 2.0, length: 4.9, height: 1.85, ppm: 100,
    speedKmh: [90, 120], weight: [0.6, 0.6],
    colors: ['#1e2233', '#4a4e69', '#2d4a3e', '#6e2a2a'],
    personalities: { normal: 1, slow: 0.6, aggressive: 0.2, erratic: 0.1 },
  },
  truck: {
    width: 2.5, length: 11, height: 3.6, ppm: 70,
    speedKmh: [72, 92], weight: [0.25, 0.35],
    colors: ['#3a3f58', '#56607a', '#5a2e3c'],
    personalities: { truck: 1 },
  },
  legend: { // rare golden hypercar — never picked by weight, only by the rare roll
    width: 2.0, length: 4.5, height: 1.1, ppm: 110,
    speedKmh: [225, 250], weight: [0, 0],
    colors: ['#d9a520'],
    personalities: { fast: 1 },
  },
};

// Traffic driver behaviour. laneChange scales the spontaneous lane-change rate; blink is the
// turn-signal time before any lane change (never below TRAFFIC.MIN_BLINK_TIME).
export const PERSONALITIES = {
  normal: { speedMult: 1, laneChange: 0.5, blink: 1.05, follow: 20, weight: [1, 0.7] },
  slow: { speedMult: 0.7, laneChange: 0, blink: 1.2, follow: 24, weight: [0.5, 0.35] },
  fast: { speedMult: 1.22, laneChange: 0.7, blink: 0.95, follow: 16, weight: [0.25, 0.45] },
  aggressive: { speedMult: 1.14, laneChange: 1.6, blink: 0.85, follow: 10, weight: [0.05, 0.4] },
  erratic: { speedMult: 1, laneChange: 2.4, blink: 0.8, follow: 18, brakeTaps: true, weight: [0, 0.3] },
  truck: { speedMult: 1, laneChange: 0, blink: 1.2, follow: 26, weight: [1, 1] },
};

export const RARE_TRAFFIC = {
  CHANCE: 0.012, // per wave
  MIN_DIFFICULTY: 0.12,
  PASS_POINTS: 1000,
};

// ---------------------------------------------------------------- player handling

// Baseline car used by the attract mode and before a garage car is applied.
export const DEFAULT_CAR_PROFILE = {
  topKmh: 250,
  accel: 22,
  brake: 36,
  lateralMin: 4.4,
  lateralMax: 11,
  steerResponse: 9,
  steerRelease: 12,
  boostKmh: 85,
  boostAccel: 18,
  boostDrain: 30,
  boostRegen: 0.8,
  damageMult: 1,
  width: 1.95,
  length: 4.4,
  height: 1.2,
};

// Boost is earned by risk. Passive regen (per-car boostRegen) is only a slow safety net;
// near misses, high-speed overtakes and slipstreaming are the real sources.
export const BOOST = {
  START: 50,
  MIN_START: 8,
  HIGH_SPEED_RATIO: 0.9, // above this share of top speed, boost trickles in
  HIGH_SPEED_PER_SEC: 0.6,
  OVERTAKE: 3,
  SLIPSTREAM_PER_SEC: 6,
};

export const SLIPSTREAM = {
  MIN_GAP: 2, // meters between our nose and their tail
  MAX_GAP: 28,
  LATERAL: 1.15,
  MIN_KMH: 110,
  BUILD: 1.6, // charge per second while tucked in
  DECAY: 2.5,
  ACCEL_BONUS: 0.6,
  TOP_SPEED_BONUS: 0.05,
};

export const DAMAGE = {
  MIN: 18,
  MAX: 42,
  FULL_REL_SPEED: 32,
  SIDE_FACTOR: 0.55,
  SIDE_BOUNCE: 6,
  REAR_SPEED_KEEP: 0.72, // share of speed kept after rear-ending a car
  INSTABILITY_TIME: 0.8,
  INSTABILITY_STEER: 0.35,
};

// ---------------------------------------------------------------- scoring & combo

export const SCORE = {
  POINTS_PER_METER: 0.5,
  SPEED_BONUS_FROM_KMH: 100,
  SPEED_BONUS_DIVISOR: 200,
  OVERTAKE: 100,
  HIGH_SPEED_RATIO: 0.85, // overtakes above this share of top speed build combo
  PERFECT_OVERTAKE: 300,
  PERFECT_MIN_RATIO: 0.78,
  LINEUP_DISTANCE: 35, // a car counts as "lined up" when it's in our path within this range…
  PERFECT_WINDOW: 1.2, // …and a perfect overtake passes it within this many seconds (a late dodge)
  CHICANE: 400,
  PICKUP: 150,
  SPEED_STREAK: 300,
  SPEED_STREAK_TIME: 6,
  SPEED_STREAK_RATIO: 0.88,
  CHECKPOINT: 500,
  CHECKPOINT_DISTANCE: 1000,
};

// Graded by the closest lateral gap (meters) while alongside the car. Tightest first.
export const NEAR_MISS = [
  { label: 'INSANE', gap: 0.25, points: 500, combo: 3, boost: 25, grade: 2 },
  { label: 'VERY CLOSE', gap: 0.55, points: 250, combo: 2, boost: 16, grade: 1 },
  { label: 'NEAR MISS', gap: 0.9, points: 100, combo: 1, boost: 10, grade: 0 },
];

export const COMBO = {
  // Combo points needed to reach each multiplier tier.
  TIERS: [
    { at: 0, mult: 1 },
    { at: 5, mult: 2 },
    { at: 13, mult: 3 },
    { at: 26, mult: 5 },
    { at: 44, mult: 8 },
    { at: 70, mult: 10 },
  ],
  WINDOW: 5, // seconds without a risky action before dropping one tier
  // Plain overtakes only trickle combo in; risk (near misses, late dodges, chicanes) drives it.
  GAIN: {
    overtake: 0.5,
    boostOvertake: 0.5,
    perfect: 2,
    chicane: 3,
    speedStreak: 1,
    pickup: 1,
    checkpoint: 1,
    legend: 3,
  },
};

export const PICKUPS = {
  MAX: 6,
  INTERVAL: [420, 760],
  RETRY_DISTANCE: 40,
  BOOST_AMOUNT: 30,
  REPAIR_AMOUNT: 35,
  REPAIR_CHANCE: 0.3,
  CREDIT_CHIP_CHANCE: 0.04, // rare bonus pickup (its credits: progression/config.js)
};

// ---------------------------------------------------------------- world, weather, events, police

export const WORLD = {
  TIME_DISTANCE: 3500, // meters between time-of-day changes
  BLEND_DISTANCE: 700, // meters a transition takes
  TOUR_DISTANCE: 5000, // world tour: meters per route
  AURORA_CHANCE: 0.06, // rare night sky
  PREWARM_DISTANCE: 600, // build upcoming backdrops this far before a transition
};

export const WEATHER = {
  ROLL_DISTANCE: [1800, 3200],
  TRANSITION_TIME: 6,
  RAIN_GRIP_LOSS: 0.1,
  STORM_GRIP_LOSS: 0.05,
  SUPERCELL_CHANCE: 0.04,
};

// Telegraphed road events. `warn` is seconds of warning before the event takes effect.
export const EVENTS = {
  FIRST_AT: 1400,
  GAP: [1300, 2400], // meters between events
  MIN_DIFFICULTY_ROADWORK: 0.1,
  heavyTraffic: { weight: 1, warn: 3, duration: 22, density: 1.7, label: 'HEAVY TRAFFIC', sub: 'Traffic density rising' },
  openHighway: { weight: 1, warn: 2.5, duration: 20, density: 0.3, scoreBonus: 1.5, label: 'OPEN HIGHWAY', sub: 'Clear road — floor it! Distance points x1.5' },
  tunnel: { weight: 1.2, warn: 3, length: [500, 850], ahead: 330, label: 'TUNNEL AHEAD', sub: 'Lights out' },
  roadwork: { weight: 1, warn: 3.5, length: [150, 230], points: 200, label: 'ROADWORK AHEAD', sub: '' },
  checkpoint: { weight: 0.8, warn: 4, points: 400, label: 'POLICE CHECKPOINT', sub: '' },
  rainstorm: { weight: 0.8, warn: 3, duration: 30, label: 'RAINSTORM', sub: 'Wet road — less grip' },
};

export const POLICE = {
  MIN_DISTANCE: 2500, // not before this far into a run
  COOLDOWN: 3500, // meters between pursuits
  TRIGGER_SPEED_RATIO: 0.9,
  TRIGGER_TIER: 3, // or combo x5+
  CHANCE_PER_SEC: 0.07,
  DURATION: 30,
  START_GAP: 90,
  MAX_GAP: 120,
  SPEED_RATIO: 0.78, // police cruise at this share of the player's top speed
  CRASH_GAP_LOSS: 25,
  ESCAPE_POINTS: 2500,
  BUSTED_DAMAGE: 25,
};

// ---------------------------------------------------------------- garage

// Every stat below feeds the car's handling profile directly (progression/engine.js carProfile).
// Each car has its own playstyle and every fast car pays for it somewhere. Tier, price and
// unlock requirements are progression rules: see progression/config.js CAR_PROGRESSION.
export const CARS = [
  {
    id: 'vireo', name: 'Vireo Hatch', class: 'Starter hatchback', style: 'hatch',
    width: 1.8, length: 4.0, height: 1.4, paint: '#2fb8ff',
    role: 'Forgiving all-rounder',
    stats: { topKmh: 215, accel: 21, lateralMax: 11.5, steerResponse: 10, brake: 38, boostKmh: 75, boostAccel: 16, boostDrain: 30, boostRegen: 0.45, damageMult: 0.85 },
    blurb: 'Nimble, tough and cheap to tune. Every legend starts somewhere.',
  },
  {
    id: 'kestrel', name: 'Kestrel GT', class: 'Sports coupe', style: 'coupe',
    width: 1.9, length: 4.4, height: 1.25, paint: '#ffb000',
    role: 'Balanced — no weak spot',
    stats: { topKmh: 250, accel: 24, lateralMax: 12, steerResponse: 10.5, brake: 40, boostKmh: 85, boostAccel: 18, boostDrain: 30, boostRegen: 0.4, damageMult: 1 },
    blurb: 'Eager and predictable. Rewards clean lines through traffic.',
  },
  {
    id: 'bruiser', name: 'Bruiser V8', class: 'Muscle car', style: 'muscle',
    width: 2.0, length: 4.8, height: 1.3, paint: '#e0197d',
    role: 'Tank — shrugs off hits, turns like a boat',
    stats: { topKmh: 262, accel: 29, lateralMax: 9.5, steerResponse: 7, brake: 32, boostKmh: 105, boostAccel: 24, boostDrain: 34, boostRegen: 0.35, damageMult: 0.62 },
    blurb: 'Brutal straight-line pull and a steel skin. Turning is a suggestion.',
  },
  {
    id: 'stiletto', name: 'Stiletto R', class: 'Supercar', style: 'super',
    width: 2.0, length: 4.5, height: 1.15, paint: '#e8203a',
    role: 'Fast and precise, but fragile',
    stats: { topKmh: 295, accel: 27, lateralMax: 12.5, steerResponse: 11, brake: 44, boostKmh: 85, boostAccel: 20, boostDrain: 30, boostRegen: 0.4, damageMult: 1.25 },
    blurb: 'Sharp, fast and precise — but it bruises easily.',
  },
  {
    id: 'wisp', name: 'Wisp LT', class: 'Lightweight racer', style: 'racer',
    width: 1.85, length: 4.1, height: 1.05, paint: '#3dffa2',
    role: 'Weaver — instant grip, low top speed, paper armor',
    stats: { topKmh: 245, accel: 32, lateralMax: 14.5, steerResponse: 14, brake: 48, boostKmh: 70, boostAccel: 20, boostDrain: 26, boostRegen: 0.5, damageMult: 1.45 },
    blurb: 'Featherweight chassis, telepathic steering. One mistake and it folds.',
  },
  {
    id: 'aurora', name: 'Aurora X', class: 'Hypercar', style: 'hyper',
    width: 2.05, length: 4.6, height: 1.1, paint: '#f2f4ff',
    role: 'Extreme speed, heavy steering — experts only',
    stats: { topKmh: 335, accel: 30, lateralMax: 10, steerResponse: 7.5, brake: 40, boostKmh: 115, boostAccel: 26, boostDrain: 32, boostRegen: 0.35, damageMult: 1.15 },
    blurb: 'Absurd speed. Traffic arrives faster than you can think.',
  },
  {
    id: 'phantom', name: 'Phantom Zero', class: '???', style: 'phantom',
    width: 2.0, length: 4.6, height: 1.1, paint: '#1b1030',
    role: 'Boost fiend — endless nitro, glass body',
    stats: { topKmh: 305, accel: 28, lateralMax: 13, steerResponse: 12, brake: 42, boostKmh: 140, boostAccel: 30, boostDrain: 20, boostRegen: 0.6, damageMult: 1.35 },
    blurb: 'It was never built. It has always been here.',
  },
];

// Display ranges that map raw stats to 0..1 bars.
export const STAT_RANGES = {
  TOP_SPEED: [200, 345],
  ACCELERATION: [18, 34],
  HANDLING: [9, 15],
  BRAKING: [30, 50],
  BOOST: [60, 145],
  DURABILITY: [0.65, 1.65], // 1 / damageMult
};

// Per-level percentage bonuses (cumulative). Diminishing returns: the first levels are the
// big, noticeable jumps; maxing out helps but never makes the game trivial. How many levels a
// car can take (its tier's ceiling) and what they cost: progression/config.js.
export const UPGRADES = {
  engine: { label: 'Engine', stat: 'TOP SPEED', steps: [4, 4, 3, 3, 2] },
  turbo: { label: 'Turbo', stat: 'ACCELERATION', steps: [6, 6, 5, 4, 3] },
  tires: { label: 'Tires', stat: 'HANDLING', steps: [5, 5, 4, 3, 3] },
  brakes: { label: 'Brakes', stat: 'BRAKING', steps: [8, 7, 6, 5, 4] },
  nitro: { label: 'Nitro', stat: 'BOOST', steps: [6, 6, 5, 4, 3] },
  armor: { label: 'Armor', stat: 'DURABILITY', steps: [6, 6, 5, 4, 3] },
};
