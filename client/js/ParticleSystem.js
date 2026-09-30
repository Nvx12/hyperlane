import { rand } from './utils.js';

export const PARTICLE = { SPARK: 0, BOOST: 1, SMOKE: 2, DEBRIS: 3, WIND: 4, DUST: 5 };

// Draw passes: normal blending first, then additive glows.
const NORMAL_PASSES = [[PARTICLE.SMOKE, 0.32], [PARTICLE.DUST, 0.45], [PARTICLE.DEBRIS, 1]];
const ADDITIVE_PASSES = [[PARTICLE.SPARK, 1], [PARTICLE.BOOST, 0.85], [PARTICLE.WIND, 0.5]];

// Screen-space particles stored in typed arrays (struct-of-arrays). Dead particles are
// swap-removed, so the live set is always packed at [0, count) and nothing is allocated.
export class ParticleSystem {
  constructor(max, bank) {
    this.max = max;
    this.limit = max; // cosmetic cap, lowered by graphics quality / auto-scaling
    this.count = 0;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.type = new Uint8Array(max);
    const g = bank.glow;
    this.sprites = [g.spark, g.boost, g.smoke, g.debris, g.wind, g.dust];
  }

  // Explicit particle budget per graphics tier (see Performance.js QUALITY).
  setLimit(count) {
    this.limit = Math.max(40, Math.min(this.max, Math.floor(count)));
    if (this.count > this.limit) this.count = this.limit;
  }

  clear() {
    this.count = 0;
  }

  emit(type, x, y, vx, vy, life, size, grow = 0, drag = 0, gravity = 0) {
    if (this.count >= this.limit) return;
    const i = this.count++;
    this.type[i] = type;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
  }

  burst(type, x, y, count, speed, life, size, gravity) {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * rand(0.3, 1);
      this.emit(type, x, y, Math.cos(a) * v, Math.sin(a) * v - speed * 0.4, life * rand(0.5, 1), size * rand(0.6, 1.2), 0, 1.2, gravity);
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const d = 1 / (1 + this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d + this.gravity[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.size[i] = Math.max(0, this.size[i] + this.grow[i] * dt);
      i++;
    }
  }

  kill(i) {
    const last = --this.count;
    if (i === last) return;
    this.type[i] = this.type[last];
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last];
    this.grow[i] = this.grow[last];
    this.drag[i] = this.drag[last];
    this.gravity[i] = this.gravity[last];
  }

  render(ctx) {
    if (this.count === 0) return;
    for (let p = 0; p < NORMAL_PASSES.length; p++) this.renderType(ctx, NORMAL_PASSES[p][0], NORMAL_PASSES[p][1]);
    ctx.globalCompositeOperation = 'lighter';
    for (let p = 0; p < ADDITIVE_PASSES.length; p++) this.renderType(ctx, ADDITIVE_PASSES[p][0], ADDITIVE_PASSES[p][1]);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  renderType(ctx, type, alphaScale) {
    const img = this.sprites[type];
    for (let i = 0; i < this.count; i++) {
      if (this.type[i] !== type) continue;
      const s = this.size[i];
      ctx.globalAlpha = (this.life[i] / this.maxLife[i]) * alphaScale;
      ctx.drawImage(img, this.x[i] - s / 2, this.y[i] - s / 2, s, s);
    }
  }
}

// Radial streaks from the vanishing point; one stroked path for all lines.
export class SpeedLines {
  constructor(count) {
    this.max = count;
    this.count = count;
    this.cos = new Float32Array(count);
    this.sin = new Float32Array(count);
    this.r = new Float32Array(count);
    this.speed = new Float32Array(count);
    this.intensity = 0;
    for (let i = 0; i < count; i++) this.respawn(i, true);
  }

  setLimitScale(scale) {
    this.count = Math.max(8, Math.floor(this.max * scale));
  }

  respawn(i, scatter) {
    const a = Math.random() * Math.PI * 2;
    this.cos[i] = Math.cos(a);
    this.sin[i] = Math.sin(a);
    this.r[i] = scatter ? rand(0.05, 1) : rand(0.05, 0.3);
    this.speed[i] = rand(0.7, 1.4);
  }

  update(dt, intensity) {
    this.intensity = intensity;
    if (intensity <= 0.01) return;
    const rate = 1.2 + intensity * 3.4;
    for (let i = 0; i < this.count; i++) {
      this.r[i] += (this.r[i] * rate + 0.05) * this.speed[i] * dt;
      if (this.r[i] > 1.15) this.respawn(i, false);
    }
  }

  render(ctx, cam) {
    if (this.intensity <= 0.02) return;
    const cx = cam.cx;
    const cy = cam.horizonY;
    const R = Math.hypot(cam.width, cam.height) * 0.6;
    const len = 0.1 + this.intensity * 0.16;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgb(190,230,255)';
    ctx.globalAlpha = this.intensity * 0.34;
    ctx.lineWidth = 1 + this.intensity;
    ctx.beginPath();
    for (let i = 0; i < this.count; i++) {
      const r = this.r[i];
      if (r < 0.22) continue;
      const r0 = r * R;
      const r1 = r * (1 + len) * R;
      ctx.moveTo(cx + this.cos[i] * r0, cy + this.sin[i] * r0 * 0.8);
      ctx.lineTo(cx + this.cos[i] * r1, cy + this.sin[i] * r1 * 0.8);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
