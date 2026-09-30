import { DIRECTOR, EVENTS, FORMATIONS, DIFFICULTY } from './balance.js';
import { createRng, hashString } from './Rng.js';
import { clamp, lerpRange } from './utils.js';

const CYCLE = ['pressure', 'event', 'escalation', 'peak', 'breather'];
const EVENT_KEYS = Object.keys(EVENTS);
const FORMATION_KEYS = Object.keys(FORMATIONS.WEIGHTS);

// The RunDirector paces a race so it tells a small story instead of "dodge, dodge, dodge":
//
//   warm-up → pressure → event → escalation → peak → breather → (pressure … again, from a
//   higher floor) — with police chases taking over whenever heat calls them in.
//
// It owns INTENSITY (0–100): the live value eases toward the current phase's target and drives
// traffic pressure (density, lane changes, formations). It decides which road event or
// challenge happens and when, asks traffic for designed formations, reacts to chases (a chase
// is a peak; an escape earns a breather), and guarantees that nothing stays quiet for long.
// Each run gets a hidden pacing personality and seeded variation, so no two runs play alike.
export class RunDirector {
  constructor(game) {
    this.game = game;
    this.reset(Date.now());
  }

  reset(seed) {
    this.seed = seed >>> 0;
    this.rng = createRng(hashString(`run-${this.seed}`));
    this.personalityKey = this.pickPersonality();
    this.personality = DIRECTOR.PERSONALITIES[this.personalityKey];
    this.intensity = 15;
    this.cycle = 0;
    this.phase = null;
    this.phaseIndex = -1;
    this.phaseTime = 0;
    this.phaseDuration = 0;
    this.target = 20;
    this.eventAt = this.range(DIRECTOR.FIRST_EVENT_AT);
    this.formationIn = 6;
    this.lastMoment = 0;
    this.lastForced = 0;
    this.retryAt = 0;
    this.used = {}; // event key → times used this run
    this.lastKinds = [];
    this.chasing = false;
    this.enterPhase('warmup');
    this.game.police.gainScale = this.personality.heat;
  }

  range([a, b]) {
    return a + this.rng.next() * (b - a);
  }

  pickPersonality() {
    const entries = Object.entries(DIRECTOR.PERSONALITIES);
    let total = 0;
    for (const [, p] of entries) total += p.weight;
    let r = this.rng.next() * total;
    for (const [key, p] of entries) {
      r -= p.weight;
      if (r <= 0) return key;
    }
    return 'mixed';
  }

  enterPhase(name) {
    const cfg = DIRECTOR.PHASES[name];
    const floor = Math.min(20, this.cycle * DIRECTOR.CYCLE_FLOOR_STEP);
    this.phase = name;
    this.phaseTime = 0;
    this.phaseDuration = this.range(cfg.duration);
    this.target = clamp(this.range(cfg.target) + (name === 'breather' ? floor * 0.5 : floor), 0, 100);
    const g = this.game;
    g.telemetry.push({ t: g.runTime, what: `director:phase:${name}:${Math.round(this.target)}` });
    if (name === 'breather' && !g.events.busy && this.rng.next() < 0.45) this.startEvent('openHighway');
  }

  nextPhase() {
    if (this.phase === 'warmup') {
      this.phaseIndex = 0;
    } else {
      this.phaseIndex = (this.phaseIndex + 1) % CYCLE.length;
      if (this.phaseIndex === 0) this.cycle++;
    }
    this.enterPhase(CYCLE[this.phaseIndex]);
  }

  // A "moment": something the player noticed (skill move, event, police). Used by the quiet guard.
  moment() {
    this.lastMoment = this.game.runTime;
  }

  update(dt) {
    const g = this.game;
    const t = g.runTime;
    this.phaseTime += dt;
    if (this.chasing) {
      // The chase is the peak: intensity follows the heat.
      this.target = clamp(70 + g.police.level * 6, 0, 100);
    } else if (this.phaseTime >= this.phaseDuration) {
      this.nextPhase();
    }
    this.intensity += (this.target - this.intensity) * Math.min(1, dt * DIRECTOR.EASE);

    // Traffic pressure swings around the run's long-term difficulty (time-based, gentle at the
    // start): intensity makes peaks denser and breathers calmer without front-loading danger.
    g.traffic.pressure = clamp(g.difficulty + ((this.intensity - 50) / 100) * DIRECTOR.PRESSURE_SWING, 0.03, 1);
    g.traffic.ambientPatterns = this.intensity < 35; // the director's formations take over above

    // Events: on schedule, in the event phase, or when the run went quiet.
    const quiet = t - this.lastMoment;
    if (!g.events.busy && !this.chasing) {
      const due = t >= this.eventAt || (this.phase === 'event' && this.phaseTime > 3 && !this.used.__phaseEvent);
      if ((due || quiet > DIRECTOR.QUIET_LIMIT + 8) && t >= this.retryAt) {
        if (this.phase === 'event') this.used.__phaseEvent = true;
        if (this.startEvent(this.pickEvent())) this.eventAt = t + this.range(DIRECTOR.EVENT_GAP);
        else this.retryAt = t + 3;
      }
    }
    if (this.phase !== 'event') this.used.__phaseEvent = false;

    // Formations: more often at higher intensity; immediately when things went quiet.
    this.formationIn -= dt;
    const forced = quiet > DIRECTOR.QUIET_LIMIT && t - (this.lastForced || 0) > 6;
    if (this.intensity > 22 && (this.formationIn <= 0 || forced) && this.phase !== 'breather') {
      if (forced) this.lastForced = t;
      this.spawnFormation();
      const k = 1.35 - this.intensity / 100;
      this.formationIn = this.range(DIRECTOR.FORMATION_GAP) * k / (this.personality.formations || 1);
    }
  }

