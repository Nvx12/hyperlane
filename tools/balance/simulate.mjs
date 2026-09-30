// Dev-only progression simulation. Replays real bot runs (tools/balance/run-samples.json, from
// sample-runs.mjs) through the actual progression engine — the same code the game and the
// server use — for many simulated players of each type, from a brand-new profile.
//
//   node tools/balance/simulate.mjs            → milestone table (median, p10–p90)
//   PLAYERS=50 node tools/balance/simulate.mjs  (faster)
//   node tools/balance/simulate.mjs --json      (machine-readable, used by the unit test)
//
// Player policy (deliberately simple and reasonable, not optimal):
//   - always drives the highest-tier car it owns
//   - when a car's requirements are met, saves for it and buys it as soon as affordable
//   - otherwise buys the cheapest available upgrade for the car it drives
//   - plays SESSION runs per day (the daily challenge rolls over between days)
import { readFileSync } from 'node:fs';
import { CARS } from '../../client/js/balance.js';
import {
  defaultProgress, ensureMissions, settleRun, carStatus, purchaseCar, selectCar, nextUpgrade,
  buyUpgrade, carRules, upgradeCeiling, UPGRADE_KEYS,
} from '../../client/js/progression/engine.js';
import { createRng } from '../../client/js/Rng.js';

const { samples } = JSON.parse(readFileSync(new URL('./run-samples.json', import.meta.url), 'utf8'));
const PLAYERS = Number(process.env.PLAYERS || 200);
const MAX_RUNS = 3000;
const MENU_SECONDS = 25; // results screen, garage, restart — per run
export const PLAYER_TYPES = {
  casual: { runsPerDay: 10 },
  skilled: { runsPerDay: 16 },
  expert: { runsPerDay: 24 },
};

const MILESTONES = [
  ['firstUpgrade', 'First upgrade'],
  ['level5', 'Level 5'],
  ['kestrel', 'First new car (Kestrel GT, Sport)'],
  ['level10', 'Level 10'],
  ['bruiser', '2nd sport car (Bruiser V8)'],
  ['wisp', 'Performance car (Wisp LT)'],
  ['stiletto', 'Supercar (Stiletto R)'],
  ['level20', 'Level 20'],
  ['aurora', 'Hypercar (Aurora X)'],
  ['level30', 'Level 30'],
  ['phantom', 'Legendary (Phantom Zero)'],
];

// Old sample format stored bonus credits; recover the credit-chip count from it.
function toRun(sample, carId) {
  const chips = Math.max(0, Math.round((sample.bonusCredits - 500 * sample.policeEscapes - 150 * sample.legendPasses) / 100));
  return { ...sample, carId, creditChips: chips, durationMs: sample.secs * 1000, longestChase: 0 };
}

const byCell = new Map();
for (const s of samples) {
  const key = `${s.type}|${s.car}|${s.upgraded}`;
  if (!byCell.has(key)) byCell.set(key, []);
  byCell.get(key).push(s);
}

function upgradeFraction(state, carId) {
  const up = state.cars[carId].upgrades;
  const total = UPGRADE_KEYS.reduce((a, k) => a + up[k], 0);
  return total / (UPGRADE_KEYS.length * 5); // samples' "maxed" = every line at 5
}

function simulatePlayer(type, seed) {
  const rng = createRng(seed);
  const state = defaultProgress(`sim-${seed}`);
  ensureMissions(state);
  const cfg = PLAYER_TYPES[type];
  const reached = {};
  let seconds = 0;
  const mark = (key, run) => { if (!reached[key]) reached[key] = { run, hours: seconds / 3600 }; };
  for (let run = 1; run <= MAX_RUNS; run++) {
    const car = state.selectedCar;
    const maxed = rng.next() < upgradeFraction(state, car);
    const cell = byCell.get(`${type}|${car}|${maxed}`);
    const sample = cell[Math.floor(rng.next() * cell.length)];
    const day = Math.floor((run - 1) / cfg.runsPerDay);
    seconds += sample.secs + MENU_SECONDS;
    settleRun(state, toRun(sample, car), { dateKey: `day-${day}`, now: run });

    // Spend: a newly available car first (saving for it), else upgrades.
    const target = CARS.map(c => carStatus(state, c.id)).filter(s => !s.owned && s.unlocked).sort((a, b) => a.tier - b.tier)[0];
    if (target) {
      if (state.credits >= target.price) {
        purchaseCar(state, target.id);
        if (carRules(target.id).tier >= carRules(state.selectedCar).tier) selectCar(state, target.id);
      }
    } else {
      for (let guard = 0; guard < 10; guard++) {
        const up = nextUpgrade(state, state.selectedCar);
        if (!up || up.cost > state.credits) break;
        buyUpgrade(state, state.selectedCar, up.key);
        mark('firstUpgrade', run);
      }
    }
    if (state.level >= 5) mark('level5', run);
    if (state.level >= 10) mark('level10', run);
    if (state.level >= 20) mark('level20', run);
    for (const id of ['kestrel', 'bruiser', 'wisp', 'stiletto', 'aurora', 'phantom']) if (state.ownedCars.includes(id)) mark(id, run);
    if (state.level >= 30) mark('level30', run);
    if (reached.phantom) break;
  }
  const upgradedOut = UPGRADE_KEYS.every(k => state.cars[state.selectedCar].upgrades[k] >= upgradeCeiling(state.selectedCar));
  return { reached, level: state.level, upgradedOut };
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function simulate(players = PLAYERS) {
  const out = {};
  for (const type of Object.keys(PLAYER_TYPES)) {
    const results = [];
    for (let i = 0; i < players; i++) results.push(simulatePlayer(type, 1000 + i * 7919));
    out[type] = {};
    for (const [key] of MILESTONES) {
      const runs = results.map(r => r.reached[key] && r.reached[key].run).filter(Boolean);
      const hours = results.map(r => r.reached[key] && r.reached[key].hours).filter(v => v !== undefined && v !== false);
      out[type][key] = {
        share: runs.length / results.length,
        runs: { p10: pct(runs, 0.1), p50: pct(runs, 0.5), p90: pct(runs, 0.9) },
        hours: { p50: pct(hours, 0.5) },
        days: pct(runs, 0.5) ? Math.ceil(pct(runs, 0.5) / PLAYER_TYPES[type].runsPerDay) : null,
      };
    }
  }
  return out;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1].endsWith('simulate.mjs')) {
  const res = simulate();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(res));
  } else {
    console.log(`${PLAYERS} simulated players per type · ${samples.length} recorded runs · runs per day: ${Object.entries(PLAYER_TYPES).map(([t, c]) => `${t} ${c.runsPerDay}`).join(', ')}\n`);
    const types = Object.keys(PLAYER_TYPES);
    console.log(`${'milestone'.padEnd(36)}${types.map(t => t.padEnd(30)).join('')}`);
    for (const [key, label] of MILESTONES) {
      const cells = types.map(t => {
        const m = res[t][key];
        if (!m.runs.p50) return 'not reached'.padEnd(30);
        const share = m.share < 0.98 ? ` [${Math.round(m.share * 100)}%]` : '';
        return `run ${m.runs.p50} (${m.runs.p10}–${m.runs.p90}) ${m.hours.p50.toFixed(1)}h d${m.days}${share}`.padEnd(30);
      });
      console.log(`${label.padEnd(36)}${cells.join('')}`);
    }
  }
}
