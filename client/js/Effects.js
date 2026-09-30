import { PERF, PALETTE, PLAYER } from './config.js';
import { clamp, damp, rand } from './utils.js';
import { ParticleSystem, SpeedLines, PARTICLE } from './ParticleSystem.js';
import { createVignette } from './Sprites.js';

// All cosmetic feedback: particles, speed lines, screen flashes. (Bonus text lives in the HUD
// feed — see BonusFeed.js — never over the road.)
// Nothing here affects gameplay, so graphics quality can scale it freely.
export class Effects {
  constructor(bank) {
    this.bank = bank;
    this.particles = new ParticleSystem(PERF.MAX_PARTICLES, bank);
    this.speedLines = new SpeedLines(PERF.SPEED_LINES);
    this.flash = { damage: 0, near: 0, boost: 0, pickup: 0, insane: 0 };
    this.acc = { boost: 0, smoke: 0, sparks: 0, damage: 0, wind: 0, trail: 0 };
    this.vignettes = null;
    this.time = 0;
    this.detail = 1; // 0..1 cosmetic detail from quality settings / auto-scaling
    this.trail = null; // cosmetic boost trail { rgb sprite } set from customization
  }

  resize(w, h) {
    this.vignettes = {
      red: createVignette(w, h, '255, 30, 60'),
      cyan: createVignette(w, h, PALETTE.CYAN_RGB),
      white: createVignette(w, h, '255, 255, 255'),
      green: createVignette(w, h, PALETTE.GREEN_RGB),
      violet: createVignette(w, h, '200, 107, 255'),
    };
  }

  // detail: 0..1 cosmetic density; particleBudget: hard cap for this graphics tier.
  setDetail(detail, particleBudget = PERF.MAX_PARTICLES) {
    this.detail = detail;
    this.particles.setLimit(particleBudget);
    this.speedLines.setLimitScale(0.4 + 0.6 * detail);
  }

  reset() {
    this.particles.clear();
    const f = this.flash;
    f.damage = f.near = f.boost = f.pickup = f.insane = 0;
    for (const k in this.acc) this.acc[k] = 0;
  }


  update(dt, speedIntensity, boosting) {
    this.time += dt;
    this.particles.update(dt);
    this.speedLines.update(dt, speedIntensity);
    const f = this.flash;
    f.damage = Math.max(0, f.damage - dt * 2.2);
    f.near = Math.max(0, f.near - dt * 3.5);
    f.pickup = Math.max(0, f.pickup - dt * 3);
    f.insane = Math.max(0, f.insane - dt * 2.5);
    f.boost = damp(f.boost, boosting ? 1 : 0, 6, dt);
  }

