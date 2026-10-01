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

// Telegraphed road events, chosen and timed by the RunDirector. `warn` is seconds of warning
// before the event takes effect; `intensity` is how hard it hits (the director only picks events
// that fit the moment); `kind` groups them for variety.
export const EVENTS = {
  heavyTraffic: { weight: 1, warn: 3, duration: 20, density: 1.7, intensity: 70, kind: 'traffic', label: 'HEAVY TRAFFIC', sub: 'Traffic closing in' },
  truckConvoy: { weight: 1, warn: 3, intensity: 65, kind: 'traffic', label: 'TRUCK CONVOY', sub: 'Thread the gaps — squeezes pay double' },
  openHighway: { weight: 1, warn: 2.5, duration: 18, density: 0.3, scoreBonus: 1.5, intensity: 25, kind: 'relief', label: 'OPEN HIGHWAY', sub: 'Clear road — floor it! Distance points x1.5' },
  tunnel: { weight: 1.2, warn: 3, length: [500, 850], ahead: 330, intensity: 45, kind: 'world', label: 'TUNNEL AHEAD', sub: 'Lights out' },
  roadwork: { weight: 1, warn: 3.5, length: [150, 230], points: 200, intensity: 55, kind: 'obstacle', label: 'ROADWORK AHEAD', sub: '' },
  accident: { weight: 0.8, warn: 3.5, length: [60, 90], points: 300, intensity: 60, kind: 'obstacle', label: 'ACCIDENT AHEAD', sub: '' },
  rainstorm: { weight: 0.8, warn: 3, duration: 30, intensity: 60, kind: 'world', label: 'RAINSTORM', sub: 'Wet road — less grip' },
  policePatrol: { weight: 1, warn: 3, intensity: 55, kind: 'police', label: 'POLICE PATROL', sub: 'Ease off… or blast past for +500' },
  speedZone: { weight: 1, warn: 2, window: 20, hold: 7, speedRatio: 0.9, points: 1200, boost: 30, intensity: 50, kind: 'challenge', label: 'SPEED ZONE', sub: '' },
  overtakeRush: { weight: 1, warn: 2, window: 20, count: 10, points: 1200, boost: 30, intensity: 55, kind: 'challenge', label: 'OVERTAKE RUSH', sub: '' },
  nearMissBlitz: { weight: 0.8, warn: 2, window: 25, count: 4, points: 1500, boost: 40, intensity: 60, kind: 'challenge', label: 'NEAR-MISS BLITZ', sub: '' },
  rival: { weight: 0.7, warn: 3, intensity: 70, kind: 'rival', label: 'RIVAL CHALLENGE', sub: '' },
};

// ---------------------------------------------------------------- pacing (RunDirector)

// A run is a sequence of phases with a target intensity (0–100) each; the live intensity eases
// toward the target. Every cycle after the first starts from a higher floor, so the run escalates
// in waves (tension → relief → more tension) instead of a flat climb.
export const DIRECTOR = {
  PHASES: {
    warmup: { target: [22, 32], duration: [20, 28] },
    pressure: { target: [45, 58], duration: [18, 28] },
    event: { target: [60, 72], duration: [16, 26] },
    escalation: { target: [70, 82], duration: [14, 22] },
    peak: { target: [85, 96], duration: [12, 20] },
    breather: { target: [28, 40], duration: [10, 16] },
  },
  CYCLE_FLOOR_STEP: 7, // each cycle's targets rise by this much (capped at 100)
  EASE: 0.35, // intensity approach rate (per second, as a fraction of the gap)
  PRESSURE_SWING: 0.4, // traffic pressure = run difficulty ± this × (intensity − 50) / 100
  FIRST_EVENT_AT: [38, 55], // seconds: something happens early (first 90 s matter)
  EVENT_GAP: [22, 40], // seconds between director events (outside chases)
  QUIET_LIMIT: 16, // no notable moment for this long → schedule a formation or event now
  FORMATION_GAP: [6, 11], // seconds between traffic formations at mid intensity (scaled by intensity)
  // Hidden per-run pacing personality: how events, heat and weather are weighted this run.
  PERSONALITIES: {
    mixed: { weight: 3, heat: 1, events: {} },
    traffic: { weight: 2, heat: 0.9, events: { heavyTraffic: 2, truckConvoy: 2, overtakeRush: 1.5 }, formations: 1.4 },
    police: { weight: 2, heat: 1.35, events: { policePatrol: 2.5, rival: 0.6 } },
    speed: { weight: 2, heat: 1, events: { openHighway: 2.5, speedZone: 2, rival: 1.8 } },
    storm: { weight: 1, heat: 0.95, events: { rainstorm: 3, tunnel: 1.5, accident: 1.5 } },
  },
};

