// Mission and daily-challenge objective templates.
// `stat(run)` reads the value from a run summary. `single: true` means it must be achieved within
// one run; otherwise progress accumulates across runs until complete. `short` is the in-race chip label.

const nice = n => {
  if (n >= 1000) return Math.round(n / 1000) * 1000;
  if (n >= 100) return Math.round(n / 10) * 10;
  if (n >= 20) return Math.round(n / 5) * 5;
  return Math.max(1, Math.round(n));
};

export const OBJECTIVES = {
  nearMisses: { short: 'NEAR MISSES', stat: r => r.nearMisses, text: n => `Perform ${n} near misses` },
  overtakes: { short: 'OVERTAKES', stat: r => r.overtakes, text: n => `Overtake ${n} cars` },
  perfect: { short: 'PERFECT', stat: r => r.perfectOvertakes, text: n => `Land ${n} perfect overtakes` },
  chicanes: { short: 'CHICANES', stat: r => r.chicanes, text: n => `Clear ${n} chicane${n > 1 ? 's' : ''}` },
  insane: { short: 'INSANE', stat: r => r.insaneMisses, text: n => `Pull off ${n} INSANE near miss${n > 1 ? 'es' : ''}` },
  boostTime: { short: 'S BOOST', stat: r => Math.floor(r.boostTime), text: n => `Use boost for ${n} seconds` },
  police: { short: 'ESCAPES', stat: r => r.policeEscapes, text: n => (n > 1 ? `Escape ${n} police pursuits` : 'Escape a police pursuit') },
  distance: { short: 'KM', stat: r => r.distance / 1000, text: n => `Drive ${n} km`, unit: 'km' },
  clean: { short: 'KM CLEAN', stat: r => r.bestCleanDistance / 1000, text: n => `Drive ${n} km without crashing`, unit: 'km', single: true },
  runDistance: { short: 'KM', stat: r => r.distance / 1000, text: n => `Drive ${n} km in one run`, unit: 'km', single: true },
  speed: { short: 'KM/H', stat: r => r.topSpeed, text: n => `Reach ${n} km/h`, single: true },
  hold: { short: 'S AT 200', stat: r => r.highSpeedTime, text: n => `Maintain 200 km/h for ${n} seconds`, single: true },
  combo: { short: 'COMBO', stat: r => r.bestMultiplier, text: n => `Reach a x${n} combo`, single: true },
  score: { short: 'SCORE', stat: r => r.score, text: n => `Score ${n.toLocaleString('en-US')} in one run`, single: true },
};

// Missions: medium-term goals. Cumulative ones take about five typical runs; single-run ones
// are a stretch (roughly one run in five). Targets come from recorded runs (tools/balance) and
// scale gently with driver level. Rewards are in progression/config.js (MISSION_REWARDS).
export const MISSION_TEMPLATES = [
  { type: 'nearMisses', target: lv => nice(18 + lv * 1.5) },
  { type: 'overtakes', target: lv => nice(350 + lv * 20) },
  { type: 'perfect', target: lv => nice(24 + lv * 1.5) },
  { type: 'distance', target: lv => nice(30 + lv * 2) },
  { type: 'chicanes', target: lv => nice(12 + lv), minLevel: 2 },
  { type: 'insane', target: lv => nice(5 + lv * 0.4), minLevel: 2 },
  { type: 'boostTime', target: lv => nice(60 + lv * 5) },
  { type: 'police', target: lv => (lv < 12 ? 2 : 3), minLevel: 3 },
  { type: 'clean', target: lv => nice(5 + lv * 0.15) },
  { type: 'runDistance', target: lv => nice(9 + lv * 0.3) },
  { type: 'speed', target: lv => Math.min(340, 250 + nice(lv * 4)) },
  { type: 'hold', target: lv => nice(60 + lv * 2) },
  { type: 'combo', target: lv => (lv < 4 ? 5 : lv < 12 ? 8 : 10) },
  { type: 'score', target: lv => nice(60000 + lv * 8000) },
];

// Daily challenge goal pool (targets rolled from the date seed).
export const DAILY_GOALS = [
  { type: 'distance', range: [8, 15] },
  { type: 'nearMisses', range: [12, 25] },
  { type: 'overtakes', range: [40, 80] },
  { type: 'perfect', range: [6, 12] },
  { type: 'combo', values: [5, 8] },
  { type: 'speed', values: [260, 280, 300] },
  { type: 'clean', range: [3, 6] },
  { type: 'boostTime', range: [30, 60] },
];

