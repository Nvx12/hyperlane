import { PLAYER, ROAD, CAMERA, laneCenter } from './config.js';
import { BOOST, SLIPSTREAM, DAMAGE, DEFAULT_CAR_PROFILE } from './balance.js';
import { clamp, damp, lerp } from './utils.js';

// Arcade handling driven entirely by a car profile (top speed, acceleration, grip, brakes, boost,
// durability), so every garage car and upgrade changes how the car actually drives.
export class Player {
  constructor() {
    this.kind = 'player';
    this.profile = { ...DEFAULT_CAR_PROFILE };
    this.sortZ = CAMERA.PLAYER_DEPTH - this.profile.length / 2;
    this.grip = 1; // weather traction multiplier (1 = dry)
    this.reset();
  }

  setProfile(profile) {
    this.profile = profile;
    this.sortZ = CAMERA.PLAYER_DEPTH - profile.length / 2;
  }

  reset() {
    this.x = laneCenter(1);
    this.vx = 0;
    this.speed = PLAYER.START_KMH / 3.6;
    this.health = PLAYER.MAX_HEALTH;
    this.boost = BOOST.START;
    this.boosting = false;
    this.boostStarted = false;
    this.boostTime = 0;
    this.throttle = 0;
    this.braking = false;
    this.invulnerable = 0;
    this.instability = 0;
    this.tilt = 0;
    this.spin = 0;
    this.wrecked = false;
    this.scraping = false;
    this.scrapeSide = 0;
    this.slipstream = 0;
    this.surge = 0; // slingshot: extra speed allowance (m/s) …
    this.surgeTimer = 0; // … for this long
    this.punctureTimer = 0; // spike strip: seconds of reduced grip left
    this.punctureGrip = 1;
    this.lateralLimit = this.profile.lateralMin;
    this.time = 0;
  }

  // Effective top speed (km/h) for this frame, before boost.
  topKmh(difficultyBonus) {
    return this.profile.topKmh * (1 + difficultyBonus) * (1 + SLIPSTREAM.TOP_SPEED_BONUS * this.slipstream);
  }

  // controls: { steer: -1..1, throttle, brake, boost }. curve: road curvature under the car.
  update(dt, controls, maxKmh, cruiseKmh, curve) {
    const pr = this.profile;
    this.time += dt;
    const max = maxKmh / 3.6;
    const canBoost = controls.boost && !controls.brake && !this.wrecked && this.speed > 5
      && this.boost > (this.boosting ? 0 : BOOST.MIN_START);
    this.boostStarted = canBoost && !this.boosting;
    this.boosting = canBoost;
    this.braking = controls.brake;
    this.throttle = damp(this.throttle, controls.throttle || this.boosting ? 1 : 0, 8, dt);

    this.updateSpeed(dt, controls, max, cruiseKmh / 3.6);

    if (this.boosting) {
      this.boost = Math.max(0, this.boost - pr.boostDrain * dt);
      this.boostTime += dt;
    } else {
      let regen = pr.boostRegen + BOOST.SLIPSTREAM_PER_SEC * this.slipstream;
      if (this.speed > max * BOOST.HIGH_SPEED_RATIO) regen += BOOST.HIGH_SPEED_PER_SEC;
      this.boost = Math.min(100, this.boost + regen * dt);
    }

    this.updateSteering(dt, controls.steer, max, curve);

    if (this.wrecked) {
      this.tilt += this.spin * dt;
      this.spin = damp(this.spin, 0, 2.2, dt);
    } else {
      this.tilt = damp(this.tilt, (this.vx / pr.lateralMax) * PLAYER.TILT_MAX, 10, dt);
    }
    if (this.surgeTimer > 0) this.surgeTimer -= dt;
    if (this.punctureTimer > 0) this.punctureTimer -= dt;
    if (this.invulnerable > 0) this.invulnerable -= dt;
    if (this.instability > 0) this.instability -= dt;
  }