  // Per-frame player-attached effects, emitted at rate-limited accumulators.
  emitPlayer(dt, p, ps, showDamageSmoke) {
    const P = this.particles;
    const acc = this.acc;
    const u = ps.scale; // pixels per meter at the player
    const d = this.detail;

    if (p.boosting) {
      acc.boost += dt * 80 * d;
      while (acc.boost >= 1) {
        acc.boost -= 1;
        for (let side = -1; side <= 1; side += 2) {
          P.emit(PARTICLE.BOOST, ps.x + side * ps.w * 0.3 + rand(-2, 2), ps.y - ps.h * 0.14,
            (rand(-0.6, 0.6) + side * 0.4) * u, rand(1.5, 3.5) * u, rand(0.18, 0.35), u * rand(0.25, 0.4), -u * 0.6, 2, 0);
        }
      }
      if (this.trail) {
        acc.trail += dt * 40 * d;
        while (acc.trail >= 1) {
          acc.trail -= 1;
          P.emit(this.trail, ps.x + rand(-0.4, 0.4) * ps.w, ps.y - ps.h * rand(0, 0.3),
            rand(-0.3, 0.3) * u, rand(2, 4) * u, rand(0.3, 0.6), u * rand(0.15, 0.3), -u * 0.2, 1, 0);
        }
      }
    } else {
      acc.boost = 0;
    }

    const hardBrake = p.braking && p.speed > 15;
    const hardSteer = p.speed > 45 && Math.abs(p.vx) > p.lateralLimit * 0.8;
    if (hardBrake || hardSteer) {
      acc.smoke += dt * 36 * d;
      while (acc.smoke >= 1) {
        acc.smoke -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        P.emit(PARTICLE.SMOKE, ps.x + side * ps.w * 0.38, ps.y - ps.h * 0.05,
          side * rand(0.3, 1.2) * u, rand(0.4, 1.4) * u, rand(0.5, 0.9), u * 0.35, u * 1.4, 1.2, 0);
      }
    } else {
      acc.smoke = 0;
    }

    if (p.scraping) {
      acc.sparks += dt * 110 * (0.5 + 0.5 * d);
      while (acc.sparks >= 1) {
        acc.sparks -= 1;
        P.emit(PARTICLE.SPARK, ps.x + p.scrapeSide * ps.w * 0.48, ps.y - ps.h * rand(0.1, 0.45),
          p.scrapeSide * rand(0.5, 3) * u, rand(-2.5, 0.5) * u, rand(0.2, 0.45), u * rand(0.08, 0.16), 0, 0.5, u * 9);
      }
    }

    if (showDamageSmoke && p.health < PLAYER.LOW_HEALTH) {
      acc.damage += dt * (10 + (PLAYER.LOW_HEALTH - p.health) * 0.5) * d;
      while (acc.damage >= 1) {
        acc.damage -= 1;
        P.emit(PARTICLE.SMOKE, ps.x + rand(-0.3, 0.3) * ps.w, ps.y - ps.h * 0.75,
          rand(-0.3, 0.3) * u, -rand(0.5, 1.2) * u, rand(0.7, 1.1), u * 0.3, u * 1.2, 0.8, 0);
      }
    }

    // Slipstream: air streaks peeling off the car's flanks.
    if (p.slipstream > 0.2) {
      acc.wind += dt * 50 * p.slipstream * d;
      while (acc.wind >= 1) {
        acc.wind -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        P.emit(PARTICLE.WIND, ps.x + side * ps.w * rand(0.45, 0.7), ps.y - ps.h * rand(0.2, 1.1),
          side * rand(0.5, 1.5) * u, rand(3, 6) * u, rand(0.15, 0.3), u * rand(0.08, 0.16), 0, 0, 0);
      }
    }
  }

  impact(x, y, u, heavy) {
    const P = this.particles;
    P.burst(PARTICLE.SPARK, x, y, heavy ? 40 : 26, u * 7, 0.6, u * 0.14, u * 10);
    P.burst(PARTICLE.DEBRIS, x, y, heavy ? 14 : 8, u * 5, 0.9, u * 0.22, u * 12);
    P.burst(PARTICLE.SMOKE, x, y, 6, u * 1.5, 0.8, u * 0.5, 0);
  }

  nearMissBurst(ps, side, grade) {
    const P = this.particles;
    const n = 8 + grade * 8;
    for (let i = 0; i < n; i++) {
      P.emit(grade >= 2 ? PARTICLE.SPARK : PARTICLE.BOOST, ps.x + side * ps.w * 0.55, ps.y - ps.h * rand(0.2, 0.9),
        side * rand(1, 4 + grade * 2) * ps.scale, rand(0.5, 3) * ps.scale, rand(0.2, 0.45), ps.scale * rand(0.12, 0.28), 0, 2, 0);
    }
    if (grade >= 1) this.flash.near = Math.max(this.flash.near, 0.6 + grade * 0.2);
    if (grade >= 2) this.flash.insane = 1;
  }

  renderWorld(ctx) {
    this.particles.render(ctx);
  }

  renderScreen(ctx, cam, lowHealthPulse) {
    this.speedLines.render(ctx, cam);
    const v = this.vignettes;
    const f = this.flash;
    const W = cam.width;
    const H = cam.height;
    const red = Math.max(f.damage, lowHealthPulse);
    if (red > 0.01) {
      ctx.globalAlpha = Math.min(1, red);
      ctx.drawImage(v.red, 0, 0, W, H);
    }
    if (f.boost > 0.01) {
      ctx.globalAlpha = f.boost * 0.65;
      ctx.drawImage(v.cyan, 0, 0, W, H);
    }
    if (f.near > 0.01) {
      ctx.globalAlpha = clamp(f.near, 0, 1) * 0.5;
      ctx.drawImage(v.white, 0, 0, W, H);
    }
    if (f.insane > 0.01) {
      ctx.globalAlpha = f.insane * 0.7;
      ctx.drawImage(v.violet, 0, 0, W, H);
    }
    if (f.pickup > 0.01) {
      ctx.globalAlpha = f.pickup * 0.6;
      ctx.drawImage(v.green, 0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }
}
