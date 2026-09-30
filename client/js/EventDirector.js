import { ROAD, CAMERA, TRAFFIC, laneCenter } from './config.js';
import { EVENTS } from './balance.js';
import { BARRIER_ROADWORK, BARRIER_ACCIDENT } from './TrafficManager.js';
import { rand, randInt, clamp } from './utils.js';
import { PRIORITY } from './BonusFeed.js';

// Lane diagram for banners, e.g. "▮ ▮ ✕ ▮" for a closed third lane.
export function laneDiagram(isClosed) {
  const out = [];
  for (let l = 0; l < ROAD.LANES; l++) out.push(isClosed(l) ? '✕' : '▮');
  return out.join(' ');
}

// Runs road events and in-run challenges. WHICH event and WHEN is the RunDirector's call; this
// class carries them out: warning banner first, then the effect, progress on the banner, and
// the result (reward or fail). Every obstacle leaves at least one open lane.
export class EventDirector {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    if (this.current && this.current.key === 'rainstorm') this.game.weather.setOverride(null);
    this.current = null;
    this.scoreBonus = 1;
    this.game.rival.reset();
  }

  get busy() {
    return this.current !== null;
  }

  get distance() {
    return this.game.score.distance;
  }

  update(dt) {
    if (this.current) this.updateEvent(dt);
  }

  // Starts an event now. Returns false when it can't run in the current situation.
  start(key) {
    if (this.current) return false;
    const g = this.game;
    const cfg = EVENTS[key];
    if (!cfg) return false;
    if (key === 'tunnel' && !g.environment.env.tunnels) return false;
    if (key === 'rainstorm' && (g.environment.env.weather.rain + g.environment.env.weather.storm === 0 || g.weather.condition === 'storm')) return false;
    const ev = { key, cfg, phase: 'warn', timer: cfg.warn, lane: -1, lanes: null, failed: false, barrierZ: 0, length: 0, endDistance: 0, sub: cfg.sub, shown: -1, count: 0, hold: 0 };
    if (key === 'roadwork') {
      ev.lane = randInt(0, ROAD.LANES - 1);
      ev.sub = `LANE ${ev.lane + 1} CLOSED   ${laneDiagram(l => l === ev.lane)}`;
    } else if (key === 'accident') {
      const a = randInt(0, ROAD.LANES - 2);
      ev.lanes = [a, a + 1];
      ev.sub = `${laneDiagram(l => ev.lanes.includes(l))}`;
    } else if (key === 'speedZone') {
      ev.target = Math.round((g.maxKmh * cfg.speedRatio) / 5) * 5;
      ev.sub = `Hold ${ev.target} km/h for ${cfg.hold}s`;
    } else if (key === 'overtakeRush') {
      ev.sub = `Overtake ${cfg.count} cars in ${cfg.window}s`;
    } else if (key === 'nearMissBlitz') {
      ev.sub = `${cfg.count} near misses in ${cfg.window}s`;
    }
    this.current = ev;
    g.telemetry.push({ t: g.runTime, what: `director:event:${key}` });
    if (key === 'rival') {
      if (!g.rival.start()) {
        this.current = null;
        return false;
      }
      ev.phase = 'active';
      return true;
    }
    const good = cfg.kind === 'relief' || cfg.kind === 'challenge';
    g.ui.showBanner(cfg.kind === 'challenge' ? 'Challenge' : cfg.kind === 'police' ? 'Police' : good ? 'Road event' : 'Warning',
      cfg.label, ev.sub, cfg.kind === 'police' ? 'police' : good ? 'good' : '');
    g.audio.eventWarn(good);
    return true;
  }

  // Lane with the most free space around the spawn depth.
  clearestLane() {
    let best = 0;
    let bestScore = -1;
    const traffic = this.game.traffic;
    for (let l = 0; l < ROAD.LANES; l++) {
      let clear = 0;
      for (let range = 20; range <= 140; range += 20) if (traffic.isLaneClear(l, TRAFFIC.SPAWN_DEPTH, range, range)) clear++;
      const score = clear + Math.random() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    return best;
  }

  updateEvent(dt) {
    const ev = this.current;
    const g = this.game;
    const ui = g.ui;
    if (ev.key === 'rival') {
      g.rival.update(dt);
      if (!g.rival.active) this.endEvent('done');
      return;
    }
    if (ev.phase === 'warn') {
      ev.timer -= dt;
      ui.updateBanner(ev.sub, -1);
      if (ev.timer <= 0) this.activate(ev);
      return;
    }
    switch (ev.key) {
      case 'heavyTraffic':
      case 'openHighway':
      case 'rainstorm': {
        ev.timer -= dt;
        const secs = Math.ceil(ev.timer);
        ui.updateBanner(secs !== ev.shown ? `${ev.sub} · ${secs}s` : null, ev.timer / ev.cfg.duration);
        ev.shown = secs;
        if (ev.timer <= 0) this.endEvent('done');
        break;
      }
      case 'truckConvoy':
      case 'policePatrol':
        ev.timer -= dt;
        if (ev.timer <= 0) this.endEvent('done');
        break;
      case 'tunnel':
        ev.timer -= dt;
        if (ev.timer <= 0) ui.hideBanner();
        if (this.distance >= ev.endDistance) this.endEvent('done');
        break;
      case 'roadwork':
      case 'accident': {
        ev.barrierZ -= g.player.speed * dt; // barriers are static, so they close at player speed
        const remaining = ev.barrierZ - CAMERA.PLAYER_DEPTH;
        const meters = Math.max(0, Math.round(remaining / 10) * 10);
        ui.updateBanner(meters !== ev.shown ? `${ev.sub} · ${meters}m` : null, clamp(1 - remaining / TRAFFIC.SPAWN_DEPTH, 0, 1));
        ev.shown = meters;
        if (ev.barrierZ + ev.length < CAMERA.PLAYER_DEPTH - 5) {
          if (!ev.failed) g.skills.award(ev.key === 'roadwork' ? 'ROADWORK CLEARED' : 'ACCIDENT CLEARED', ev.cfg.points, 2, 'good');
          this.endEvent(ev.failed ? 'failed' : 'done');
        }
        break;
      }
      case 'speedZone': {
        ev.timer -= dt;
        const kmh = g.player.speed * 3.6;
        if (kmh >= ev.target) ev.hold += dt;
        else ev.hold = Math.max(0, ev.hold - dt * 0.5);
        const shown = Math.floor(ev.hold * 2) * 1000 + Math.ceil(ev.timer);
        if (shown !== ev.shown) {
          ev.shown = shown;
          ui.updateBanner(`${ev.sub} · ${ev.hold.toFixed(1)}/${ev.cfg.hold}s · ${Math.ceil(ev.timer)}s left`, ev.hold / ev.cfg.hold);
        }
        if (ev.hold >= ev.cfg.hold) this.completeChallenge(ev);
        else if (ev.timer <= 0) this.endEvent('failed');
        break;
      }
      case 'overtakeRush':
      case 'nearMissBlitz': {
        ev.timer -= dt;
        const shown = ev.count * 1000 + Math.ceil(ev.timer);
        if (shown !== ev.shown) {
          ev.shown = shown;
          ui.updateBanner(`${ev.count}/${ev.cfg.count} · ${Math.ceil(ev.timer)}s left`, ev.count / ev.cfg.count);
        }
        if (ev.count >= ev.cfg.count) this.completeChallenge(ev);
        else if (ev.timer <= 0) this.endEvent('failed');
        break;
      }
      default:
        this.endEvent('done');
    }
  }

  activate(ev) {
    const g = this.game;
    const cfg = ev.cfg;
    ev.phase = 'active';
    switch (ev.key) {
      case 'heavyTraffic':
        g.traffic.densityScale = cfg.density;
        ev.timer = cfg.duration;
        break;
      case 'openHighway':
        g.traffic.densityScale = cfg.density;
        this.scoreBonus = cfg.scoreBonus;
        ev.timer = cfg.duration;
        break;
      case 'rainstorm':
        g.weather.setOverride('storm');
        ev.timer = cfg.duration;
        break;
      case 'truckConvoy': {
        // Two lines of trucks with cars beside them: squeeze between (double near-miss pay)
        // or wait for the open lane.
        ev.timer = 9;
        const a = randInt(0, ROAD.LANES - 2);
        for (let k = 0; k < 4; k++) {
          const lane = k % 2 === 0 ? a : a + 1;
          g.traffic.trySpawn('truck', lane, TRAFFIC.SPAWN_DEPTH + k * 34, g.difficulty, -1);
        }
        g.ui.hideBanner();
        break;
      }
      case 'policePatrol':
        ev.timer = 12;
        if (!g.police.spawnPatrol()) this.endEvent('failed');
        g.ui.hideBanner();
        break;
      case 'tunnel': {
        const length = rand(cfg.length[0], cfg.length[1]);
        g.road.addTunnel(cfg.ahead, length);
        ev.endDistance = this.distance + cfg.ahead + length;
        ev.timer = 2.5;
        break;
      }
      case 'roadwork':
        ev.length = rand(cfg.length[0], cfg.length[1]);
        ev.barrierZ = TRAFFIC.SPAWN_DEPTH;
        if (!g.traffic.spawnBarrier(BARRIER_ROADWORK, ev.lane, ev.barrierZ, ev.length)) this.endEvent('failed');
        break;
      case 'accident': {
        ev.length = rand(cfg.length[0], cfg.length[1]);
        ev.barrierZ = TRAFFIC.SPAWN_DEPTH;
        let placed = 0;
        for (const lane of ev.lanes) if (g.traffic.spawnBarrier(BARRIER_ACCIDENT, lane, ev.barrierZ + (lane === ev.lanes[0] ? 0 : 14), ev.length)) placed++;
        if (!placed) this.endEvent('failed');
        break;
      }
      case 'speedZone':
      case 'overtakeRush':
      case 'nearMissBlitz':
        ev.timer = cfg.window;
        break;
      default:
        break;
    }
  }

  completeChallenge(ev) {
    const g = this.game;
    g.score.addBonus(ev.cfg.points);
    g.player.addBoost(ev.cfg.boost);
    g.score.stats.challenges++;
    g.ui.feed.push(`${ev.cfg.label} DONE`, ev.cfg.points, PRIORITY.IMPORTANT, 'good', 'challenge');
    g.audio.perfect();
    g.haptics.pulse('unlock');
    this.endEvent('done');
  }

  endEvent(result) {
    const g = this.game;
    const ev = this.current;
    g.traffic.densityScale = 1;
    this.scoreBonus = 1;
    if (ev && ev.key === 'rainstorm') g.weather.setOverride(null);
    if (ev && result === 'failed' && ev.cfg.kind === 'challenge') g.ui.feed.push(`${ev.cfg.label} MISSED`, 0, PRIORITY.ROUTINE, 'danger', 'challenge');
    if (ev) g.telemetry.push({ t: g.runTime, what: `event:${ev.key}:${result}` });
    this.current = null;
    if (!g.police.roadblock) g.ui.hideBanner();
    g.director.onEventEnd(ev ? ev.key : '', result);
  }

  // ---------------------------------------------------------------- hooks from gameplay

  onOvertake() {
    const ev = this.current;
    if (ev && ev.phase === 'active' && ev.key === 'overtakeRush') ev.count++;
  }

  onNearMiss() {
    const ev = this.current;
    if (ev && ev.phase === 'active' && ev.key === 'nearMissBlitz') ev.count++;
  }

  onCrash() {
    if (this.current) this.current.failed = true;
  }

  // Glowing marker over the open lane of a police roadblock so the safe path reads at a glance.
  renderMarkers(ctx, cam, road) {
    const rb = this.game.police.roadblock;
    if (!rb) return;
    const list = this.game.traffic.vehicles;
    let z = -1;
    for (let i = 0; i < list.length; i++) if (list[i].barrier === 'roadblock') { z = list[i].z; break; }
    if (z < CAMERA.NEAR_CLIP + 1 || z > ROAD.DRAW_DISTANCE) return;
    const s = cam.focal / z;
    const x = cam.cx + (laneCenter(rb.open) + road.offsetAt(z) - cam.x) * s;
    const y = cam.horizonY + CAMERA.HEIGHT * s;
    const w = ROAD.LANE_WIDTH * 1.4 * s;
    const pulse = 0.7 + 0.3 * Math.sin(this.game.time * 8);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pulse;
    ctx.drawImage(this.game.bank.pickup.repairGlow, x - w / 2, y - w * 0.5, w, w * 0.6);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
