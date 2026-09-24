import { CARS, STAT_RANGES, UPGRADES, UPGRADE_COSTS, CREDITS, XP, LEVEL_TITLES, DEFAULT_CAR_PROFILE, COMBO } from './balance.js';
import { COSMETICS, defaultCustom } from './data/cosmetics.js';
import { clamp } from './utils.js';

export const UPGRADE_KEYS = Object.keys(UPGRADES);
const CAR_BY_ID = new Map(CARS.map(c => [c.id, c]));
const NO_UPGRADES = Object.freeze(Object.fromEntries(UPGRADE_KEYS.map(k => [k, 0])));

export const getCar = id => CAR_BY_ID.get(id) || CARS[0];

// Sum of the first `level` percentage steps of an upgrade, as a fraction.
export function upgradeBonus(key, level) {
  const steps = UPGRADES[key].steps;
  let total = 0;
  for (let i = 0; i < level && i < steps.length; i++) total += steps[i];
  return total / 100;
}

export function xpForLevel(level) {
  return XP.LEVEL_BASE + XP.LEVEL_GROWTH * (level - 1);
}

export function titleForLevel(level) {
  let title = LEVEL_TITLES[0].title;
  for (const t of LEVEL_TITLES) if (level >= t.level) title = t.title;
  return title;
}

// Stateless helpers over the save data. Mutations go through here so every rule
// (costs, unlock conditions, level curve) lives in one place.
export class Progression {
  constructor(saveManager) {
    this.store = saveManager;
  }

  get save() {
    return this.store.data;
  }

  carState(id) {
    const cars = this.save.cars;
    if (!cars[id]) cars[id] = { upgrades: {}, custom: defaultCustom(getCar(id)) };
    const state = cars[id];
    for (const key of UPGRADE_KEYS) if (!Number.isInteger(state.upgrades[key])) state.upgrades[key] = 0;
    if (!state.custom || typeof state.custom !== 'object') state.custom = defaultCustom(getCar(id));
    return state;
  }

  selectedCar() {
    const id = this.isUnlocked(this.save.selectedCar) ? this.save.selectedCar : CARS[0].id;
    return getCar(id);
  }

  isUnlocked(id) {
    return this.save.unlockedCars.includes(id);
  }

  // Handling profile = base stats × upgrade bonuses. This is what the Player actually drives with.
  getCarProfile(id, withUpgrades = true) {
    const car = getCar(id);
    const up = withUpgrades ? this.carState(id).upgrades : NO_UPGRADES;
    const b = car.stats;
    const engine = 1 + upgradeBonus('engine', up.engine);
    const turbo = 1 + upgradeBonus('turbo', up.turbo);
    const tires = 1 + upgradeBonus('tires', up.tires);
    const brakes = 1 + upgradeBonus('brakes', up.brakes);
    const nitro = 1 + upgradeBonus('nitro', up.nitro);
    const armor = 1 - upgradeBonus('armor', up.armor);
    return {
      ...DEFAULT_CAR_PROFILE,
      topKmh: b.topKmh * engine,
      accel: b.accel * turbo,
      lateralMin: DEFAULT_CAR_PROFILE.lateralMin * (b.lateralMax / DEFAULT_CAR_PROFILE.lateralMax) * tires,
      lateralMax: b.lateralMax * tires,
      steerResponse: b.steerResponse * tires,
      steerRelease: b.steerResponse * 1.3 * tires,
      brake: b.brake * brakes,
      boostKmh: b.boostKmh * nitro,
      boostAccel: b.boostAccel * nitro,
      boostDrain: b.boostDrain / nitro,
      boostRegen: b.boostRegen,
      damageMult: b.damageMult * armor,
      width: car.width,
      length: car.length,
      height: car.height,
    };
  }

  // 0..1 bar values for the six displayed stats.
  statBars(profile) {
    const norm = (v, r) => clamp((v - r[0]) / (r[1] - r[0]), 0, 1);
    return {
      'TOP SPEED': norm(profile.topKmh, STAT_RANGES.TOP_SPEED),
      ACCELERATION: norm(profile.accel, STAT_RANGES.ACCELERATION),
      HANDLING: norm(profile.lateralMax, STAT_RANGES.HANDLING),
      BRAKING: norm(profile.brake, STAT_RANGES.BRAKING),
      BOOST: norm(profile.boostKmh, STAT_RANGES.BOOST),
      DURABILITY: norm(1 / profile.damageMult, STAT_RANGES.DURABILITY),
    };
  }

  upgradeCost(carId, key) {
    const level = this.carState(carId).upgrades[key];
    if (level >= UPGRADES[key].steps.length) return null;
    return Math.round((UPGRADE_COSTS[level] * getCar(carId).tier) / 10) * 10;
  }

  buyUpgrade(carId, key) {
    const cost = this.upgradeCost(carId, key);
    if (cost === null || this.save.credits < cost || !this.isUnlocked(carId)) return false;
    this.save.credits -= cost;
    this.carState(carId).upgrades[key]++;
    this.store.save();
    return true;
  }

  selectCar(id) {
    if (!this.isUnlocked(id)) return false;
    this.save.selectedCar = id;
    this.store.save();
    return true;
  }

  // Progress toward a car's unlock condition: { value, target, text }.
  unlockProgress(car) {
    const s = this.save;
    const u = car.unlock;
    switch (u.type) {
      case 'auto': return { value: 1, target: 1, text: 'Unlocked' };
      case 'totalDistance': return { value: s.stats.distance, target: u.value, text: `Drive ${u.value / 1000} km in total` };
      case 'totalNearMisses': return { value: s.stats.nearMisses, target: u.value, text: `Perform ${u.value} near misses` };
      case 'topSpeed': return { value: s.records.topSpeed, target: u.value, text: `Reach ${u.value} km/h` };
      case 'bestScore': return { value: s.records.score, target: u.value, text: `Score ${u.value.toLocaleString('en-US')} in one run` };
      case 'level': return { value: s.level, target: u.value, text: `Reach driver level ${u.value}` };
      case 'secret': return { value: s.flags.phantom ? 1 : 0, target: 1, text: u.hint };
      default: return { value: 0, target: 1, text: '' };
    }
  }

