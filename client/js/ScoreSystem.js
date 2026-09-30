import { SCORE, COMBO } from './balance.js';

const TIERS = COMBO.TIERS;
const TOP_TIER = TIERS.length - 1;

// Score = distance (scaled by speed) + skill actions, all multiplied by the combo multiplier.
// Risky actions add combo points; tiers x1 → x10. Driving "safely" (no risky action within the
// window) drops one tier at a time. Collisions are graded: a scrape costs a tier or two, a real
// crash resets everything. `scale` (heat stars, FLOW) multiplies every point on top.
export class ScoreSystem {
  constructor() {
    this.stats = {
      nearMisses: 0, insaneMisses: 0, overtakes: 0, perfectOvertakes: 0, pickups: 0, crashes: 0,
      topSpeed: 0, bestMultiplier: 1, boostTime: 0, highSpeedTime: 0, cleanDistance: 0, bestCleanDistance: 0,
      chicanes: 0, legendPasses: 0, policeEscapes: 0, longestChase: 0, creditChips: 0,
      escapeStars: 0, heatEscaped: 0, maxHeat: 0, rivalsBeaten: 0, challenges: 0, perfectDodges: 0, slingshots: 0,
    };
    this.scale = 1;
    this.reset();
  }

  reset() {
    this.score = 0;
    this.distance = 0;
    this.comboPoints = 0;
    this.tier = 0;
    this.comboTimer = 0;
    this.multiplier = 1;
    this.tierChange = 0; // +1 on tier up, -1 on decay, consumed by the game each frame
    this.scale = 1;
    this.nextCheckpoint = SCORE.CHECKPOINT_DISTANCE;
    for (const k in this.stats) this.stats[k] = 0;
    this.stats.bestMultiplier = 1;
  }

  // pointsScale lets road events (open highway) boost distance points without touching distance.
  addDistance(meters, kmh, pointsScale = 1) {
    this.distance += meters;
    this.stats.cleanDistance += meters;
    if (this.stats.cleanDistance > this.stats.bestCleanDistance) this.stats.bestCleanDistance = this.stats.cleanDistance;
    const perMeter = SCORE.POINTS_PER_METER + Math.max(0, kmh - SCORE.SPEED_BONUS_FROM_KMH) / SCORE.SPEED_BONUS_DIVISOR;
    this.score += meters * perMeter * this.multiplier * pointsScale * this.scale;
    if (kmh > this.stats.topSpeed) this.stats.topSpeed = kmh;
  }

  // Adds points (scaled by the current multiplier) and optional combo points. Returns points.
  // `risky` actions refresh the decay window; safe ones (plain overtakes, checkpoints) only add
  // a little combo and let it keep decaying — so careful driving can't hold a big multiplier.
  award(basePoints, comboGain = 0, risky = true) {
    const points = Math.round(basePoints * this.multiplier * this.scale);
    this.score += points;
    if (comboGain > 0) this.addCombo(comboGain, risky);
    return points;
  }

  addBonus(points) {
    this.score += points;
  }

  addCombo(amount, risky = true) {
    if (risky || this.comboPoints === 0) this.comboTimer = COMBO.WINDOW;
    this.comboPoints += amount;
    let tier = this.tier;
    while (tier < TOP_TIER && this.comboPoints >= TIERS[tier + 1].at) tier++;
    if (tier > this.tier) {
      this.tier = tier;
      this.multiplier = TIERS[tier].mult;
      this.tierChange = 1;
      if (this.multiplier > this.stats.bestMultiplier) this.stats.bestMultiplier = this.multiplier;
    }
  }

  // Light contact: lose a tier or two instead of everything. Returns the multiplier lost from.
  dropTiers(n) {
    const lost = this.multiplier;
    if (this.tier === 0) {
      this.comboPoints = 0;
      return lost;
    }
    this.tier = Math.max(0, this.tier - n);
    this.comboPoints = TIERS[this.tier].at;
    this.multiplier = TIERS[this.tier].mult;
    this.comboTimer = COMBO.WINDOW;
    this.tierChange = -1;
    return lost;
  }

  // Returns the multiplier that was lost (1 if there was nothing to lose).
  breakCombo() {
    const lost = this.multiplier;
    this.comboPoints = 0;
    this.tier = 0;
    this.comboTimer = 0;
    this.multiplier = 1;
    this.stats.cleanDistance = 0;
    return lost;
  }

  update(dt) {
    if (this.comboPoints === 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer > 0) return;
    if (this.tier === 0) {
      this.comboPoints = 0;
      return;
    }
    this.tier--;
    this.comboPoints = TIERS[this.tier].at;
    this.multiplier = TIERS[this.tier].mult;
    this.comboTimer = COMBO.WINDOW;
    this.tierChange = -1;
  }

  // 0..1 progress from the current tier toward the next.
  get tierProgress() {
    if (this.tier === TOP_TIER) return 1;
    const from = TIERS[this.tier].at;
    return (this.comboPoints - from) / (TIERS[this.tier + 1].at - from);
  }

  get comboTimeRatio() {
    return this.comboPoints === 0 ? 0 : this.comboTimer / COMBO.WINDOW;
  }
}
