import { ROAD, CAMERA, TRAFFIC, laneCenter } from './config.js';
import { VEHICLE_TYPES, PERSONALITIES, DIFFICULTY, RARE_TRAFFIC } from './balance.js';
import { clamp, lerpRange, rand, randInt, approach, damp } from './utils.js';

const FULL_MASK = (1 << ROAD.LANES) - 1;
const TYPE_KEYS = Object.keys(VEHICLE_TYPES);

export const BARRIER_ROADWORK = 'roadwork';
export const BARRIER_CHECKPOINT = 'checkpoint';

class Vehicle {
  constructor() {
    this.kind = 'vehicle';
    this.active = false;
    this.typeKey = '';
    this.spec = null;
    this.personality = PERSONALITIES.normal;
    this.personalityKey = 'normal';
    this.sprites = null;
    this.width = 0;
    this.length = 0;
    this.x = 0;
    this.z = 0; // camera depth of the vehicle's center
    this.sortZ = 0;
    this.lane = 0;
    this.targetLane = 0;
    this.pendingLane = -1;
    this.speed = 0;
    this.baseSpeed = 0;
    this.braking = false;
    this.blinkTimer = 0;
    this.blinkDir = 0;
    this.changeCooldown = 0;
    this.tapTimer = 0;
    this.kickX = 0;
    this.wobble = 0;
    this.hit = false;
    this.prevRel = 0;
    this.minGap = Infinity; // closest lateral gap to the player while alongside
    this.lineupAt = -1; // game time when last directly in the player's path at close range
    this.patternSlot = -1;
    this.rare = false;
    this.barrier = null; // static road obstacle style, or null for a driving vehicle
    this.openLane = -1; // checkpoint: the lane left open (for rendering the green marker)
  }
}

const occupies = (car, lane) => car.lane === lane || car.targetLane === lane;

export class TrafficManager {
  constructor(bank) {
    this.bank = bank;
    this.pool = Array.from({ length: TRAFFIC.MAX_VEHICLES }, () => new Vehicle());
    this.vehicles = [];
    this.laneOrder = Array.from({ length: ROAD.LANES }, (_, i) => i);
    this.typeWeights = new Float32Array(TYPE_KEYS.length);
    this.personalityKeys = Object.keys(PERSONALITIES);
    this.personalityWeights = new Float32Array(this.personalityKeys.length);
    this.patterns = Array.from({ length: TRAFFIC.PATTERN_SLOTS }, () => ({ active: false, remaining: 0, failed: false }));
    this.onPass = null;
    this.onPatternDone = null;
    this.spawnEnabled = false;
    this.densityScale = 1; // >1 spawns more often (heavy traffic), <1 less (open highway)
    this.untilWave = 0;
    this.wallCheckTimer = 0;
    this.band = TRAFFIC.WALL_BAND;
    this.playerX = 0;
    this.time = 0;
  }

  reset() {
    for (let i = 0; i < this.pool.length; i++) this.pool[i].active = false;
    for (let i = 0; i < this.patterns.length; i++) this.patterns[i].active = false;
    this.vehicles.length = 0;
    this.spawnEnabled = false;
    this.densityScale = 1;
    this.untilWave = TRAFFIC.FIRST_WAVE_DISTANCE;
    this.wallCheckTimer = 0;
  }

  update(dt, playerSpeed, traveled, difficulty, playerX) {
    this.time += dt;
    this.playerX = playerX;
    // Length of road that must never be fully blocked: grows with closing speed so walls stay escapable.
    this.band = TRAFFIC.WALL_BAND + Math.max(8, playerSpeed - 25) * lerpRange(DIFFICULTY.SAFE_TIME, difficulty);
    const laneChangeRate = lerpRange(DIFFICULTY.LANE_CHANGE, difficulty);
    const list = this.vehicles;

    for (let i = 0; i < list.length; i++) {
      const car = list[i];
      if (car.barrier) this.updateBarrier(car, dt, playerSpeed);
      else this.updateVehicle(car, dt, playerSpeed, laneChangeRate);
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const car = list[i];
      const rel = car.z - CAMERA.PLAYER_DEPTH;
      if (car.prevRel > 0 && rel <= 0 && this.onPass && !car.barrier) this.onPass(car);
      car.prevRel = rel;
      if (car.z < TRAFFIC.DESPAWN_BEHIND || car.z > ROAD.DRAW_DISTANCE + TRAFFIC.DESPAWN_AHEAD + car.length) this.despawn(i);
    }

    if (!this.spawnEnabled) return;
    this.untilWave -= traveled * this.densityScale;
    if (this.untilWave <= 0) {
      this.spawnWave(difficulty, playerSpeed);
      this.untilWave = lerpRange(DIFFICULTY.SPAWN_GAP, difficulty) * rand(0.7, 1.3);
    }
    this.wallCheckTimer -= dt;
    if (this.wallCheckTimer <= 0) {
      this.wallCheckTimer = TRAFFIC.WALL_CHECK_INTERVAL;
      this.breakWalls();
    }
  }

