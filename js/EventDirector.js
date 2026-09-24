import { ROAD, CAMERA, TRAFFIC, PALETTE, laneCenter } from './config.js';
import { EVENTS, POLICE } from './balance.js';
import { BARRIER_ROADWORK, BARRIER_CHECKPOINT } from './TrafficManager.js';
import { rand, randInt, clamp } from './utils.js';


const EVENT_KEYS = ['heavyTraffic', 'openHighway', 'tunnel', 'roadwork', 'checkpoint', 'rainstorm'];

// Lane diagram for banners, e.g. "▮ ▮ ✕ ▮" for a closed third lane.
function laneDiagram(isClosed) {
  const out = [];
  for (let l = 0; l < ROAD.LANES; l++) out.push(isClosed(l) ? '✕' : '▮');
  return out.join(' ');
}

// Occasional, clearly telegraphed road events and police pursuits. Everything is announced
// with a banner before it can affect the player, and obstacles always leave an open lane.
export class EventDirector {
  constructor(game) {
    this.game = game;
    this.weights = new Float32Array(EVENT_KEYS.length);
    this.police = { active: false, time: 0, gap: 0, cooldownUntil: 0, sirenPhase: 0, shown: -1 };
    this.reset();
  }

  reset() {
    this.current = null;
    this.nextAt = EVENTS.FIRST_AT;
    this.scoreBonus = 1;
    const p = this.police;
    if (p.active) this.game.audio.siren(false);
    p.active = false;
    p.time = 0;
    p.gap = 0;
    p.cooldownUntil = POLICE.MIN_DISTANCE;
  }

  get distance() {
    return this.game.score.distance;
  }

  update(dt) {
    this.updatePolice(dt);
    if (this.current) this.updateEvent(dt);
    else if (!this.police.active && this.distance >= this.nextAt) this.startEvent(this.pickEvent());
  }

  pickEvent() {
    const env = this.game.environment.env;
    let total = 0;
    for (let i = 0; i < EVENT_KEYS.length; i++) {
      const key = EVENT_KEYS[i];
      let w = EVENTS[key].weight;
      if (key === 'tunnel' && !env.tunnels) w = 0;
      if (key === 'roadwork' && this.game.difficulty < EVENTS.MIN_DIFFICULTY_ROADWORK) w = 0;
      if (key === 'rainstorm' && (env.weather.rain + env.weather.storm === 0 || this.game.weather.condition === 'storm')) w = 0;
      this.weights[i] = w;
      total += w;
    }
    let r = Math.random() * total;
    for (let i = 0; i < EVENT_KEYS.length; i++) {
      r -= this.weights[i];
      if (r <= 0 && this.weights[i] > 0) return EVENT_KEYS[i];
    }
    return 'heavyTraffic';
  }

  startEvent(key) {
    const cfg = EVENTS[key];
    const ev = { key, cfg, phase: 'warn', timer: cfg.warn, lane: -1, failed: false, barrierZ: 0, length: 0, endDistance: 0, sub: cfg.sub, shown: -1 };
    if (key === 'roadwork') {
      ev.lane = randInt(0, ROAD.LANES - 1);
      ev.sub = `LANE ${ev.lane + 1} CLOSED   ${laneDiagram(l => l === ev.lane)}`;
    } else if (key === 'checkpoint') {
      ev.lane = this.clearestLane();
      ev.sub = `USE LANE ${ev.lane + 1}   ${laneDiagram(l => l !== ev.lane)}`;
    }
    this.current = ev;
    const good = key === 'openHighway';
    this.game.ui.showBanner(good ? 'Road event' : 'Warning', cfg.label, ev.sub, good ? 'good' : '');
    this.game.audio.eventWarn(good);
  }

