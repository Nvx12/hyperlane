import { ROAD, CAMERA, TRAFFIC, laneCenter } from './config.js';
import { RIVAL } from './balance.js';
import { clamp, approach, rand } from './utils.js';
import { PRIORITY } from './BonusFeed.js';

const laneOf = x => clamp(Math.round((x + ROAD.HALF_WIDTH) / ROAD.LANE_WIDTH - 0.5), 0, ROAD.LANES - 1);

// A rival racer: a mini race inside the endless run. It comes up from behind (engine note,
// rear warning), passes you, and the duel starts: be ahead of it when the clock runs out.
// It plays by your rules — your top speed plus short boost bursts, slowed by traffic, lane
// changes signalled — so it can be beaten by driving, never by exploiting it.
export class RivalRacer {
  constructor(game) {
    this.game = game;
    this.car = null;
    this.state = 'idle';
  }

  get active() {
    return this.state !== 'idle';
  }

  reset() {
    this.car = null;
    this.state = 'idle';
  }

  start() {
    const g = this.game;
    const player = laneOf(g.player.x);
    const lanes = [player + 1, player - 1, player + 2, player - 2].filter(l => l >= 0 && l < ROAD.LANES);
    for (const lane of lanes) {
      const car = g.traffic.spawnUnit({
        typeKey: 'rival', sprites: g.bank.rival, width: 2.0, length: 4.5, lane,
        z: CAMERA.PLAYER_DEPTH - 34, speed: g.player.speed + 8, controller: this, role: 'rival',
        label: RIVAL.NAMES[Math.floor(Math.random() * RIVAL.NAMES.length)],
      });
      if (car) {
        car.ai = { boost: 0, boostCooldown: rand(3, 6), lineCooldown: 4 };
        this.car = car;
        this.state = 'arriving';
        this.label = car.label;
        this.lostBehind = false;
        this.timer = RIVAL.DURATION;
        this.shown = '';
        g.ui.showBanner('Rival', `${car.label} IS COMING`, 'Get ahead and stay ahead', 'good');
        g.audio.rivalAlert();
        g.telemetry.push({ t: g.runTime, what: `rival:start:${car.label}` });
        return true;
      }
    }
    return false;
  }

  // Duel bookkeeping (called every frame by EventDirector while the rival event runs).
  update(dt) {
    const g = this.game;
    const car = this.car;
    if (!car || !car.active) {
      this.finish(this.state === 'duel');
      return;
    }
    const dz = car.z - CAMERA.PLAYER_DEPTH;
    if (this.state === 'arriving' && dz > -6) {
      this.state = 'duel';
      g.ui.feed.push(`RIVAL ${car.label}`, 0, PRIORITY.IMPORTANT, 'violet', 'rival');
    }
    if (this.state !== 'duel') return;
    this.timer -= dt;
    const lead = Math.round(-dz);
    const text = `${lead >= 0 ? 'AHEAD' : 'BEHIND'} ${Math.abs(lead)}m · ${Math.ceil(Math.max(0, this.timer))}s`;
    if (text !== this.shown) {
      this.shown = text;
      g.ui.updateBanner(text, clamp(1 - this.timer / RIVAL.DURATION, 0, 1));
    }
    if (this.timer <= 0) this.finish(true);
  }

  finish(timedOut) {
    const g = this.game;
    const car = this.car;
    if (this.state === 'idle') return;
    // Won: it is behind you at the end — or it fell so far behind that it left the road.
    const won = timedOut && (car && car.active ? car.z < CAMERA.PLAYER_DEPTH - 1 : this.lostBehind);
    if (won) {
      g.score.addBonus(RIVAL.POINTS);
      g.score.stats.rivalsBeaten++;
      g.player.addBoost(30);
      g.ui.feed.push(`BEAT ${this.label}`, RIVAL.POINTS, PRIORITY.MAJOR, 'good', 'rival');
      g.audio.escape();
    } else if (timedOut) {
      g.ui.feed.push(`${this.label} WINS`, 0, PRIORITY.IMPORTANT, 'danger', 'rival');
    }
    g.telemetry.push({ t: g.runTime, what: `rival:${won ? 'won' : 'lost'}` });
    if (car && car.active) car.role = 'leaving';
    this.state = 'idle';
    this.car = null;
    g.ui.hideBanner();
  }