// Traffic formations the director asks for (designed situations instead of pure random waves).
export const FORMATIONS = {
  MIN_INTENSITY: { gate: 25, stagger: 35, truckWall: 50, pack: 30, movingGap: 45, riskPickup: 30 },
  WEIGHTS: { gate: 1.2, stagger: 1, truckWall: 0.8, pack: 1, movingGap: 0.8, riskPickup: 0.7 },
  SPACING: 26, // meters between rows inside a formation
};

// ---------------------------------------------------------------- heat & police

// Heat is earned by risky driving and shown as 0–5 stars (100 points each). From ★2 real
// police cars come for you; the chase lasts until you escape (fill the escape meter) or are
// busted. Higher heat = harder police AND bigger rewards.
export const HEAT = {
  PER_STAR: 100,
  MAX: 560, // headroom above 5★ (500) so the top level holds through brief decay
  CHASE_AT: 200, // ★2: police dispatched
  SPEED_PER_SEC: 2.2, // while at ≥ 88% of top speed
  SPEED_RATIO: 0.88,
  BOOST_PER_SEC: 4,
  COMBO_PER_TIER_SEC: 0.7, // per combo tier above x2
  NEAR_MISS: [7, 12, 20], // by grade
  PERFECT: 6,
  CHICANE: 10,
  POLICE_NEAR_MISS: 25,
  SPOTTED: 110, // blasting past a patrol
  POLICE_HIT: 30,
  ROADBLOCK_CRASH: 40,
  DECAY_CALM: 12, // per second when driving calmly (below 75% top speed, no risky action for 4 s)
  DECAY: 1.2, // per second otherwise (outside chases)
  CALM_RATIO: 0.75,
  WARMUP_GAIN: 0.5, // heat builds slower in the first 25 s
  WARMUP_SECONDS: 25,
  ESCAPE_KEEP: 0.35, // share of heat kept after escaping (the police remember you)
  SCORE_BONUS_PER_STAR: 0.1, // +10% points per heat star (heat is opportunity, not only danger)
};

export const POLICE = {
  // Speed of police units as a share of the player's current top speed (no boost), by heat star.
  SPEED_RATIO: [0, 0.94, 0.97, 1.0, 1.04, 1.08],
  UNITS: [0, 0, 1, 2, 2, 3], // units in pursuit by star
  SPAWN_DZ: -36, // meters behind the player where units appear (off screen)
  CATCH_UP: 10, // m/s faster than the player while closing in from far behind
  WARN_SECONDS: 3.5, // siren + rear-view warning before the first unit reaches the player
  REDISPATCH: 6, // seconds before a lost unit is replaced (if the chase goes on)
  LOST_DZ: -55, // a unit this far behind has lost sight of you
  VIEW_AHEAD: 90, // a unit ahead within this range still sees you
  ENGAGE_DZ: -4.5, // a unit closer than this behind you (or ahead) is on screen: the chase is on
  HIDDEN_DZ: -12, // an unseen pursuer farther back than this ignores traffic (it is off screen)
  ENGAGE_GRACE: 20, // s: the escape meter can't fill before a unit was on screen (unless this long)
  PRESSURE_DZ: 12, // a unit this close (either side) is on you
  INTERCEPT_FROM_STAR: 3,
  INTERCEPT_DZ: 28, // interceptors hold this far ahead…
  BRAKE_CHECK_TIME: 1.2, // …and brake-check (after a warning) for this long
  BRAKE_CHECK_WARN: 0.8,
  RAM_FROM_STAR: 4,
  RAM_WARN: 0.9,
  RAM_COOLDOWN: 8,
  ESCAPE_RATE: [0.06, 0.11], // per second while unseen, from slow to top speed
  ESCAPE_FROM_DZ: 20, // pursuers farther behind than this let the meter fill (partially)
  ESCAPE_BASE: 0.012, // per second otherwise, as long as nobody is on you (chases always end)
  ESCAPE_DRAIN: 0.05, // per second while a unit is close
  ESCAPE_CRASH: 0.2,
  ESCAPE_PASS: 0.12, // overtaking a police unit
  ESCAPE_ROADBLOCK: 0.2,
  BUST_RATE: 0.4, // per second while boxed in (unit close and you are slow)
  BUST_SLOW_KMH: 110,
  BUST_HIT: 0.3,
  BUST_DECAY: 0.25,
  BUSTED_DAMAGE: 25,
  ESCAPE_POINTS: [0, 400, 900, 1800, 3000, 4500], // by heat star escaped
  PASS_POINTS: 250,
  PATROL_SPEED_KMH: 140,
  PATROL_BLAST_KMH: 190, // passing a patrol faster than this = spotted
  PATROL_POINTS: 500,
};