  // Lane with the most free space around the spawn depth (for the checkpoint opening).
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
    const ui = this.game.ui;
    if (ev.phase === 'warn') {
      ev.timer -= dt;
      ui.updateBanner(ev.sub, -1);
      if (ev.timer <= 0) this.activate(ev);
      return;
    }
    const g = this.game;
    switch (ev.key) {
      case 'heavyTraffic':
      case 'openHighway':
      case 'rainstorm': {
        ev.timer -= dt;
        const secs = Math.ceil(ev.timer);
        ui.updateBanner(secs !== ev.shown ? `${ev.sub} · ${secs}s` : null, ev.timer / ev.cfg.duration);
        ev.shown = secs;
        if (ev.timer <= 0) this.endEvent();
        break;
      }
      case 'tunnel':
        ev.timer -= dt;
        if (ev.timer <= 0) ui.hideBanner();
        if (this.distance >= ev.endDistance) this.endEvent();
        break;
      case 'roadwork':
      case 'checkpoint': {
        ev.barrierZ -= g.player.speed * dt; // barriers are static, so they close at player speed
        const remaining = ev.barrierZ - CAMERA.PLAYER_DEPTH;
        const meters = Math.max(0, Math.round(remaining / 10) * 10);
        ui.updateBanner(meters !== ev.shown ? `${ev.sub} · ${meters}m` : null, clamp(1 - remaining / TRAFFIC.SPAWN_DEPTH, 0, 1));
        ev.shown = meters;
        if (ev.barrierZ + (ev.key === 'roadwork' ? ev.length : 3) < CAMERA.PLAYER_DEPTH - 5) {
          if (!ev.failed) {
            const label = ev.key === 'roadwork' ? 'ROADWORK CLEARED' : 'CHECKPOINT CLEARED';
            g.skills.award(label, ev.cfg.points, 2, PALETTE.GREEN, 26);
            g.audio.perfect();
          }
          this.endEvent();
        }
        break;
      }
      default:
        this.endEvent();
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
        if (!g.traffic.spawnBarrier(BARRIER_ROADWORK, ev.lane, ev.barrierZ, ev.length)) this.endEvent();
        break;
      case 'checkpoint':
        ev.barrierZ = TRAFFIC.SPAWN_DEPTH;
        for (let l = 0; l < ROAD.LANES; l++) if (l !== ev.lane) g.traffic.spawnBarrier(BARRIER_CHECKPOINT, l, ev.barrierZ, 3, ev.lane);
        break;
      default:
        break;
    }
  }

  endEvent() {
    const g = this.game;
    g.traffic.densityScale = 1;
    this.scoreBonus = 1;
    if (this.current && this.current.key === 'rainstorm') g.weather.setOverride(null);
    this.current = null;
    this.nextAt = this.distance + rand(EVENTS.GAP[0], EVENTS.GAP[1]);
    if (!this.police.active) g.ui.hideBanner();
  }

  onCrash() {
    if (this.current) this.current.failed = true;
    if (this.police.active) this.police.gap -= POLICE.CRASH_GAP_LOSS;
  }

  // ---------------------------------------------------------------- police

  updatePolice(dt) {
    const g = this.game;
    const p = this.police;
    if (!p.active) {
      if (this.current || this.distance < p.cooldownUntil) return;
      const hot = g.player.speed * 3.6 >= g.maxKmh * POLICE.TRIGGER_SPEED_RATIO || g.score.tier >= POLICE.TRIGGER_TIER;
      if (hot && Math.random() < POLICE.CHANCE_PER_SEC * dt) this.startPursuit();
      return;
    }
    // The gap to the police changes continuously with our speed: no teleporting cruisers.
    const policeSpeed = (POLICE.SPEED_RATIO * g.player.profile.topKmh) / 3.6;
    p.gap = Math.min(POLICE.MAX_GAP, p.gap + (g.player.speed - policeSpeed) * dt);
    p.time += dt;
    p.sirenPhase += dt;
    const left = Math.ceil(Math.max(0, POLICE.DURATION - p.time));
    const gap = Math.max(0, Math.round(p.gap / 5) * 5);
    const shown = left * 1000 + gap;
    g.ui.updateBanner(shown !== p.shown ? `ESCAPE IN ${left}s · GAP ${gap}m` : null, p.time / POLICE.DURATION);
    p.shown = shown;
    if (p.gap <= 0) this.endPursuit(false);
    else if (p.time >= POLICE.DURATION) this.endPursuit(true);
  }

  startPursuit() {
    const p = this.police;
    p.active = true;
    p.time = 0;
    p.shown = -1;
    p.gap = POLICE.START_GAP;
    this.game.ui.showBanner('Police pursuit', `SURVIVE ${POLICE.DURATION} SECONDS`, '', 'police');
    this.game.effects.callout('POLICE PURSUIT', '#7f95ff', this.game.camera, 34, 0.3, 1.4);
    this.game.audio.siren(true);
  }

  endPursuit(escaped) {
    const g = this.game;
    const p = this.police;
    const stats = g.score.stats;
    p.active = false;
    p.cooldownUntil = this.distance + POLICE.COOLDOWN;
    stats.longestChase = Math.max(stats.longestChase, Math.round(p.time));
    g.audio.siren(false);
    g.ui.hideBanner();
    if (escaped) {
      stats.policeEscapes++;
      stats.bonusCredits += POLICE.ESCAPE_CREDITS;
      g.score.addBonus(POLICE.ESCAPE_POINTS);
      g.effects.callout(`ESCAPED +${POLICE.ESCAPE_POINTS}`, PALETTE.GREEN, g.camera, 38, 0.3, 1.6);
      g.effects.callout(`+${POLICE.ESCAPE_CREDITS} CREDITS`, PALETTE.GOLD, g.camera, 26, 0.37, 1.6);
      g.audio.escape();
      if (stats.bestMultiplier >= 10) g.save.flags.phantom = true; // the secret car's condition
    } else {
      g.effects.callout('BUSTED', PALETTE.RED, g.camera, 44, 0.3, 1.4);
      g.score.breakCombo();
      const applied = g.player.takeDamage(POLICE.BUSTED_DAMAGE);
      g.effects.flash.damage = 1;
      g.camera.addTrauma(0.5);
      g.audio.crash(0.7);
      g.effects.popAtPlayer(`-${applied} HULL`, PALETTE.RED, g.playerScreen);
      if (g.player.health <= 0) g.beginCrashSequence(1);
    }
  }

  // Glowing marker over the open checkpoint lane so the safe path reads at a glance.
  renderMarkers(ctx, cam, road) {
    const ev = this.current;
    if (!ev || ev.key !== 'checkpoint' || ev.phase !== 'active') return;
    const z = ev.barrierZ;
    if (z < CAMERA.NEAR_CLIP + 1 || z > ROAD.DRAW_DISTANCE) return;
    const s = cam.focal / z;
    const x = cam.cx + (laneCenter(ev.lane) + road.offsetAt(z) - cam.x) * s;
    const y = cam.horizonY + CAMERA.HEIGHT * s;
    const w = ROAD.LANE_WIDTH * 1.4 * s;
    const pulse = 0.7 + 0.3 * Math.sin(this.game.time * 8);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pulse;
    ctx.drawImage(this.game.bank.pickup.repairGlow, x - w / 2, y - w * 0.5, w, w * 0.6);
    ctx.drawImage(this.game.bank.pickup.repairGlow, x - w * 0.3, y - 3.2 * s - w * 0.3, w * 0.6, w * 0.6);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Cruiser in the next lane once it closes within a few meters, plus red/blue light spill.
  renderPolice(ctx, cam, road) {
    const p = this.police;
    if (!p.active) return;
    const g = this.game;
    const proximity = clamp(1 - p.gap / 60, 0, 1);
    const on = (p.sirenPhase * 4) % 1 < 0.5;
    if (proximity > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const r = cam.height * 0.5;
      ctx.globalAlpha = proximity * 0.55;
      ctx.drawImage(on ? g.bank.glow.red : g.bank.glow.blue, -r * 0.6, cam.height - r * 0.9, r * 2, r * 2);
      ctx.drawImage(on ? g.bank.glow.blue : g.bank.glow.red, cam.width - r * 1.4, cam.height - r * 0.9, r * 2, r * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    const rear = CAMERA.PLAYER_DEPTH - p.gap - 2.2;
    if (rear < CAMERA.NEAR_CLIP + 0.4) return;
    const sprite = g.bank.police;
    const s = cam.focal / rear;
    const k = s / sprite.ppm;
    const lane = g.player.x > 0 ? g.player.x - ROAD.LANE_WIDTH : g.player.x + ROAD.LANE_WIDTH;
    const x = cam.cx + (lane + road.offsetAt(rear) - cam.x) * s;
    const y = cam.horizonY + CAMERA.HEIGHT * s;
    ctx.drawImage(sprite.canvas, x - sprite.anchorX * k, y - sprite.anchorY * k, sprite.canvas.width * k, sprite.canvas.height * k);
    ctx.globalCompositeOperation = 'lighter';
    const lr = 0.8 * s;
    const barY = y - 1.45 * s;
    ctx.drawImage(on ? g.bank.glow.red : g.bank.glow.blue, x - 0.5 * s - lr, barY - lr, lr * 2, lr * 2);
    ctx.drawImage(on ? g.bank.glow.blue : g.bank.glow.red, x + 0.5 * s - lr, barY - lr, lr * 2, lr * 2);
    ctx.globalCompositeOperation = 'source-over';
  }
}
