import { ROAD, CAMERA, PICKUP_GEOMETRY as GEO, laneCenter } from './config.js';
import { PICKUPS } from './balance.js';
import { rand, randInt } from './utils.js';

export const PICKUP_BOOST = 'boost';
export const PICKUP_REPAIR = 'repair';
export const PICKUP_CREDITS = 'credits';

class Pickup {
  constructor() {
    this.kind = 'pickup';
    this.active = false;
    this.type = PICKUP_BOOST;
    this.x = 0;
    this.z = 0;
    this.sortZ = 0;
    this.bob = 0;
  }
}

// Pickups are stationary on the road, so they approach at the player's full speed.
export class PickupManager {
  constructor(bank) {
    this.bank = bank;
    this.pool = Array.from({ length: PICKUPS.MAX }, () => new Pickup());
    this.untilNext = 0;
    this.creditChance = 0; // rare bonus chip chance per spawn, set by the game
  }

  reset() {
    for (let i = 0; i < this.pool.length; i++) this.pool[i].active = false;
    this.untilNext = rand(PICKUPS.INTERVAL[0], PICKUPS.INTERVAL[1]) * 0.5;
  }

  update(dt, playerSpeed, traveled, traffic, spawning, damaged) {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.z -= playerSpeed * dt;
      p.sortZ = p.z;
      p.bob += dt;
      if (p.z < -10) p.active = false;
    }
    if (!spawning) return;
    this.untilNext -= traveled;
    if (this.untilNext > 0) return;
    this.untilNext = this.spawn(traffic, damaged) ? rand(PICKUPS.INTERVAL[0], PICKUPS.INTERVAL[1]) : PICKUPS.RETRY_DISTANCE;
  }

  spawn(traffic, damaged) {
    let slot = null;
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) {
        slot = this.pool[i];
        break;
      }
    }
    if (!slot) return false;
    const z = GEO.SPAWN_DEPTH;
    const start = randInt(0, ROAD.LANES - 1);
    for (let k = 0; k < ROAD.LANES; k++) {
      const lane = (start + k) % ROAD.LANES;
      if (!traffic.isLaneClear(lane, z, GEO.CLEAR_BEHIND, GEO.CLEAR_AHEAD)) continue;
      slot.active = true;
      if (Math.random() < this.creditChance) slot.type = PICKUP_CREDITS;
      else slot.type = damaged && Math.random() < PICKUPS.REPAIR_CHANCE ? PICKUP_REPAIR : PICKUP_BOOST;
      slot.x = laneCenter(lane);
      slot.z = z;
      slot.sortZ = z;
      slot.bob = Math.random() * 10;
      return true;
    }
    return false;
  }

  collect(player, onCollect) {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      if (Math.abs(p.z - CAMERA.PLAYER_DEPTH) < GEO.COLLECT_Z && Math.abs(p.x - player.x) < GEO.COLLECT_X) {
        p.active = false;
        onCollect(p.type);
      }
    }
  }

  draw(ctx, p, cam, road) {
    const z = p.z;
    if (z < CAMERA.NEAR_CLIP + 1 || z > ROAD.DRAW_DISTANCE) return;
    const s = cam.focal / z;
    const x = cam.cx + (p.x + road.offsetAt(z) - cam.x) * s;
    const groundY = cam.horizonY + CAMERA.HEIGHT * s;
    const size = GEO.SIZE * s;
    const hover = (GEO.HOVER + Math.sin(p.bob * 3) * 0.15) * s;
    const fadeStart = road.fadeStart;
    const fade = z > fadeStart ? Math.max(0, 1 - (z - fadeStart) / (ROAD.DRAW_DISTANCE - fadeStart)) : 1;
    const art = this.bank.pickup;
    const icon = p.type === PICKUP_BOOST ? art.boost : p.type === PICKUP_REPAIR ? art.repair : art.credits;
    const glow = p.type === PICKUP_BOOST ? art.boostGlow : p.type === PICKUP_REPAIR ? art.repairGlow : art.creditsGlow;

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6 * fade;
    const gw = size * 1.6;
    ctx.drawImage(glow, x - gw / 2, groundY - gw * 0.15, gw, gw * 0.3);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = fade;
    const pulse = size * (1 + Math.sin(p.bob * 6) * 0.06);
    ctx.drawImage(icon, x - pulse / 2, groundY - hover - pulse, pulse, pulse);
    ctx.globalAlpha = 1;
  }
}
