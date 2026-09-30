// Optional tilt steering (hold the phone like a wheel).
//
// The wheel angle is the direction of gravity projected onto the screen plane, computed from
// deviceorientation beta/gamma. Unlike reading beta alone this stays correct however far the
// phone is tipped back, in both landscape directions, and it avoids the sign differences between
// iOS and Android in DeviceMotion's accelerationIncludingGravity.
//
// Tilt is never required: start() resolves 'unsupported' / 'denied' / 'no-sensor' and the caller
// falls back to touch steering.

const DEG = Math.PI / 180;
const FULL_LOCK = 24 * DEG; // wheel angle for full steering at sensitivity 1
const DEADZONE = 1.5 * DEG;
const SMOOTH = 0.06; // seconds (low-pass on the raw angle)
const SENSOR_TIMEOUT_MS = 1500;

function screenAngle() {
  const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : window.orientation;
  return ((Number(a) || 0) % 360 + 360) % 360;
}

// Wheel angle (radians, + = clockwise = steer right) from Euler angles and screen rotation.
export function wheelAngle(betaDeg, gammaDeg, angle) {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  // Gravity (down) in device coordinates: x right, y up (portrait), z out of the screen.
  const dx = Math.cos(b) * Math.sin(g);
  const dy = -Math.sin(b);
  const dz = -Math.cos(b) * Math.cos(g);
  let right;
  let down;
  switch (angle) {
    case 90: right = -dy; down = -dx; break; // landscape, device top to the left
    case 270: right = dy; down = dx; break; // landscape, device top to the right
    case 180: right = -dx; down = dy; break;
    default: right = dx; down = -dy; break;
  }
  // Phone flat on a table: gravity is through the screen, there is no wheel to read.
  if (Math.hypot(right, down) < 0.2 * Math.hypot(dx, dy, dz)) return null;
  return Math.atan2(right, down);
}

export class TiltInput {
  constructor() {
    this.supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
    this.active = false;
    this.angle = 0; // smoothed wheel angle
    this.raw = null;
    this.center = 0; // calibration offset (radians)
    this.sensitivity = 1;
    this.lastEvent = 0;
    this.onEvent = this.onEvent.bind(this);
  }

  // Must be called from a user gesture on iOS (permission prompt).
  async start() {
    if (!this.supported) return 'unsupported';
    const DOE = window.DeviceOrientationEvent;
    // iOS Safari, and recent Chromium too, gate the sensor behind requestPermission(). Chromium
    // may answer 'prompt'; only an explicit refusal counts, the sensor timeout below decides the rest.
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) === 'denied') return 'denied';
      } catch {
        return 'denied';
      }
    }
    window.addEventListener('deviceorientation', this.onEvent);
    this.active = true;
    // Desktop browsers expose the API without a sensor: no events ever arrive. A real sensor
    // answers within a frame or two, so resolve on the first reading instead of the timeout.
    const started = performance.now();
    await new Promise(resolve => {
      const timer = setTimeout(done, SENSOR_TIMEOUT_MS);
      function done() {
        clearTimeout(timer);
        window.removeEventListener('deviceorientation', done);
        resolve();
      }
      window.addEventListener('deviceorientation', done);
    });
    if (this.lastEvent < started) {
      this.stop();
      return 'no-sensor';
    }
    return 'ok';
  }

  stop() {
    window.removeEventListener('deviceorientation', this.onEvent);
    this.active = false;
    this.raw = null;
  }

  onEvent(e) {
    if (e.beta === null || e.gamma === null) return;
    this.lastEvent = performance.now();
    this.raw = wheelAngle(e.beta, e.gamma, screenAngle());
  }

  // Current angle becomes "straight ahead".
  calibrate() {
    if (this.raw !== null) {
      this.center = this.raw;
      this.angle = this.raw;
    }
    return this.center;
  }

  update(dt) {
    if (!this.active || this.raw === null) return;
    const k = Math.min(1, dt / SMOOTH);
    this.angle += (this.raw - this.angle) * k;
  }

  // -1..1 steering from the calibrated wheel angle.
  get steer() {
    if (!this.active || this.raw === null) return 0;
    let a = this.angle - this.center;
    if (Math.abs(a) < DEADZONE) return 0;
    a -= Math.sign(a) * DEADZONE;
    const s = a / (FULL_LOCK / this.sensitivity);
    return s > 1 ? 1 : s < -1 ? -1 : s;
  }
}