  // ---------------------------------------------------------------- choices

  pickEvent() {
    const g = this.game;
    const want = this.target;
    let total = 0;
    const weights = [];
    for (const key of EVENT_KEYS) {
      const cfg = EVENTS[key];
      let w = cfg.weight * (this.personality.events[key] || 1);
      // Fit: events close to the intensity we want now.
      w *= Math.max(0.1, 1 - Math.abs(cfg.intensity - want) / 45);
      // Variety: the same kind twice in a row is unlikely; the same event four times, never.
      if (this.lastKinds.includes(cfg.kind)) w *= 0.3;
      if ((this.used[key] || 0) >= 3) w = 0;
      if (cfg.kind === 'relief' && this.phase !== 'breather') w *= 0.3;
      if (key === 'rival' && ((this.used.rival || 0) >= (this.personalityKey === 'speed' ? 2 : 1) || t0(g) < 50)) w = 0;
      if (cfg.kind === 'police' && (g.police.level >= 2 || g.police.patrols > 0)) w = 0;
      // Heat is about to call the police: a challenge now would only get cut short.
      if (cfg.kind === 'challenge' && g.police.heat > 90) w = 0;
      if (key === 'tunnel' && !g.environment.env.tunnels) w = 0;
      weights.push(w);
      total += w;
    }
    let r = this.rng.next() * total;
    for (let i = 0; i < EVENT_KEYS.length; i++) {
      r -= weights[i];
      if (r <= 0 && weights[i] > 0) return EVENT_KEYS[i];
    }
    return 'heavyTraffic';
  }

  startEvent(key) {
    const g = this.game;
    if (!g.events.start(key)) return false;
    this.used[key] = (this.used[key] || 0) + 1;
    this.lastKinds.push(EVENTS[key].kind);
    if (this.lastKinds.length > 2) this.lastKinds.shift();
    this.moment();
    return true;
  }

  spawnFormation() {
    const g = this.game;
    let total = 0;
    const weights = [];
    for (const key of FORMATION_KEYS) {
      const w = this.intensity >= FORMATIONS.MIN_INTENSITY[key] ? FORMATIONS.WEIGHTS[key] : 0;
      weights.push(w);
      total += w;
    }
    if (total <= 0) return;
    let r = this.rng.next() * total;
    let kind = FORMATION_KEYS[0];
    for (let i = 0; i < FORMATION_KEYS.length; i++) {
      r -= weights[i];
      if (r <= 0 && weights[i] > 0) {
        kind = FORMATION_KEYS[i];
        break;
      }
    }
    const built = g.traffic.spawnFormation(kind === 'riskPickup' ? 'gate' : kind, g.difficulty);
    if (!built) return;
    // A formation replaces the next random wave instead of piling on top of it.
    g.traffic.untilWave = Math.max(g.traffic.untilWave, lerpRange(DIFFICULTY.SPAWN_GAP, g.traffic.pressure));
    // Risk route: a reward sits in the squeeze between the two cars of a gate.
    if (kind === 'riskPickup' && built.gapLane >= 0) g.pickups.spawnAt(built.gapLane, built.z, g.player.health < 70);
    g.telemetry.push({ t: g.runTime, what: `director:formation:${kind}` });
  }

  // ---------------------------------------------------------------- police & events hooks

  allowChase() {
    const g = this.game;
    if (g.tutorial || g.runTime < 18) return false;
    const ev = g.events.current;
    return !ev || (ev.key !== 'rival' && ev.key !== 'roadwork' && ev.key !== 'accident');
  }

  allowObstacle() {
    const ev = this.game.events.current;
    return !ev || (ev.cfg.kind !== 'obstacle' && ev.key !== 'truckConvoy');
  }

  onChaseStart() {
    this.chasing = true;
    this.moment();
    const ev = this.game.events.current;
    // A challenge can't compete with a chase for attention: it quietly ends.
    if (ev && ev.cfg.kind === 'challenge') this.game.events.endEvent('interrupted');
  }

  onChaseEnd(escaped) {
    this.chasing = false;
    this.moment();
    this.phaseIndex = CYCLE.indexOf('breather');
    this.enterPhase('breather');
    this.eventAt = Math.max(this.eventAt, this.game.runTime + (escaped ? 14 : 10));
  }

  onEventEnd() {
    this.moment();
  }
}

const t0 = g => g.runTime;