  onDespawn(car) {
    if (car !== this.car) return;
    this.lostBehind = car.z < CAMERA.PLAYER_DEPTH;
    this.car = null;
  }

  updateUnit(car, dt, playerSpeed) {
    const g = this.game;
    const ai = car.ai;
    const dz = car.z - CAMERA.PLAYER_DEPTH;
    const top = g.maxKmh / 3.6 * RIVAL.SPEED_RATIO;
    ai.boostCooldown -= dt;
    ai.lineCooldown -= dt;
    if (ai.boost > 0) ai.boost -= dt;
    else if (ai.boostCooldown <= 0 && (dz < 30 || Math.random() < 0.3)) {
      ai.boost = RIVAL.BOOST_TIME;
      ai.boostCooldown = rand(RIVAL.BOOST_COOLDOWN[0], RIVAL.BOOST_COOLDOWN[1]);
    }
    let target;
    if (car.role === 'leaving') target = playerSpeed * 0.6;
    else if (this.state === 'arriving') target = playerSpeed + 8;
    else target = top + (ai.boost > 0 ? RIVAL.BOOST_KMH / 3.6 : 0);

    // Weave through traffic like a racer: find a free lane before braking.
    const leader = g.traffic.findLeader(car);
    if (leader) {
      const gap = leader.z - leader.length * 0.5 - (car.z + car.length * 0.5);
      if (gap < 30 && car.targetLane === car.lane) {
        const player = laneOf(g.player.x);
        for (const dir of Math.random() < 0.5 ? [-1, 1] : [1, -1]) {
          const lane = car.lane + dir;
          if (lane < 0 || lane >= ROAD.LANES) continue;
          if (lane === player && Math.abs(dz) < 10) continue;
          if (g.traffic.isLaneClear(lane, car.z, car.length + 6, car.length + 16)) {
            car.targetLane = lane;
            car.blinkDir = dir;
            break;
          }
        }
      }
      if (gap < 16) target = Math.min(target, leader.speed - (16 - gap) * 0.3);
    }
    // Now and then it takes your line — only well ahead of you, signalled.
    const player = laneOf(g.player.x);
    if (this.state === 'duel' && ai.lineCooldown <= 0 && dz > 14 && dz < 40 && car.lane !== player
      && Math.abs(car.lane - player) === 1 && car.targetLane === car.lane
      && g.traffic.isLaneClear(player, car.z, car.length + 6, car.length + 12)) {
      car.targetLane = player;
      car.blinkDir = Math.sign(player - car.lane);
      ai.lineCooldown = rand(6, 10);
    }
    car.braking = target < car.speed - 0.5;
    car.speed = approach(car.speed, Math.max(0, target), (target > car.speed ? 8 : 12) * dt);
    const dx = laneCenter(car.targetLane) - car.x;
    const step = TRAFFIC.LANE_CHANGE_SPEED * 1.7 * dt;
    car.x += (dx > step ? step : dx < -step ? -step : dx) + car.kickX * dt;
    car.kickX *= Math.max(0, 1 - 3 * dt);
    car.x = clamp(car.x, -ROAD.HALF_WIDTH + car.width / 2, ROAD.HALF_WIDTH - car.width / 2);
    if (car.targetLane !== car.lane && Math.abs(dx) < 0.05) {
      car.lane = car.targetLane;
      car.blinkDir = 0;
    }
    if (car.wobble > 0) car.wobble = Math.max(0, car.wobble - dt * 1.4);
    car.z += (car.speed - playerSpeed) * dt;
    car.sortZ = car.z - car.length * 0.5;
  }
}
