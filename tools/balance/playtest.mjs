// Dev-only playtest telemetry: bots play full runs through the real game; the game's own
// telemetry (window.nightVector.telemetry, when present) plus hooks record what happened when.
// Prints per-run timelines and a summary: events, police, dead time, first moments.
//
//   npm run dev
//   node tools/balance/playtest.mjs            (RUNS=12 TYPES=casual,skilled)
import { chromium } from '@playwright/test';
import { parseRun, implausible, maxScore } from '../../server/src/api/raceRules.js';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const RUNS = Number(process.env.RUNS || 12);
const TYPES = (process.env.TYPES || 'casual,skilled').split(',');
const MAX_SECONDS = Number(process.env.MAX_SECONDS || 420);
const VERBOSE = process.env.VERBOSE === '1';
const PROFILES = {
  casual: { latency: 0.36, mistake: 0.1, risk: 0.12, boostAt: 90 },
  skilled: { latency: 0.24, mistake: 0.04, risk: 0.35, boostAt: 70 },
  expert: { latency: 0.14, mistake: 0.012, risk: 0.6, boostAt: 55 },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.goto(`${BASE}/?debug`);
await page.waitForFunction(() => window.nightVector && window.nightVector.state);
await page.evaluate(() => {
  const g = window.nightVector;
  if (!g.save.profile) g.store.setProfile('Playtest Bot', 'bolt');
  g.save.flags.tutorial = true;
});

const all = [];
for (const type of TYPES) {
  for (let r = 0; r < RUNS; r++) {
    const res = await page.evaluate(playRun, { profile: PROFILES[type], maxSeconds: MAX_SECONDS });
    res.type = type;
    // Every natural run must pass the server's anti-cheat bounds (never reject a real player).
    const parsed = parseRun(res.summary);
    const verdict = parsed.ok ? implausible(parsed.run, res.summary.carId, null) : parsed.reason;
    if (verdict) console.log(`!! ${type} run ${r + 1} rejected by raceRules: ${verdict}`, JSON.stringify(res.summary));
    else res.scoreHeadroom = res.summary.score / maxScore(parsed.run, res.summary.carId);
    all.push(res);
    if (VERBOSE) console.log(`${type} run ${r + 1}: ${res.secs}s  ${res.timeline.join('  ')}`);
  }
}

const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
for (const type of TYPES) {
  const rs = all.filter(r => r.type === type);
  const share = f => `${Math.round((rs.filter(f).length / rs.length) * 100)}%`;
  const firstPolice = rs.map(r => r.firstPolice).filter(v => v !== null);
  const firstVisible = rs.map(r => r.firstPoliceVisible).filter(v => v !== null);
  console.log(`\n== ${type} (${rs.length} runs) · run length median ${med(rs.map(r => r.secs))}s · score/ceiling max ${Math.max(...rs.map(r => r.scoreHeadroom || 0)).toFixed(3)}`);
  console.log(`   events/run ${mean(rs.map(r => r.events)).toFixed(1)} · per minute ${mean(rs.map(r => r.events / Math.max(1, r.secs / 60))).toFixed(2)} · kinds ${JSON.stringify(rs.reduce((m, r) => { for (const k of r.eventKinds) m[k] = (m[k] || 0) + 1; return m; }, {}))}`);
  console.log(`   police: chase in ${share(r => r.chases > 0)} of runs · first chase median ${med(firstPolice)}s · police car on screen in ${share(r => r.firstPoliceVisible !== null)} (first ${med(firstVisible)}s) · escapes ${mean(rs.map(r => r.escapes)).toFixed(2)}/run · busted ${mean(rs.map(r => r.busted)).toFixed(2)}/run`);
  const tally = key => JSON.stringify(rs.reduce((m, r) => { for (const [k, v] of Object.entries(r[key])) m[k] = (m[k] || 0) + v; return m; }, {}));
  console.log(`   crashes by cause (all runs): ${tally('crashes')} · event results ${JSON.stringify(rs.flatMap(r => r.eventResults).reduce((m, k) => { m[k] = (m[k] || 0) + 1; return m; }, {}))}`);
  console.log(`   heat: max median ${med(rs.map(r => r.maxHeat))} · roadblocks ${mean(rs.map(r => r.roadblocks)).toFixed(2)}/run · rivals ${mean(rs.map(r => r.rivals)).toFixed(2)}/run`);
  console.log(`   dead time: longest quiet stretch median ${med(rs.map(r => r.longestQuiet))}s (max ${Math.max(...rs.map(r => r.longestQuiet))}s) · quiet share ${(mean(rs.map(r => r.quietShare)) * 100).toFixed(0)}%`);
  console.log(`   first 90 s: near miss ${share(r => r.first90.near)} · combo x3+ ${share(r => r.first90.combo3)} · boost ${share(r => r.first90.boost)} · event ${share(r => r.first90.event)} · police/heat warning ${share(r => r.first90.police)}`);
  console.log(`   intensity: ${rs[0].intensityTrace ? `example ${rs[0].intensityTrace}` : 'n/a (no run director)'}`);
}
await browser.close();

// Runs in the page.
function playRun({ profile, maxSeconds }) {
  const g = window.nightVector;
  const LANE_W = 3.4;
  const laneCenter = l => -2 * LANE_W + LANE_W * (l + 0.5);
  const log = [];
  let t = 0;
  const mark = (what) => log.push({ t, what });
  // Hooks on existing systems (the run director adds its own telemetry when present).
  const ev = g.events;
  const unhook = [];
  const hook = (obj, name, fn) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (...args) { fn(...args); return orig.apply(this, args); };
    unhook.push(() => { obj[name] = orig; });
  };
  hook(ev, 'startEvent', key => mark(`event:${key}`));
  hook(ev, 'startPursuit', () => mark('police:start'));
  hook(ev, 'endPursuit', escaped => mark(escaped ? 'police:escaped' : 'police:busted'));
  hook(g.skills, 'award', label => mark(`award:${label}`));
  let lastBoost = -99;
  hook(g, 'onBoostStart', () => { if (t - lastBoost > 3) mark('boost'); lastBoost = t; });
  const crashes = {};
  hook(g, 'resolveCrash', (car, dx) => {
    const k = car.police ? 'police' : car.barrier ? car.barrier : car.role === 'rival' ? 'rival' : car.typeKey;
    crashes[k] = (crashes[k] || 0) + 1;
  });
  if (g.telemetry) g.telemetry.length = 0;

  g.startRace();
  for (let i = 0; i < 400 && g.state !== 'playing'; i++) { g.input.poll(1 / 60); g.update(1 / 60); }
  const queue = [];
  let target = 1; let brake = false; let decide = 0;
  let firstPoliceVisible = null; let maxHeat = 0; let combo3At = null;
  const trace = [];
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
          if (gap > -1 && gap < 220) { const cl = p.speed - c.speed; ttc[lane] = Math.min(ttc[lane], cl > 0.5 ? Math.max(0, gap) / cl : 99); }
        }
      }
      const cur = Math.max(0, Math.min(3, Math.round((p.x + 2 * LANE_W) / LANE_W - 0.5)));
      const reachable = l => { if (l < 0 || l > 3) return false; const st = Math.sign(l - cur); for (let k = cur + st; k !== l + st; k += st) if (beside[k]) return false; return true; };
      let best = cur;
      if (ttc[cur] < 2.5) { for (const l of [cur - 1, cur + 1, cur - 2, cur + 2]) if (reachable(l) && ttc[l] > ttc[best] + 0.3) best = l; }
      else if (Math.random() < profile.risk * 0.1) { const l = cur + (Math.random() < 0.5 ? -1 : 1); if (reachable(l)) best = l; }
      if (Math.random() < profile.mistake * 0.1) best = Math.max(0, Math.min(3, cur + (Math.random() < 0.5 ? -1 : 1)));
      queue.push({ at: t + profile.latency, lane: best, brake: ttc[best] < 1.0 });
      // Observations
      const police = g.traffic.vehicles.some(c => c.police && c.z - c.length / 2 > 1.5 && c.z < 380);
      if (police && firstPoliceVisible === null) firstPoliceVisible = Math.round(t);
      if (g.police) maxHeat = Math.max(maxHeat, g.police.level);
      if (g.score.multiplier >= 3 && combo3At === null) combo3At = t;
      if (g.director && Math.round(t * 10) % 150 === 0) trace.push(Math.round(g.director.intensity));
    }
    while (queue.length && queue[0].at <= t) { const d = queue.shift(); target = d.lane; brake = d.brake; }
    const dx = laneCenter(target) - g.player.x;
    g.input.touch.steer = dx > 0.45 ? 1 : dx < -0.45 ? -1 : 0;
    g.input.touch.brake = brake;
    g.input.touch.boost = g.player.boost > profile.boostAt && !brake;
    g.input.poll(dt);
    g.update(dt);
  }
  g.input.touch.steer = 0; g.input.touch.brake = false; g.input.touch.boost = false;
  const secs = Math.round(g.runTime);
  for (let i = 0; i < 600 && g.state !== 'gameover'; i++) g.update(1 / 60);
  for (const u of unhook) u();
  // Director telemetry (new system), merged in.
  for (const e of (g.telemetry || [])) log.push({ t: e.t, what: e.what });
  log.sort((a, b) => a.t - b.t);

  const isMoment = w => /^(director:formation|event:|police:|award:(NEAR MISS|VERY CLOSE|INSANE|PERFECT|CHICANE|LEGEND|POLICE|ROADBLOCK|CHECKPOINT|DRAFT|SLINGSHOT|PERFECT DODGE|RIVAL|SPEED ZONE|OVERTAKE)|director:event|heat:up|chase:|rival:|roadblock:)/.test(w);
  const moments = log.filter(e => isMoment(e.what)).map(e => e.t);
  let longest = 0; let quiet = 0; let prev = 0;
  for (const m of moments.concat([secs])) { const gap = m - prev; if (gap > longest) longest = gap; if (gap > 15) quiet += gap - 15; prev = m; }
  const kinds = log.filter(e => /^director:event:/.test(e.what)).map(e => e.what.replace(/^director:event:/, ''));
  const results = log.filter(e => /^event:[a-zA-Z]+:(done|failed|interrupted)$/.test(e.what)).map(e => e.what.replace(/^event:/, ''));
  const has = (re, until = 90) => log.some(e => e.t <= until && re.test(e.what));
  const firstPoliceEv = log.find(e => /police:start|chase:start/.test(e.what));
  return {
    summary: g.runSummary(),
    secs,
    events: kinds.length,
    eventKinds: kinds,
    eventResults: results,
    crashes,
    deathHealth: Math.round(g.player.health),
    chases: log.filter(e => /police:start|chase:start/.test(e.what)).length,
    escapes: log.filter(e => /police:escaped|chase:escaped/.test(e.what)).length,
    busted: log.filter(e => /police:busted|chase:busted/.test(e.what)).length,
    roadblocks: log.filter(e => /roadblock:spawn/.test(e.what)).length,
    rivals: log.filter(e => /rival:start/.test(e.what)).length,
    firstPolice: firstPoliceEv ? Math.round(firstPoliceEv.t) : null,
    firstPoliceVisible,
    maxHeat,
    longestQuiet: Math.round(longest),
    quietShare: secs ? quiet / secs : 0,
    first90: {
      near: has(/award:(NEAR MISS|CLOSE|VERY CLOSE|INSANE)/),
      combo3: combo3At !== null && combo3At <= 90,
      boost: has(/^boost$/),
      event: has(/^event:|director:event/),
      police: has(/police:start|chase:start|heat:up:2|heat:up:1/),
    },
    intensityTrace: trace.length ? trace.join('→') : null,
    timeline: log.filter(e => !/^award:/.test(e.what) || /PERFECT|INSANE|POLICE|ROADBLOCK|RIVAL/.test(e.what)).map(e => `${Math.round(e.t)}s ${e.what}`),
  };
}