  updateBarrier(car, dt, playerSpeed) {
    car.z -= playerSpeed * dt;
    car.sortZ = car.z - car.length * 0.5;
  }

  updateVehicle(car, dt, playerSpeed, laneChangeRate) {
    const pers = car.personality;
    const leader = this.findLeader(car);
    let target = car.baseSpeed;
    if (car.tapTimer > 0) {
      car.tapTimer -= dt;
      target *= 0.65;
    } else if (pers.brakeTaps && car.z - CAMERA.PLAYER_DEPTH > TRAFFIC.BRAKE_TAP_MIN_DEPTH && Math.random() < TRAFFIC.BRAKE_TAP_RATE * dt) {
      car.tapTimer = TRAFFIC.BRAKE_TAP_TIME;
    }
    if (leader) {
      const gap = leader.z - leader.length * 0.5 - (car.z + car.length * 0.5);
      if (gap < pers.follow) {
        target = Math.min(target, leader.speed - (pers.follow - gap) * 0.3);
        if (gap < 4) target = Math.min(target, leader.speed - 3);
      }
    }
    if (target < 0) target = 0;
    car.braking = target < car.speed - 0.4;
    car.speed = approach(car.speed, target, (target < car.speed ? TRAFFIC.BRAKE_DECEL : TRAFFIC.ACCEL) * dt);

    this.updateLaneChange(car, dt, leader, laneChangeRate);

    const dx = laneCenter(car.targetLane) - car.x;
    const step = TRAFFIC.LANE_CHANGE_SPEED * dt;
    car.x += (dx > step ? step : dx < -step ? -step : dx) + car.kickX * dt;
    car.kickX = damp(car.kickX, 0, 3, dt);
    car.x = clamp(car.x, -ROAD.HALF_WIDTH + car.width / 2, ROAD.HALF_WIDTH - car.width / 2);
    if (car.targetLane !== car.lane && Math.abs(dx) < 0.05) car.lane = car.targetLane;
    if (car.wobble > 0) car.wobble = Math.max(0, car.wobble - dt * 1.4);

    car.z += (car.speed - playerSpeed) * dt;
    car.sortZ = car.z - car.length * 0.5;
  }

  updateLaneChange(car, dt, leader, rate) {
    if (car.changeCooldown > 0) car.changeCooldown -= dt;
    const depth = car.z - CAMERA.PLAYER_DEPTH;

    if (car.blinkTimer > 0) {
      car.blinkTimer -= dt;
      if (car.blinkTimer <= 0) {
        // Re-validate after signalling: never cut in close to the player or into a filled lane.
        if (depth > TRAFFIC.LANE_CHANGE_MIN_DEPTH && this.canMoveTo(car, car.pendingLane)) car.targetLane = car.pendingLane;
        else car.blinkDir = 0;
        car.pendingLane = -1;
      }
      return;
    }
    if (car.targetLane !== car.lane) return;
    car.blinkDir = 0;
    if (car.changeCooldown > 0) return;

    // Cars stuck behind a road barrier merge as soon as it's fair; everyone else only far ahead.
    const barrierAhead = leader !== null && leader.barrier !== null && leader.z - car.z < 140;
    if (depth < (barrierAhead ? TRAFFIC.LANE_CHANGE_MIN_DEPTH + 10 : TRAFFIC.LANE_CHANGE_START_DEPTH)) return;
    const willing = car.personality.laneChange;
    if (willing <= 0 && !barrierAhead) return;

    const blocked = leader !== null
      && leader.z - car.z < car.personality.follow + car.length + 6
      && leader.speed < car.baseSpeed - 2;
    if (!barrierAhead && !blocked && Math.random() >= rate * willing * dt) return;

    car.changeCooldown = barrierAhead ? 0.6 : rand(2.5, 6);
    let dir = Math.random() < 0.5 ? -1 : 1;
    if (!this.canMoveTo(car, car.lane + dir)) dir = -dir;
    if (!this.canMoveTo(car, car.lane + dir)) return;
    car.pendingLane = car.lane + dir;
    car.blinkDir = dir;
    car.blinkTimer = Math.max(TRAFFIC.MIN_BLINK_TIME, car.personality.blink);
  }