  // Returns the cars newly unlocked by the current save state.
  checkUnlocks() {
    const unlocked = [];
    for (const car of CARS) {
      if (this.isUnlocked(car.id)) continue;
      const p = this.unlockProgress(car);
      if (p.value >= p.target) {
        this.save.unlockedCars.push(car.id);
        unlocked.push(car);
      }
    }
    return unlocked;
  }

  isCosmeticUnlocked(item) {
    return !item.level || this.save.level >= item.level;
  }

  setCustom(carId, slot, value) {
    const item = COSMETICS[slot].find(o => o.id === value);
    if (!item || !this.isCosmeticUnlocked(item)) return false;
    this.carState(carId).custom[slot] = value;
    this.store.save();
    return true;
  }

  // ---------------------------------------------------------------- end of run

  // Credits/XP earned purely from how the run went (missions & achievements add their own).
  runRewards(run) {
    const km = run.distance / 1000;
    const credits = [
      ['Distance', Math.round(km * CREDITS.PER_KM)],
      ['Score', Math.round((run.score / 1000) * CREDITS.PER_1000_SCORE)],
      ['Overtakes', run.overtakes * CREDITS.OVERTAKE + run.perfectOvertakes * CREDITS.PERFECT_OVERTAKE],
      ['Near misses', run.nearMisses * CREDITS.NEAR_MISS + run.insaneMisses * CREDITS.INSANE_BONUS],
      [`Best combo x${run.bestMultiplier}`, CREDITS.COMBO_TIER[Math.max(0, COMBO.TIERS.findIndex(t => t.mult === run.bestMultiplier))] || 0],
      ['High speed', Math.floor(run.highSpeedTime / 10) * CREDITS.HIGH_SPEED_PER_10S + run.chicanes * CREDITS.CHICANE],
      ['Bonuses', run.bonusCredits],
    ].filter(([, v]) => v > 0);
    const xp = Math.round(
      XP.RACE_COMPLETE + km * XP.PER_KM + (run.score / 1000) * XP.PER_1000_SCORE
      + run.nearMisses * XP.NEAR_MISS + run.perfectOvertakes * XP.PERFECT_OVERTAKE,
    );
    return { credits, xp };
  }

  // Adds XP and returns the list of levels gained.
  addXp(amount) {
    const s = this.save;
    const gained = [];
    s.xp += amount;
    while (s.level < XP.MAX_LEVEL && s.xp >= xpForLevel(s.level)) {
      s.xp -= xpForLevel(s.level);
      s.level++;
      gained.push(s.level);
    }
    return gained;
  }

  levelProgress() {
    const s = this.save;
    return { level: s.level, xp: s.xp, need: xpForLevel(s.level), title: titleForLevel(s.level) };
  }

  // Updates records; returns the keys that were beaten this run.
  updateRecords(run) {
    const r = this.save.records;
    const beaten = [];
    const check = (key, value) => {
      if (value > r[key]) {
        if (r[key] > 0 || key === 'score') beaten.push(key);
        r[key] = value;
      }
    };
    check('score', Math.floor(run.score));
    check('distance', run.distance);
    check('topSpeed', Math.round(run.topSpeed));
    check('combo', run.bestMultiplier);
    check('nearMisses', run.nearMisses);
    check('overtakes', run.overtakes);
    check('chase', run.longestChase);
    check('cleanDistance', run.bestCleanDistance);
    return beaten;
  }

  addLifetimeStats(run, carId, playTime) {
    const st = this.save.stats;
    st.races++;
    st.distance += run.distance;
    st.playTime += playTime;
    st.overtakes += run.overtakes;
    st.nearMisses += run.nearMisses;
    st.insaneMisses += run.insaneMisses;
    st.perfectOvertakes += run.perfectOvertakes;
    st.crashes += run.crashes;
    st.boostTime += run.boostTime;
    st.policeEscapes += run.policeEscapes;
    st.pickups += run.pickups;
    st.chicanes += run.chicanes;
    st.legendPasses += run.legendPasses;
    st.carDistance[carId] = (st.carDistance[carId] || 0) + run.distance;
  }

  // The cheapest upgrade for the selected car, flagged when the player can already afford it.
  nextUpgrade() {
    const car = this.selectedCar();
    let best = null;
    for (const key of UPGRADE_KEYS) {
      const cost = this.upgradeCost(car.id, key);
      if (cost !== null && (!best || cost < best.cost)) best = { key, cost, label: UPGRADES[key].label };
    }
    if (best) best.affordable = this.save.credits >= best.cost;
    return best;
  }

  // Closest locked (non-secret) car by unlock progress.
  nextCar() {
    let best = null;
    for (const car of CARS) {
      if (car.secret || this.isUnlocked(car.id)) continue;
      const p = this.unlockProgress(car);
      const ratio = Math.min(1, p.value / p.target);
      if (!best || ratio > best.ratio) best = { car, ratio, text: p.text };
    }
    return best;
  }

  favoriteCar() {
    let best = null;
    let bestDist = 0;
    for (const [id, dist] of Object.entries(this.save.stats.carDistance)) {
      if (dist > bestDist) {
        bestDist = dist;
        best = id;
      }
    }
    return best ? getCar(best) : null;
  }
}
