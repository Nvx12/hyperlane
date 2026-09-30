// Engine, rendering and physics constants. Gameplay balance lives in balance.js.
// World units are meters, time is seconds, speeds are m/s unless named *_KMH.

export const ROAD = {
  LANES: 4,
  LANE_WIDTH: 3.4,
  SHOULDER: 1.2,
  RUMBLE_WIDTH: 0.45,
  EDGE_LINE_INSET: 0.22,
  WALL_HEIGHT: 0.85,
  SEGMENT_LENGTH: 5,
  DRAW_DISTANCE: 400,
  POLE_OFFSET: 1.4,
  POLE_HEIGHT: 9,
  POLE_ARM: 2.6,
  SKY_PARALLAX: 26,
  MARKER_RANGE: 45, // segments near the camera that get lane reflectors
};
ROAD.HALF_WIDTH = (ROAD.LANES * ROAD.LANE_WIDTH) / 2;
ROAD.EDGE = ROAD.HALF_WIDTH + ROAD.SHOULDER;

export const laneCenter = lane => -ROAD.HALF_WIDTH + ROAD.LANE_WIDTH * (lane + 0.5);

export const CAMERA = {
  HEIGHT: 3.0,
  PLAYER_DEPTH: 8.5, // depth of the player car's center in front of the camera
  BOTTOM_DEPTH: 4.0, // road depth that projects onto the bottom screen edge
  HORIZON: 0.42,
  NEAR_CLIP: 1.2,
  FOLLOW: 0.72,
  FOLLOW_RATE: 5,
  // Phone screens: a milder FOV widening keeps traffic silhouettes large enough to read at speed.
  SPEED_FOV: 0.9,
  BOOST_FOV: 0.86,
  FOV_FROM_KMH: 90, // calm below this…
  FOV_RANGE_KMH: 240, // …fully widened at 330 km/h
  FOV_RATE: 2.5,
  FOV_KICK_DECAY: 5,
  MAX_SHAKE: 11, // px at full trauma (then × the shake setting: Low 0.35 / Normal 0.7)
  MAX_ROLL: 0.014,
  TRAUMA_DECAY: 1.9,
  VIBRATION_FROM_KMH: 200,
  VIBRATION_PER_KMH: 1 / 180,
  BOOST_VIBRATION: 0.5,
};

// Physical/visual player constants; handling comes from the car profile (balance.js / garage).
export const PLAYER = {
  COLOR: '#e0197d',
  SPRITE_PPM: 170,
  START_KMH: 120,
  CRUISE_KMH: 150,
  CRUISE_ACCEL: 7,
  COAST_DECEL: 5,
  CENTRIFUGAL: 0.014,
  TILT_MAX: 0.07,
  MAX_HEALTH: 100,
  LOW_HEALTH: 40,
  INVULNERABLE_TIME: 1.3,
  WALL_FRICTION: 0.7,
};

export const TRAFFIC = {
  MAX_VEHICLES: 28,
  SPAWN_DEPTH: 370,
  SPAWN_JITTER: 28,
  SPAWN_CLEARANCE: 12,
  CHANGE_CLEARANCE: 9,
  FIRST_WAVE_DISTANCE: 40,
  MIN_PLAYER_SPEED: 12,
  ACCEL: 3,
  BRAKE_DECEL: 9,
  MIN_SPEED_KMH: 55,
  LANE_CHANGE_SPEED: 2.8,
  // Thumb reaction is slower and less precise than a keyboard: longer indicator warning and
  // lane changes only well ahead of the player.
  MIN_BLINK_TIME: 1.0,
  LANE_CHANGE_START_DEPTH: 85, // only start a lane change this far ahead of the player
  LANE_CHANGE_MIN_DEPTH: 60, // abort pending changes that got closer than this
  PLAYER_LANE_GUARD_DEPTH: 130, // never merge into the player's lane closer than this
  WALL_BAND: 14,
  WALL_FIX_MIN_DEPTH: 50,
  WALL_CHECK_INTERVAL: 0.25,
  PATTERN_SPACING: 26,
  PATTERN_SLOTS: 8,
  BRAKE_TAP_RATE: 0.12,
  BRAKE_TAP_TIME: 0.8,
  BRAKE_TAP_MIN_DEPTH: 45,
  DESPAWN_BEHIND: -30,
  DESPAWN_AHEAD: 60,
};

export const PICKUP_GEOMETRY = {
  SPAWN_DEPTH: 360,
  CLEAR_BEHIND: 90,
  CLEAR_AHEAD: 30,
  SIZE: 1.25,
  HOVER: 0.85,
  COLLECT_X: 1.7,
  COLLECT_Z: 2.8,
};

export const COLLISION = {
  X_FACTOR: 0.86,
  Z_FACTOR: 0.92,
};

export const GAME = {
  MENU_KMH: 170,
  COUNTDOWN: 3,
  CRASH_SLOWMO: 1.6,
  CRASH_TIMESCALE: 0.22,
  GAMEOVER_INPUT_DELAY: 0.7,
  ENGINE_TOP_KMH: 420,
};

export const BEAM = {
  LENGTH: 34,
  NEAR_WIDTH: 1.7,
  FAR_WIDTH: 9,
};

// Render resolution, graphics tiers and frame pacing live in Performance.js.
export const PERF = {
  MAX_DT: 1 / 20,
  HUD_INTERVAL: 1 / 15,
  MAX_PARTICLES: 520,
  SPEED_LINES: 64,
};

// Shared accent colors for effects and callouts (road/sky colors come from data/environments.js).
export const PALETTE = {
  PINK: '#ff2d95',
  PINK_RGB: '255, 45, 149',
  CYAN: '#22e6ff',
  CYAN_RGB: '34, 230, 255',
  AMBER: '#ffc247',
  GREEN: '#3dffa2',
  GREEN_RGB: '61, 255, 162',
  RED: '#ff3355',
  VIOLET: '#b36bff',
  GOLD: '#ffd35a',
};

