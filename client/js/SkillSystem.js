import { CAMERA, COLLISION } from './config.js';
import { SCORE, NEAR_MISS, COMBO, BOOST, SLIPSTREAM, RARE_TRAFFIC, SKILL, COMBO_MILESTONES } from './balance.js';
import { BARRIER_SPIKES, BARRIER_ROADWORK } from './TrafficManager.js';
import { approach, sign } from './utils.js';
import { PRIORITY } from './BonusFeed.js';

const NEAR_MISS_VARIANTS = ['near', 'near', 'insane'];
const HOLD_KMH = 200; // "maintain 200 km/h" tracking for missions/records

// Reads the traffic around the player every frame and turns skillful driving into points,
// combo, boost and feedback (bonus feed lines, never text over the road). Collisions are detected here and resolved by the game.
export class SkillSystem {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.streakTimer = 0;
    this.holdTimer = 0; // continuous seconds at or above HOLD_KMH
    this.recordAnnounced = false;
    this.slipCharged = false; // slipstream charged: pulling out now = slingshot
    this.closeCallAt = -999;
  }

  // Boost earned by risk grows with the combo (x3+) and in FLOW.
  boostGain(amount) {
    const g = this.game;
    let k = 1;
    if (g.score.multiplier >= COMBO_MILESTONES.BOOST_GAIN_FROM) k = COMBO_MILESTONES.BOOST_GAIN;
    if (g.flow) k = COMBO_MILESTONES.FLOW_BOOST_GAIN;
    g.player.addBoost(amount * k);
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
          if (car.barrier === BARRIER_SPIKES) {
            if (!car.hit) {
              car.hit = true;
              g.police.onSpikes();
            }
            continue;
          }
          collided = true;
          if (car.barrier === BARRIER_ROADWORK) g.hitCones(car, dx);
          else g.resolveCrash(car, dx, dz, limX, limZ);
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
    // Draft → slingshot: pull out of a charged slipstream for a burst of speed.
    if (p.slipstream >= SKILL.SLINGSHOT_CHARGE) this.slipCharged = true;
    if (this.slipCharged && !slip) {
      this.slipCharged = false;
      if (Math.abs(p.vx) > 2 && kmh > 140 && g.isPlaying()) {
        p.slingshot(SKILL.SLINGSHOT_KMH, SKILL.SLINGSHOT_TIME);
        g.score.stats.slingshots++;
        this.award('SLINGSHOT', SKILL.SLINGSHOT_POINTS, 1, 'cyan');
        g.audio.boost();
        g.camera.kick(0.03);
        g.police.addHeat(4, true);
      }
    }
  }

  // Scores an action and lists it in the bonus feed (repeats merge: "NEAR MISS ×3 +750").
  award(label, base, comboGain, variant = '') {
    const g = this.game;
    const points = g.score.award(base, comboGain);
    g.ui.feed.push(label, points, PRIORITY.ROUTINE, variant);
    g.director.moment();
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
      this.boostGain(grade.boost);
      const truck = car.typeKey === 'truck';
      const label = car.police ? 'POLICE NEAR MISS' : truck ? 'TRUCK SQUEEZE' : grade.label;
      this.award(label, grade.points * (truck || car.police ? SKILL.TRUCK_NEAR_MISS_MULT : 1), grade.combo, NEAR_MISS_VARIANTS[grade.grade]);
      g.police.onNearMiss(grade.grade, car);
      g.events.onNearMiss();
      // Dead ahead a moment ago, and you slipped past it: a perfect dodge (strict on purpose).
      if (car.lineupAt >= 0 && g.time - car.lineupAt < SKILL.PERFECT_DODGE_WINDOW && grade.grade >= 1) {
        stats.perfectDodges++;
        this.boostGain(SKILL.PERFECT_DODGE_BOOST);
        this.award('PERFECT DODGE', SKILL.PERFECT_DODGE_POINTS, 3, 'gold');
      }
      // A rare cinematic beat for the most extreme escapes.
      if (grade.grade === 2 && kmhNow(g) >= SKILL.CLOSE_CALL_MIN_KMH && g.time - this.closeCallAt > SKILL.CLOSE_CALL_COOLDOWN) {
        this.closeCallAt = g.time;
        g.closeCall();
      }
      g.effects.nearMissBurst(g.playerScreen, side, grade.grade);
      g.camera.addTrauma(0.08 + 0.08 * grade.grade);
      if (grade.grade >= 1) g.camera.kick(0.015 + 0.02 * grade.grade);
      g.audio.nearMiss(side, grade.grade);
      g.haptics.pulse('near');
      if (g.tutorial) g.tutorial.notify('nearMiss');
    }

    stats.overtakes++;
    g.events.onOvertake();
    g.police.onPass(car);
    let comboGain = highSpeed ? COMBO.GAIN.overtake : 0;
    if (p.boosting) comboGain += COMBO.GAIN.boostOvertake;
    if (car.lineupAt >= 0 && g.time - car.lineupAt < SCORE.PERFECT_WINDOW && ratio >= SCORE.PERFECT_MIN_RATIO) {
      stats.perfectOvertakes++;
      g.police.onPerfect();
      this.award('PERFECT OVERTAKE', SCORE.PERFECT_OVERTAKE, COMBO.GAIN.perfect + (p.boosting ? COMBO.GAIN.boostOvertake : 0), 'gold');
      g.audio.perfect();
    } else {
      // Plain overtakes score quietly (a soft tick) so near-miss / perfect pops stay meaningful.
      // Only boosted passes count as risky enough to keep the combo alive.
      g.score.award(SCORE.OVERTAKE, comboGain, p.boosting);
      if (!grade) g.audio.overtake();
    }
    if (highSpeed) this.boostGain(BOOST.OVERTAKE);

    if (car.rare) {
      stats.legendPasses++;
      this.award('LEGEND PASS', RARE_TRAFFIC.PASS_POINTS, COMBO.GAIN.legend, 'gold');
      g.audio.record();
    }
    if (car.patternSlot >= 0 && traffic.resolvePattern(car, false)) {
      stats.chicanes++;
      g.police.onChicane();
      this.award('CHICANE', SCORE.CHICANE, COMBO.GAIN.chicane, 'violet');
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
        // Passive (holding speed), so it scores quietly like plain overtakes: no feed line.
        this.game.score.award(SCORE.SPEED_STREAK, COMBO.GAIN.speedStreak);
      }
    } else {
      this.streakTimer = Math.max(0, this.streakTimer - dt);
    }

    if (score.distance >= score.nextCheckpoint) {
      const km = Math.round(score.nextCheckpoint / 1000);
      score.nextCheckpoint += SCORE.CHECKPOINT_DISTANCE;
      const points = score.award(SCORE.CHECKPOINT, COMBO.GAIN.checkpoint, false);
      g.ui.feed.push(`${km} KM`, points, PRIORITY.ROUTINE, 'amber');
      g.audio.checkpoint();
    }

    const best = g.bestScore();
    if (!this.recordAnnounced && best > 0 && score.score > best) {
      this.recordAnnounced = true;
      g.ui.feed.push('NEW RECORD', 0, PRIORITY.IMPORTANT, 'good');
      g.audio.record();
    }
  }

  // Turns combo tier changes into feedback on the combo block itself (no floating text).
  // Called once per frame.
  comboFeedback() {
    const g = this.game;
    const score = g.score;
    const change = score.tierChange;
    if (change === 0) return;
    score.tierChange = 0;
    if (change > 0) {
      const tier = score.tier;
      g.audio.comboUp(tier);
      g.ui.comboPulse(1);
      if (tier >= 4) g.camera.kick(0.03);
    } else {
      g.ui.comboPulse(-1);
      g.audio.comboDown();
    }
  }
}

const kmhNow = g => g.player.speed * 3.6;