  updateSpeed(dt, controls, max, cruise) {
    const pr = this.profile;
    const base = this.boosting ? max + pr.boostKmh / 3.6 : max;
    this.baseTop = base;
    const top = base + (this.surgeTimer > 0 ? this.surge : 0);
    if (controls.brake) {
      this.speed -= pr.brake * dt;
    } else if (this.boosting || controls.throttle) {
      if (this.speed < top) {
        const r = this.speed / top;
        const slip = 1 + SLIPSTREAM.ACCEL_BONUS * this.slipstream;
        const accel = pr.accel * slip * Math.max(0.12, 1 - r * r) + (this.boosting ? pr.boostAccel : 0);
        this.speed = Math.min(top, this.speed + accel * dt);
      } else {
        // Bleed off boost overspeed smoothly instead of snapping back.
        this.speed = Math.max(top, this.speed - PLAYER.COAST_DECEL * 2 * dt);
      }
    } else {
      const target = Math.min(cruise, max);
      if (this.speed > target) this.speed = Math.max(target, this.speed - PLAYER.COAST_DECEL * dt);
      else this.speed = Math.min(target, this.speed + PLAYER.CRUISE_ACCEL * dt);
    }
    if (this.speed < 0) this.speed = 0;
  }

  updateSteering(dt, steer, max, curve) {
    const pr = this.profile;
    // Steering authority grows with speed, but a parked car can't slide sideways.
    const lowSpeedFactor = clamp(this.speed / 20, 0, 1);
    const grip = this.grip * (this.punctureTimer > 0 ? this.punctureGrip : 1);
    this.lateralLimit = lerp(pr.lateralMin, pr.lateralMax, clamp(this.speed / max, 0, 1)) * lowSpeedFactor * grip;
    let target = this.wrecked ? 0 : steer * this.lateralLimit;
    if (this.instability > 0) {
      // Post-impact wobble: a decaying oscillation the player can steer through.
      const k = this.instability / DAMAGE.INSTABILITY_TIME;
      target += Math.sin(this.time * 19) * DAMAGE.INSTABILITY_STEER * this.lateralLimit * k;
    }
    const response = (steer !== 0 ? pr.steerResponse : pr.steerRelease) * (0.55 + 0.45 * grip);
    this.vx = damp(this.vx, target, response, dt);
    // Centrifugal drift pushes the car toward the outside of bends.
    this.x += this.vx * dt - curve * this.speed * this.speed * PLAYER.CENTRIFUGAL * dt;

    const limit = ROAD.EDGE - pr.width / 2 - 0.05;
    this.scraping = false;
    if (this.x > limit || this.x < -limit) {
      this.scrapeSide = this.x > 0 ? 1 : -1;
      this.x = this.scrapeSide * limit;
      if (this.vx * this.scrapeSide > 0) this.vx = 0;
      this.scraping = this.speed > 8;
      this.speed -= this.speed * PLAYER.WALL_FRICTION * dt;
    }
  }

  // Slingshot out of a slipstream: a short surge above top speed.
  slingshot(kmh, time) {
    this.surge = kmh / 3.6;
    this.surgeTimer = time;
    // Chained slingshots never stack beyond one surge over the current top speed.
    this.speed = Math.max(this.speed, Math.min(this.speed + this.surge * 0.6, (this.baseTop || this.speed) + this.surge));
  }

  // Spike strip: slower and less grip for a few seconds — hurts, never ends the run by itself.
  puncture(time, grip, speedKeep) {
    this.punctureTimer = time;
    this.punctureGrip = grip;
    this.speed *= speedKeep;
  }

  addBoost(amount) {
    this.boost = Math.min(100, this.boost + amount);
  }

  repair(amount) {
    this.health = Math.min(PLAYER.MAX_HEALTH, this.health + amount);
  }

  // Returns the damage actually applied after the car's durability.
  takeDamage(amount) {
    const applied = Math.round(amount * this.profile.damageMult);
    this.health = Math.max(0, this.health - applied);
    this.invulnerable = PLAYER.INVULNERABLE_TIME;
    this.instability = DAMAGE.INSTABILITY_TIME;
    return applied;
  }

  wreck(direction) {
    this.wrecked = true;
    this.boosting = false;
    this.spin = direction * 2.4;
  }
}
