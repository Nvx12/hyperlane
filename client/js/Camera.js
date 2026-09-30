import { CAMERA, ROAD } from './config.js';
import { clamp, damp, lerp } from './utils.js';

// Pseudo-3D projection: screenX = cx + (x - camX) * focal / z, screenY = horizon + camHeight * focal / z.
// Also owns every camera effect (FOV, follow, roll, shake), all scaled by the player's shake setting.
export class Camera {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.cx = 0;
    this.horizonY = 0;
    this.baseFocal = 1;
    this.focal = 1;
    this.x = 0;
    this.fov = 1;
    this.fovKick = 0; // short additive FOV punch (near misses, boost ignition)
    this.fovOverride = 0; // extra FOV target offset (game over zoom)
    this.trauma = 0;
    this.shakeScale = 1; // settings: 0 disables all shake
    this.shakeX = 0;
    this.shakeY = 0;
    this.roll = 0;
    this.time = 0;
  }

  reset() {
    this.x = 0;
    this.fov = 1;
    this.fovKick = 0;
    this.fovOverride = 0;
    this.trauma = 0;
    this.roll = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.horizonY = Math.round(height * CAMERA.HORIZON);
    const heightFocal = ((height - this.horizonY) * CAMERA.BOTTOM_DEPTH) / CAMERA.HEIGHT;
    // On narrow windows keep the whole road visible at the player's depth.
    const widthFocal = (width * 0.5 * CAMERA.PLAYER_DEPTH) / (ROAD.EDGE + 0.4);
    this.baseFocal = Math.min(heightFocal, widthFocal);
    this.focal = this.baseFocal * this.fov;
  }

  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  kick(amount) {
    this.fovKick = Math.min(this.fovKick + amount, 0.12);
  }

  update(dt, player, kmh) {
    this.time += dt;
    // FOV widens with absolute speed, so 250 km/h looks the same in every car.
    const speedFov = lerp(1, CAMERA.SPEED_FOV, clamp((kmh - CAMERA.FOV_FROM_KMH) / CAMERA.FOV_RANGE_KMH, 0, 1));
    const fovTarget = (player.boosting ? Math.min(speedFov, CAMERA.BOOST_FOV) : speedFov) + this.fovOverride;
    this.fov = damp(this.fov, fovTarget, CAMERA.FOV_RATE, dt);
    this.fovKick = damp(this.fovKick, 0, CAMERA.FOV_KICK_DECAY, dt);
    this.focal = this.baseFocal * (this.fov - this.fovKick);

    this.x = damp(this.x, player.x * CAMERA.FOLLOW, CAMERA.FOLLOW_RATE, dt);
    this.roll = damp(this.roll, -(player.vx / player.profile.lateralMax) * CAMERA.MAX_ROLL, 6, dt);

    this.trauma = Math.max(0, this.trauma - CAMERA.TRAUMA_DECAY * dt);
    // Trauma-squared keeps small bumps subtle; a road vibration that grows past ~180 km/h sells speed.
    const vibration = Math.max(0, kmh - CAMERA.VIBRATION_FROM_KMH) * CAMERA.VIBRATION_PER_KMH + (player.boosting ? CAMERA.BOOST_VIBRATION : 0);
    const amp = (this.trauma * this.trauma * CAMERA.MAX_SHAKE + vibration) * this.shakeScale;
    const t = this.time;
    this.shakeX = amp * (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 83.1 + 1.2) * 0.4);
    this.shakeY = amp * 0.7 * (Math.sin(t * 59.7 + 0.4) * 0.6 + Math.sin(t * 97.9 + 2.3) * 0.4);
  }
}
