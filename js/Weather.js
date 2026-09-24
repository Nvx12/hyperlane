import { WEATHER } from './balance.js';
import { approach, clamp, rand } from './utils.js';

const MAX_DROPS = 240;
const TARGETS = {
  clear: { rain: 0, fog: 0 },
  rain: { rain: 0.6, fog: 0.22 },
  fog: { rain: 0, fog: 0.85 },
  storm: { rain: 1, fog: 0.4 },
};

// Lightweight weather: intensities that ease toward the current condition, a screen-space
// rain pool drawn as one stroked path, lightning flashes, and the gameplay grip modifier.
export class Weather {
  constructor(audio) {
    this.audio = audio;
    this.type = 'clear';
    this.override = null; // forced condition from a road event
    this.rain = 0;
    this.fog = 0;
    this.wet = 0;
    this.flash = 0;
    this.lightningTimer = 0;
    this.thunderTimer = -1;
    this.nextRollAt = 0;
    this.detail = 1;
    this.supercell = false;
    this.x = new Float32Array(MAX_DROPS);
    this.y = new Float32Array(MAX_DROPS);
    this.len = new Float32Array(MAX_DROPS);
    this.spd = new Float32Array(MAX_DROPS);
    for (let i = 0; i < MAX_DROPS; i++) this.respawnDrop(i, true);
  }

  // Picks the opening weather for a route; `allowRare` enables the rare supercell storm.
  start(env, allowRare) {
    this.override = null;
    this.supercell = allowRare && env.weather.storm > 0 && Math.random() < WEATHER.SUPERCELL_CHANCE;
    this.type = this.supercell ? 'storm' : this.roll(env);
    const t = TARGETS[this.type];
    this.rain = t.rain;
    this.fog = t.fog;
    this.wet = Math.max(env.wetBase || 0, t.rain);
    this.nextRollAt = rand(WEATHER.ROLL_DISTANCE[0], WEATHER.ROLL_DISTANCE[1]);
    this.lightningTimer = rand(3, 7);
  }

  roll(env) {
    const w = env.weather;
    let total = 0;
    for (const k in w) total += w[k];
    let r = Math.random() * total;
    for (const k in w) {
      r -= w[k];
      if (r <= 0 && w[k] > 0) return k;
    }
    return 'clear';
  }

  setOverride(type) {
    this.override = type;
  }

  get condition() {
    return this.override || this.type;
  }

  // Traction multiplier applied to steering authority.
  get grip() {
    return 1 - WEATHER.RAIN_GRIP_LOSS * this.rain - (this.condition === 'storm' ? WEATHER.STORM_GRIP_LOSS : 0);
  }

  update(dt, distance, speedRatio, env, sheltered) {
    if (!this.supercell && !this.override && distance >= this.nextRollAt) {
      this.nextRollAt = distance + rand(WEATHER.ROLL_DISTANCE[0], WEATHER.ROLL_DISTANCE[1]);
      this.type = this.roll(env);
    }
    const target = TARGETS[this.condition];
    const rainTarget = this.supercell ? 1 : target.rain;
    this.rain = approach(this.rain, rainTarget, dt / WEATHER.TRANSITION_TIME);
    this.fog = approach(this.fog, target.fog, dt / WEATHER.TRANSITION_TIME);
    const wetTarget = Math.max(env.wetBase || 0, this.rain);
    this.wet = approach(this.wet, wetTarget, dt / (wetTarget > this.wet ? 8 : 25));

    this.flash = Math.max(0, this.flash - dt * 3);
    if (this.condition === 'storm' && this.rain > 0.5) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = this.supercell ? rand(1.5, 4) : rand(4, 10);
        this.flash = sheltered ? 0.25 : 1;
        this.thunderTimer = rand(0.25, 1.4);
      }
    }
    if (this.thunderTimer >= 0) {
      this.thunderTimer -= dt;
      if (this.thunderTimer < 0) this.audio.thunder(this.supercell ? 1.2 : 0.8);
    }
    if (this.rain > 0.01) this.updateDrops(dt, speedRatio);
  }

  respawnDrop(i, scatter) {
    this.x[i] = Math.random() * 1.2 - 0.1;
    this.y[i] = scatter ? Math.random() : -Math.random() * 0.2;
    this.len[i] = rand(0.03, 0.07);
    this.spd[i] = rand(1.4, 2.2);
  }

  updateDrops(dt, speedRatio) {
    const count = this.dropCount();
    const outward = 0.9 * speedRatio;
    for (let i = 0; i < count; i++) {
      this.y[i] += this.spd[i] * dt * (1 + speedRatio * 0.8);
      // At speed, rain streaks fan out from the vanishing point.
      this.x[i] += ((this.x[i] - 0.5) * outward - 0.12) * dt;
      if (this.y[i] > 1.05 || this.x[i] < -0.15 || this.x[i] > 1.15) this.respawnDrop(i, false);
    }
  }

  dropCount() {
    return Math.floor(MAX_DROPS * clamp(this.rain, 0, 1) * (0.3 + 0.7 * this.detail));
  }

  render(ctx, cam, speedRatio, sheltered) {
    if (this.rain > 0.02 && !sheltered) {
      const W = cam.width;
      const H = cam.height;
      const count = this.dropCount();
      const slant = -0.12 * W;
      ctx.strokeStyle = 'rgb(190,215,255)';
      ctx.globalAlpha = 0.25 + 0.2 * this.rain;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = this.x[i] * W;
        const y = this.y[i] * H;
        const l = this.len[i] * H * (1 + speedRatio);
        const dx = ((this.x[i] - 0.5) * 0.9 * speedRatio * W - slant * 0.2) * (l / H);
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx - 0.12 * l, y + l);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (this.flash > 0.01) {
      ctx.fillStyle = 'rgb(225,232,255)';
      ctx.globalAlpha = this.flash * 0.55;
      ctx.fillRect(0, 0, cam.width, cam.height);
      ctx.globalAlpha = 1;
    }
  }
}