  findLeader(car) {
    let best = null;
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      const other = list[i];
      if (other === car || other.z <= car.z) continue;
      if (!occupies(other, car.lane) && !occupies(other, car.targetLane)) continue;
      if (best === null || other.z < best.z) best = other;
    }
    return best;
  }

  // Bitmask of lanes occupied by any vehicle within `band` meters of depth z.
  laneMask(z, band, exclude) {
    let mask = 0;
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      const other = list[i];
      if (other === exclude) continue;
      if (Math.abs(other.z - z) < band + other.length * 0.5) mask |= (1 << other.lane) | (1 << other.targetLane);
    }
    return mask;
  }

  canMoveTo(car, lane) {
    if (lane < 0 || lane >= ROAD.LANES) return false;
    // Fairness: no merging into the lane the player is driving in unless far away.
    if (car.z - CAMERA.PLAYER_DEPTH < TRAFFIC.PLAYER_LANE_GUARD_DEPTH
      && Math.abs(laneCenter(lane) - this.playerX) < ROAD.LANE_WIDTH * 0.8) return false;
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      const other = list[i];
      if (other === car || !occupies(other, lane)) continue;
      if (Math.abs(other.z - car.z) < (other.length + car.length) * 0.5 + TRAFFIC.CHANGE_CLEARANCE) return false;
    }
    return (this.laneMask(car.z, this.band, car) | (1 << car.lane) | (1 << lane)) !== FULL_MASK;
  }

  canPlace(lane, z, length) {
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      const other = list[i];
      if (!occupies(other, lane)) continue;
      if (Math.abs(other.z - z) < (other.length + length) * 0.5 + TRAFFIC.SPAWN_CLEARANCE) return false;
    }
    return (this.laneMask(z, this.band, null) | (1 << lane)) !== FULL_MASK;
  }

  isLaneClear(lane, z, behind, ahead) {
    const list = this.vehicles;
    for (let i = 0; i < list.length; i++) {
      const car = list[i];
      if (occupies(car, lane) && car.z + car.length * 0.5 > z - behind && car.z - car.length * 0.5 < z + ahead) return false;
    }
    return true;
  }

  spawnWave(difficulty, playerSpeed) {
    if (playerSpeed < TRAFFIC.MIN_PLAYER_SPEED) return;
    const spawnZ = TRAFFIC.SPAWN_DEPTH;

    if (difficulty > RARE_TRAFFIC.MIN_DIFFICULTY && Math.random() < RARE_TRAFFIC.CHANCE) {
      this.shuffleLanes();
      for (let k = 0; k < ROAD.LANES; k++) if (this.trySpawn('legend', this.laneOrder[k], spawnZ, difficulty, -1)) return;
    }

    if (difficulty > DIFFICULTY.PATTERN_MIN && Math.random() < DIFFICULTY.PATTERN_CHANCE) {
      this.spawnChicane(difficulty, spawnZ);
      return;
    }

    const maxCars = lerpRange(DIFFICULTY.MAX_PER_WAVE, difficulty) * Math.min(1.3, this.densityScale);
    const count = Math.min(ROAD.LANES - 1, 1 + Math.floor(Math.random() * maxCars));
    this.shuffleLanes();
    for (let k = 0; k < count; k++) {
      this.trySpawn(this.pickType(difficulty), this.laneOrder[k], spawnZ + rand(0, TRAFFIC.SPAWN_JITTER), difficulty, -1);
    }
  }

  // Staggered diagonal across three lanes: forces a weave, always leaves the fourth lane open.
  // Clearing every car in it cleanly pays a chicane bonus.
  spawnChicane(difficulty, spawnZ) {
    let slot = -1;
    for (let i = 0; i < this.patterns.length; i++) {
      if (!this.patterns[i].active) {
        slot = i;
        break;
      }
    }
    const dir = Math.random() < 0.5 ? 1 : -1;
    const start = dir > 0 ? randInt(0, ROAD.LANES - 3) : randInt(2, ROAD.LANES - 1);
    let placed = 0;
    for (let k = 0; k < 3; k++) {
      if (this.trySpawn(this.pickType(difficulty), start + k * dir, spawnZ + k * TRAFFIC.PATTERN_SPACING, difficulty, slot)) placed++;
    }
    if (slot >= 0 && placed >= 2) {
      const p = this.patterns[slot];
      p.active = true;
      p.remaining = placed;
      p.failed = false;
    } else if (slot >= 0) {
      for (let i = 0; i < this.vehicles.length; i++) if (this.vehicles[i].patternSlot === slot) this.vehicles[i].patternSlot = -1;
    }
  }

  // Called by the game when a pattern car is passed or hit. Returns true when a pattern is cleared cleanly.
  resolvePattern(car, failed) {
    const slot = car.patternSlot;
    if (slot < 0) return false;
    car.patternSlot = -1;
    const p = this.patterns[slot];
    if (!p.active) return false;
    if (failed) p.failed = true;
    p.remaining--;
    if (p.remaining > 0) return false;
    p.active = false;
    return !p.failed;
  }

  trySpawn(typeKey, lane, z, difficulty, patternSlot) {
    const spec = VEHICLE_TYPES[typeKey];
    if (!this.canPlace(lane, z, spec.length)) return false;
    const car = this.acquire();
    if (!car) return false;
    const variants = this.bank.vehicles[typeKey];
    const pKey = this.pickPersonality(spec, difficulty);
    car.active = true;
    car.typeKey = typeKey;
    car.spec = spec;
    car.personalityKey = pKey;
    car.personality = PERSONALITIES[pKey];
    car.sprites = variants[(Math.random() * variants.length) | 0];
    car.width = spec.width;
    car.length = spec.length;
    car.lane = lane;
    car.targetLane = lane;
    car.pendingLane = -1;
    car.x = laneCenter(lane);
    car.z = z;
    car.sortZ = z - spec.length * 0.5;
    const kmh = rand(spec.speedKmh[0], spec.speedKmh[1]) * car.personality.speedMult * lerpRange(DIFFICULTY.TRAFFIC_SPEED, difficulty);
    car.speed = Math.max(TRAFFIC.MIN_SPEED_KMH, kmh) / 3.6;
    car.baseSpeed = car.speed;
    this.resetState(car, z);
    car.patternSlot = patternSlot;
    car.rare = typeKey === 'legend';
    this.vehicles.push(car);
    return true;
  }

  resetState(car, z) {
    car.braking = false;
    car.blinkTimer = 0;
    car.blinkDir = 0;
    car.changeCooldown = rand(1, 3);
    car.tapTimer = 0;
    car.kickX = 0;
    car.wobble = 0;
    car.hit = false;
    car.prevRel = z - CAMERA.PLAYER_DEPTH;
    car.minGap = Infinity;
    car.lineupAt = -1;
    car.patternSlot = -1;
    car.rare = false;
    car.barrier = null;
    car.openLane = -1;
  }

  // Static obstacle occupying one lane over `length` meters (road events). Ignores the wall rule
  // on purpose: callers guarantee an open lane.
  spawnBarrier(style, lane, z, length, openLane = -1) {
    const car = this.acquire();
    if (!car) return false;
    car.active = true;
    car.typeKey = style;
    car.spec = null;
    car.personality = PERSONALITIES.normal;
    car.sprites = null;
    car.width = ROAD.LANE_WIDTH * 0.8;
    car.length = length;
    car.lane = lane;
    car.targetLane = lane;
    car.pendingLane = -1;
    car.x = laneCenter(lane);
    car.z = z + length * 0.5;
    car.sortZ = z;
    car.speed = 0;
    car.baseSpeed = 0;
    this.resetState(car, car.z);
    car.barrier = style;
    car.openLane = openLane;
    this.vehicles.push(car);
    return true;
  }

  // Vehicles at different speeds can drift into a lane-wide wall; nudge the nearest one back out.
  breakWalls() {
    const list = this.vehicles;
    const band = this.band * 0.8;
    for (let i = 0; i < list.length; i++) {
      const car = list[i];
      if (car.z - CAMERA.PLAYER_DEPTH < TRAFFIC.WALL_FIX_MIN_DEPTH) continue;
      if (this.laneMask(car.z, band, null) !== FULL_MASK) continue;
      let nearest = null;
      for (let j = 0; j < list.length; j++) {
        const other = list[j];
        if (other.barrier || Math.abs(other.z - car.z) >= band + other.length * 0.5) continue;
        if (nearest === null || other.z < nearest.z) nearest = other;
      }
      if (nearest) nearest.baseSpeed = Math.max(TRAFFIC.MIN_SPEED_KMH / 3.6, nearest.baseSpeed * 0.85);
      return;
    }
  }

  pickType(difficulty) {
    let total = 0;
    for (let i = 0; i < TYPE_KEYS.length; i++) {
      const w = lerpRange(VEHICLE_TYPES[TYPE_KEYS[i]].weight, difficulty);
      this.typeWeights[i] = w;
      total += w;
    }
    let r = Math.random() * total;
    for (let i = 0; i < TYPE_KEYS.length; i++) {
      r -= this.typeWeights[i];
      if (r <= 0 && this.typeWeights[i] > 0) return TYPE_KEYS[i];
    }
    return TYPE_KEYS[0];
  }

  pickPersonality(spec, difficulty) {
    const keys = this.personalityKeys;
    let total = 0;
    for (let i = 0; i < keys.length; i++) {
      const affinity = spec.personalities[keys[i]] || 0;
      const w = affinity * lerpRange(PERSONALITIES[keys[i]].weight, difficulty);
      this.personalityWeights[i] = w;
      total += w;
    }
    let r = Math.random() * total;
    for (let i = 0; i < keys.length; i++) {
      r -= this.personalityWeights[i];
      if (r <= 0 && this.personalityWeights[i] > 0) return keys[i];
    }
    return 'normal';
  }

  shuffleLanes() {
    const a = this.laneOrder;
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  }

  acquire() {
    for (let i = 0; i < this.pool.length; i++) if (!this.pool[i].active) return this.pool[i];
    return null;
  }

  despawn(index) {
    const list = this.vehicles;
    const car = list[index];
    // A pattern car that leaves without being passed can no longer be "cleared".
    if (car.patternSlot >= 0) this.resolvePattern(car, true);
    car.active = false;
    list[index] = list[list.length - 1];
    list.pop();
  }

  drawVehicle(ctx, car, cam, road) {
    if (car.barrier) {
      this.drawBarrier(ctx, car, cam, road);
      return;
    }
    const rear = car.z - car.length * 0.5;
    if (rear < CAMERA.NEAR_CLIP + 0.3 || rear > ROAD.DRAW_DISTANCE) return;
    const s = cam.focal / rear;
    const sprite = car.braking ? car.sprites.brake : car.sprites.normal;
    const k = s / sprite.ppm;
    const w = sprite.canvas.width * k;
    const h = sprite.canvas.height * k;
    const sx = cam.cx + (car.x + road.offsetAt(rear) - cam.x) * s;
    if (sx + w < 0 || sx - w > cam.width) return;
    const sy = cam.horizonY + CAMERA.HEIGHT * s;
    const fadeStart = road.fadeStart;
    ctx.globalAlpha = rear > fadeStart ? Math.max(0, 1 - (rear - fadeStart) / (ROAD.DRAW_DISTANCE - fadeStart)) : 1;

    if (car.wobble > 0) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.sin(car.wobble * 18) * car.wobble * 0.12);
      ctx.drawImage(sprite.canvas, -sprite.anchorX * k, -sprite.anchorY * k, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(sprite.canvas, sx - sprite.anchorX * k, sy - sprite.anchorY * k, w, h);
    }

    const L = sprite.lights;
    if (car.rare) {
      // Golden car shimmer so rare traffic reads from far away.
      ctx.globalCompositeOperation = 'lighter';
      const r = Math.max(6, 1.8 * s) * (1 + 0.25 * Math.sin(this.time * 7));
      ctx.drawImage(this.bank.glow.gold, sx - r, sy - car.spec.height * s - r * 0.6, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (car.blinkDir !== 0 && (this.time * 3.2) % 1 < 0.5) {
      const lx = car.blinkDir < 0 ? (L.lx0 + L.lx1) / 2 : (L.rx0 + L.rx1) / 2;
      const gx = sx + (lx - sprite.anchorX) * k;
      const gy = sy + (L.y - sprite.anchorY) * k;
      const r = Math.max(4, 0.9 * s);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.bank.glow.amber, gx - r, gy - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // Road barriers: a line of cones (roadwork) or a striped gate with flashing lights (checkpoint).
  drawBarrier(ctx, car, cam, road) {
    const rear = car.z - car.length * 0.5;
    const front = car.z + car.length * 0.5;
    const near = Math.max(rear, CAMERA.NEAR_CLIP + 0.5);
    const far = Math.min(front, ROAD.DRAW_DISTANCE);
    if (near >= far) return;
    const fadeStart = road.fadeStart;
    const flash = (this.time * 2.5) % 1 < 0.5;

    if (car.barrier === BARRIER_ROADWORK) {
      const cone = this.bank.props.cone;
      const step = 6;
      // Iterate far → near so nearer cones overlap farther ones.
      const first = rear + Math.ceil((far - rear) / step) * step;
      for (let z = Math.min(first, far); z >= near; z -= step) {
        const s = cam.focal / z;
        const x = cam.cx + (car.x + road.offsetAt(z) - cam.x) * s;
        const y = cam.horizonY + CAMERA.HEIGHT * s;
        const cw = 0.7 * s;
        const ch = cw * (cone.height / cone.width);
        ctx.globalAlpha = z > fadeStart ? Math.max(0, 1 - (z - fadeStart) / (ROAD.DRAW_DISTANCE - fadeStart)) : 1;
        for (let o = -1; o <= 1; o += 2) ctx.drawImage(cone, x + o * 0.9 * s - cw / 2, y - ch, cw, ch);
      }
      if (rear >= near) {
        const s = cam.focal / rear;
        const x = cam.cx + (car.x + road.offsetAt(rear) - cam.x) * s;
        const y = cam.horizonY + CAMERA.HEIGHT * s;
        const sign = this.bank.props.arrowSign;
        const sw = 2.4 * s;
        const sh = sw * (sign.height / sign.width);
        ctx.globalAlpha = rear > fadeStart ? Math.max(0, 1 - (rear - fadeStart) / (ROAD.DRAW_DISTANCE - fadeStart)) : 1;
        ctx.drawImage(sign, x - sw / 2, y - sh, sw, sh);
        if (flash) {
          ctx.globalCompositeOperation = 'lighter';
          const r = 1.1 * s;
          ctx.drawImage(this.bank.glow.amber, x - sw * 0.35 - r, y - sh - r * 0.5, r * 2, r * 2);
          ctx.drawImage(this.bank.glow.amber, x + sw * 0.35 - r, y - sh - r * 0.5, r * 2, r * 2);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    } else if (rear >= near) {
      const s = cam.focal / rear;
      const x = cam.cx + (car.x + road.offsetAt(rear) - cam.x) * s;
      const y = cam.horizonY + CAMERA.HEIGHT * s;
      const gate = this.bank.props.gate;
      const gw = ROAD.LANE_WIDTH * 0.95 * s;
      const gh = gw * (gate.height / gate.width);
      ctx.globalAlpha = rear > fadeStart ? Math.max(0, 1 - (rear - fadeStart) / (ROAD.DRAW_DISTANCE - fadeStart)) : 1;
      ctx.drawImage(gate, x - gw / 2, y - gh, gw, gh);
      ctx.globalCompositeOperation = 'lighter';
      const r = 1.2 * s;
      ctx.drawImage(flash ? this.bank.glow.red : this.bank.glow.blue, x - gw * 0.4 - r, y - gh - r * 0.3, r * 2, r * 2);
      ctx.drawImage(flash ? this.bank.glow.blue : this.bank.glow.red, x + gw * 0.4 - r, y - gh - r * 0.3, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }
}
