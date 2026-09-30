import { CAMERA, COLLISION, PALETTE, TIER_COLORS } from './config.js';
import { SCORE, NEAR_MISS, COMBO, BOOST, SLIPSTREAM, RARE_TRAFFIC } from './balance.js';
import { approach, sign } from './utils.js';

const NEAR_MISS_COLORS = [PALETTE.PINK, '#ff5ad1', '#c86bff'];
const HOLD_KMH = 200; // "maintain 200 km/h" tracking for missions/records

// Reads the traffic around the player every frame and turns skillful driving into points,
// combo, boost and feedback. Collisions are detected here and resolved by the game.
export class SkillSystem {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.streakTimer = 0;
    this.holdTimer = 0; // continuous seconds at or above HOLD_KMH
    this.recordAnnounced = false;
  }

  // Single pass over traffic: collision, closest-approach tracking, lineup, slipstream.
  scan(dt) {
    const g = this.game;
    const p = g.player;
    const pr = p.profile;
    const cars = g.traffic.vehicles;
    const kmh = p.speed * 3.6;
    const pd = CAMERA.PLAYER_DEPTH;
    let slip = false;
    let collided = false;

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const dz = car.z - pd;
      const dx = car.x - p.x;
      const halfLen = (car.length + pr.length) * 0.5;
      const halfW = (car.width + pr.width) * 0.5;
      const adx = dx < 0 ? -dx : dx;

      if (!collided && p.invulnerable <= 0) {
        const limZ = halfLen * COLLISION.Z_FACTOR;
        const limX = halfW * COLLISION.X_FACTOR;
        if (dz < limZ && dz > -limZ && adx < limX) {
          collided = true;
          g.resolveCrash(car, dx, dz, limX, limZ);
          continue;
        }
      }
      if (car.barrier) continue;

      // Closest lateral gap while alongside, used to grade the near miss on pass.
      if (dz < halfLen && dz > -halfLen) {
        const gap = adx - halfW;
        if (gap < car.minGap) car.minGap = gap;
      }
      // Directly in our path and close: dodging it at the last moment is a "perfect overtake".
      if (dz > 0 && dz < SCORE.LINEUP_DISTANCE && adx < halfW) car.lineupAt = g.time;

      if (!slip && kmh > SLIPSTREAM.MIN_KMH && adx < SLIPSTREAM.LATERAL && car.speed < p.speed + 2) {
        const gapFront = car.z - car.length * 0.5 - (pd + pr.length * 0.5);
        if (gapFront > SLIPSTREAM.MIN_GAP && gapFront < SLIPSTREAM.MAX_GAP) slip = true;
      }
    }
    p.slipstream = approach(p.slipstream, slip ? 1 : 0, (slip ? SLIPSTREAM.BUILD : SLIPSTREAM.DECAY) * dt);
  }

  award(label, base, comboGain, color, size = 24) {
    const g = this.game;
    const points = g.score.award(base, comboGain);
    g.effects.popAtPlayer(`${label} +${points}`, color, g.playerScreen, size);
    return points;
  }

  onPass(car) {
    const g = this.game;
    if (!g.isPlaying()) return;
    const traffic = g.traffic;
    if (car.hit) {
      if (car.patternSlot >= 0) traffic.resolvePattern(car, true);
      return;
    }
    const p = g.player;
    const stats = g.score.stats;
    const ratio = (p.speed * 3.6) / g.maxKmh;
    const highSpeed = ratio >= SCORE.HIGH_SPEED_RATIO;
    const side = sign(car.x - p.x);

    let grade = null;
    for (let i = 0; i < NEAR_MISS.length; i++) {
      if (car.minGap < NEAR_MISS[i].gap) {
        grade = NEAR_MISS[i];
        break;
      }
    }
    if (grade) {
      stats.nearMisses++;
      if (grade.grade === 2) stats.insaneMisses++;
      p.addBoost(grade.boost);
      this.award(grade.label, grade.points, grade.combo, NEAR_MISS_COLORS[grade.grade], 24 + grade.grade * 3);
      g.effects.nearMissBurst(g.playerScreen, side, grade.grade);
      g.camera.addTrauma(0.08 + 0.08 * grade.grade);
      if (grade.grade >= 1) g.camera.kick(0.015 + 0.02 * grade.grade);
      g.audio.nearMiss(side, grade.grade);
      g.haptics.pulse('near');
      if (g.tutorial) g.tutorial.notify('nearMiss');
    }

    stats.overtakes++;
    let comboGain = highSpeed ? COMBO.GAIN.overtake : 0;
    if (p.boosting) comboGain += COMBO.GAIN.boostOvertake;
    if (car.lineupAt >= 0 && g.time - car.lineupAt < SCORE.PERFECT_WINDOW && ratio >= SCORE.PERFECT_MIN_RATIO) {
      stats.perfectOvertakes++;
      this.award('PERFECT OVERTAKE', SCORE.PERFECT_OVERTAKE, COMBO.GAIN.perfect + (p.boosting ? COMBO.GAIN.boostOvertake : 0), PALETTE.GOLD);
      g.audio.perfect();
    } else {
      // Plain overtakes score quietly (a soft tick) so near-miss / perfect pops stay meaningful.
      // Only boosted passes count as risky enough to keep the combo alive.
      g.score.award(SCORE.OVERTAKE, comboGain, p.boosting);
      if (!grade) g.audio.overtake();
    }
    if (highSpeed) p.addBoost(BOOST.OVERTAKE);

    if (car.rare) {
      stats.legendPasses++;
      stats.bonusCredits += RARE_TRAFFIC.PASS_CREDITS;
      this.award('LEGEND PASS', RARE_TRAFFIC.PASS_POINTS, COMBO.GAIN.legend, PALETTE.GOLD, 28);
      g.effects.callout(`+${RARE_TRAFFIC.PASS_CREDITS} CREDITS`, PALETTE.GOLD, g.camera, 26, 0.36);
      g.audio.record();
    }
    if (car.patternSlot >= 0 && traffic.resolvePattern(car, false)) {
      stats.chicanes++;
      this.award('CHICANE CLEARED', SCORE.CHICANE, COMBO.GAIN.chicane, PALETTE.VIOLET, 26);
    }
  }

  updateScoring(dt, traveled, pointsScale = 1) {
    const g = this.game;
    const p = g.player;
    const score = g.score;
    const stats = score.stats;
    const kmh = p.speed * 3.6;
    score.addDistance(traveled, kmh, pointsScale);
    score.update(dt);
    if (p.boosting) stats.boostTime += dt;

    if (kmh >= HOLD_KMH) {
      this.holdTimer += dt;
      if (this.holdTimer > stats.highSpeedTime) stats.highSpeedTime = this.holdTimer;
    } else {
      this.holdTimer = 0;
    }

    if (kmh >= g.maxKmh * SCORE.SPEED_STREAK_RATIO) {
      this.streakTimer += dt;
      if (this.streakTimer >= SCORE.SPEED_STREAK_TIME) {
        this.streakTimer = 0;
        this.award('TOP SPEED', SCORE.SPEED_STREAK, COMBO.GAIN.speedStreak, PALETTE.VIOLET);
      }
    } else {
      this.streakTimer = Math.max(0, this.streakTimer - dt);
    }

    if (score.distance >= score.nextCheckpoint) {
      const km = Math.round(score.nextCheckpoint / 1000);
      score.nextCheckpoint += SCORE.CHECKPOINT_DISTANCE;
      const points = score.award(SCORE.CHECKPOINT, COMBO.GAIN.checkpoint, false);
      g.effects.callout(`${km} KM  +${points}`, PALETTE.AMBER, g.camera);
      g.audio.checkpoint();
    }

    const best = g.bestScore();
    if (!this.recordAnnounced && best > 0 && score.score > best) {
      this.recordAnnounced = true;
      g.effects.callout('NEW RECORD!', PALETTE.GREEN, g.camera, 38, 0.3, 1.6);
      g.audio.record();
    }
  }

  // Turns combo tier changes into feedback. Called once per frame.
  comboFeedback() {
    const g = this.game;
    const score = g.score;
    const change = score.tierChange;
    if (change === 0) return;
    score.tierChange = 0;
    if (change > 0) {
      const tier = score.tier;
      g.effects.callout(`COMBO x${score.multiplier}`, TIER_COLORS[tier], g.camera, 30 + tier * 3, 0.22, 1.2);
      g.audio.comboUp(tier);
      g.ui.comboPulse(1);
      if (tier >= 4) g.camera.kick(0.03);
    } else {
      g.ui.comboPulse(-1);
      g.audio.comboDown();
    }
  }
}