export const ROADBLOCK = {
  FROM_STAR: 4,
  COOLDOWN: 20, // seconds between roadblocks
  SPIKES_FROM_STAR: 5,
  SPIKE_TIME: 3, // seconds of reduced grip and speed after hitting a spike strip
  SPIKE_GRIP: 0.6,
  SPIKE_SPEED: 0.8,
  POINTS: 600,
};

// ---------------------------------------------------------------- rival racer

export const RIVAL = {
  DURATION: 30, // seconds: be ahead when the clock runs out
  SPEED_RATIO: 1.0, // of the player's top speed (no boost)…
  BOOST_KMH: 45, // …plus short boost bursts, like the player
  BOOST_TIME: 2.2,
  BOOST_COOLDOWN: [6, 10],
  POINTS: 2500,
  NAMES: ['VEX', 'NOVA', 'RAZOR', 'KITE', 'ONYX', 'JINX'],
};

// ---------------------------------------------------------------- skill moves

export const SKILL = {
  PERFECT_DODGE_WINDOW: 0.45, // the car was dead ahead this recently when you slipped past it
  PERFECT_DODGE_POINTS: 400,
  PERFECT_DODGE_BOOST: 18,
  SLINGSHOT_CHARGE: 0.75, // slipstream charge needed
  SLINGSHOT_KMH: 30, // extra speed for the pull-out
  SLINGSHOT_TIME: 1.6,
  SLINGSHOT_POINTS: 250,
  TRUCK_NEAR_MISS_MULT: 1.5,
  CLOSE_CALL_SCALE: 0.3, // time scale of the rare cinematic close call…
  CLOSE_CALL_TIME: 0.12, // …for this long (real seconds)
  CLOSE_CALL_COOLDOWN: 25,
  CLOSE_CALL_MIN_KMH: 230,
};

// Combo milestones: a few meaningful steps, not a new mechanic per multiplier.
export const COMBO_MILESTONES = {
  BOOST_GAIN_FROM: 3, // x3+: +25% boost from risky moves
  BOOST_GAIN: 1.25,
  FLOW_AT: 10, // x10: FLOW — ends on a collision or when the combo drops below FLOW_KEEP
  FLOW_KEEP: 8,
  FLOW_BOOST_GAIN: 1.5,
  FLOW_SCORE: 1.25,
};

// Collisions are graded: a light scrape isn't a combo-killer; a head-on hit is.
export const CONTACT = {
  SCRAPE_MAX_PEN: 0.35, // side contact with less overlap than this (fraction) = light scrape
  SCRAPE_DAMAGE: 5,
  SCRAPE_SPEED_KEEP: 0.94,
  SCRAPE_COMBO_TIERS: 1, // tiers lost
  SIDE_COMBO_TIERS: 2,
  CONE_SPEED_KEEP: 0.88, // roadwork cones: knocked flying, small penalty
  CONE_DAMAGE: 3,
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
