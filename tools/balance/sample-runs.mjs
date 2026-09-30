// Dev-only: records real run statistics for the progression simulation.
//
// Bots play full races through the actual game code (traffic, difficulty curve, collisions,
// the touch steering path), in fast-forward, for three player types and every car — stock and
// fully upgraded. Only gameplay numbers are stored (distance, score, near misses, …); the
// economy is applied later by tools/balance/simulate.mjs, so reward tuning never needs new samples.
//
//   npm run dev                                   (in another terminal)
//   node tools/balance/sample-runs.mjs            → tools/balance/run-samples.json
//   RUNS=3 CARS=vireo,kestrel node tools/balance/sample-runs.mjs   (quick partial run)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const RUNS = Number(process.env.RUNS || 6);
const MAX_SECONDS = 600; // a run longer than 10 minutes is recorded as capped
const OUT = new URL('./run-samples.json', import.meta.url);

// Reaction latency (s), random mistakes and appetite for risky passes, per player type.
export const PLAYER_TYPES = {
  casual: { latency: 0.36, mistake: 0.1, risk: 0.12, boostAt: 90 },
  skilled: { latency: 0.24, mistake: 0.04, risk: 0.35, boostAt: 70 },
  expert: { latency: 0.14, mistake: 0.012, risk: 0.6, boostAt: 55 },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.goto(`${BASE}/?debug`);
await page.waitForFunction(() => window.nightVector && window.nightVector.state === 'menu');
const carIds = process.env.CARS ? process.env.CARS.split(',') : await page.evaluate(() => window.nightVector.carIds());

const samples = existsSync(OUT) && process.env.APPEND ? JSON.parse(readFileSync(OUT, 'utf8')).samples : [];
const started = Date.now();
for (const type of Object.keys(PLAYER_TYPES)) {
  for (const car of carIds) {
    for (const upgrades of [0, 1]) {
      const runs = await page.evaluate(playRuns, { car, upgrades, profile: PLAYER_TYPES[type], runs: RUNS, maxSeconds: MAX_SECONDS });
      for (const r of runs) samples.push({ type, car, upgraded: upgrades === 1, ...r });
      const secs = runs.map(r => r.secs);
      console.log(`${type.padEnd(8)} ${car.padEnd(8)} ${upgrades ? 'maxed' : 'stock'}  run s: ${secs.join(', ')}  (${((Date.now() - started) / 1000).toFixed(0)} s elapsed)`);
    }
  }
}
writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), runsPerCell: RUNS, maxSeconds: MAX_SECONDS, playerTypes: PLAYER_TYPES, samples }, null, 1)}\n`);
console.log(`wrote ${samples.length} samples → ${OUT.pathname}`);
await browser.close();

// Runs in the page. `upgrades`: 0 = stock, 1 = every upgrade at its ceiling.
function playRuns({ car, upgrades, profile, runs, maxSeconds }) {
  const g = window.nightVector;
  g.save.flags.tutorial = true;
  g.devSetCar(car, upgrades);
  const LANE_W = 3.4;
  const laneCenter = l => -2 * LANE_W + LANE_W * (l + 0.5);
  const out = [];
  for (let r = 0; r < runs; r++) {
    g.startRace();
    for (let i = 0; i < 400 && g.state !== 'playing'; i++) { g.input.poll(1 / 60); g.update(1 / 60); }
    const queue = [];
    let target = 1;
    let brake = false;
    let decide = 0;
    let t = 0;
    while ((g.state === 'playing' || g.state === 'crashing') && t < maxSeconds) {
      const dt = 1 / 60;
      t += dt;
      decide -= dt;
      if (decide <= 0 && g.state === 'playing') {
        decide = 0.1;
        const p = g.player;
        const ttc = [99, 99, 99, 99];
        const beside = [false, false, false, false];
        for (const c of g.traffic.vehicles) {
          const ahead = c.z - 8.5;
          const gap = ahead - (c.length + p.profile.length) / 2;
          for (const lane of new Set([c.lane, c.targetLane])) {
            if (lane < 0 || lane > 3) continue;
            if (Math.abs(ahead) < (c.length + p.profile.length) / 2 + 3) beside[lane] = true;
            if (gap > -1 && gap < 220) {
              const closing = p.speed - c.speed;
              ttc[lane] = Math.min(ttc[lane], closing > 0.5 ? Math.max(0, gap) / closing : 99);
            }
          }
        }
        const cur = Math.max(0, Math.min(3, Math.round((p.x + 2 * LANE_W) / LANE_W - 0.5)));
        const reachable = l => {
          if (l < 0 || l > 3) return false;
          const step = Math.sign(l - cur);
          for (let k = cur + step; k !== l + step; k += step) if (beside[k]) return false;
          return true;
        };
        let best = cur;
        if (ttc[cur] < 2.5) {
          for (const l of [cur - 1, cur + 1, cur - 2, cur + 2]) if (reachable(l) && ttc[l] > ttc[best] + 0.3) best = l;
        } else if (Math.random() < profile.risk * 0.1) {
          const l = cur + (Math.random() < 0.5 ? -1 : 1); // slide next to traffic for a near miss
          if (reachable(l)) best = l;
        }
        if (Math.random() < profile.mistake * 0.1) best = Math.max(0, Math.min(3, cur + (Math.random() < 0.5 ? -1 : 1)));
        queue.push({ at: t + profile.latency, lane: best, brake: ttc[best] < 1.0 });
      }
      while (queue.length && queue[0].at <= t) {
        const d = queue.shift();
        target = d.lane;
        brake = d.brake;
      }
      const dx = laneCenter(target) - g.player.x;
      g.input.touch.steer = dx > 0.45 ? 1 : dx < -0.45 ? -1 : 0;
      g.input.touch.brake = brake;
      g.input.touch.boost = g.player.boost > profile.boostAt && !brake;
      g.input.poll(dt);
      g.update(dt);
    }
    g.input.touch.steer = 0;
    g.input.touch.brake = false;
    g.input.touch.boost = false;
    const s = g.score.stats;
    out.push({
      secs: Math.round(g.runTime),
      capped: t >= maxSeconds,
      distance: Math.round(g.score.distance),
      score: Math.floor(g.score.score),
      overtakes: s.overtakes,
      perfectOvertakes: s.perfectOvertakes,
      nearMisses: s.nearMisses,
      insaneMisses: s.insaneMisses,
      chicanes: s.chicanes,
      highSpeedTime: Math.round(s.highSpeedTime),
      bestMultiplier: s.bestMultiplier,
      bonusCredits: s.bonusCredits,
      boostTime: Math.round(s.boostTime),
      policeEscapes: s.policeEscapes,
      escapeStars: s.escapeStars,
      heatEscaped: s.heatEscaped,
      rivalsBeaten: s.rivalsBeaten,
      challenges: s.challenges,
      bestCleanDistance: Math.round(s.bestCleanDistance),
      topSpeed: Math.round(s.topSpeed),
      legendPasses: s.legendPasses,
      pickups: s.pickups,
      crashes: s.crashes,
    });
    for (let i = 0; i < 600 && g.state !== 'gameover'; i++) g.update(1 / 60);
    g.enterMenu();
  }
  return out;
}
