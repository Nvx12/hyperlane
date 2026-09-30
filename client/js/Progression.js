import * as E from './progression/engine.js';

export { UPGRADE_KEYS, getCar, upgradeBonus } from './progression/engine.js';

// Client façade over the progression engine (progression/engine.js holds every rule).
// Reads go straight to the engine. Every change is applied locally at once (the game never
// waits for the network), saved, and reported through onOperation so the sync layer can send
// it to the server — which re-applies the same rule and has the final word for online profiles.
export class Progression {
  constructor(store) {
    this.store = store;
    this.onOperation = null; // (type, payload) => void — set by the sync layer
  }

  get state() {
    return this.store.data.progress;
  }

  // ---------------------------------------------------------------- reads

  owns(id) {
    return this.state.ownedCars.includes(id);
  }

  selectedCar() {
    return E.getCar(this.owns(this.state.selectedCar) ? this.state.selectedCar : E.STARTER);
  }

  status(id) {
    return E.carStatus(this.state, id);
  }

  // Upgrades/customization of an owned car (a stock view for cars not owned yet).
  carState(id) {
    return this.state.cars[id] || E.newCarState(id);
  }

  getCarProfile(id, withUpgrades = true) {
    return E.carProfile(this.state, id, withUpgrades);
  }

  statBars(profile) {
    return E.statBars(profile);
  }

  upgrade(carId, key) {
    return E.upgradeInfo(this.state, carId, key);
  }

  cosmetic(slot, id) {
    return E.cosmeticInfo(this.state, slot, id);
  }

  levelProgress() {
    return E.levelInfo(this.state.xp);
  }

  // Cheapest upgrade for the selected car, flagged when the player can already afford it.
  nextUpgrade() {
    return E.nextUpgrade(this.state, this.selectedCar().id);
  }

  nextGoal() {
    return E.nextGoal(this.state);
  }

  favoriteCar() {
    let best = null;
    let bestDist = 0;
    for (const [id, dist] of Object.entries(this.state.stats.carDistance)) {
      if (dist > bestDist) {
        bestDist = dist;
        best = id;
      }
    }
    return best ? E.getCar(best) : null;
  }

  // ---------------------------------------------------------------- changes

  apply(type, payload, fn) {
    const result = fn(this.state);
    if (result.ok) {
      this.store.save();
      if (this.onOperation) this.onOperation(type, payload);
    }
    return result;
  }

  purchaseCar(carId) {
    return this.apply('purchaseCar', { carId }, s => E.purchaseCar(s, carId));
  }

  buyUpgrade(carId, key) {
    return this.apply('buyUpgrade', { carId, key }, s => E.buyUpgrade(s, carId, key));
  }

  selectCar(carId) {
    return this.apply('selectCar', { carId }, s => E.selectCar(s, carId));
  }

  buyCosmetic(slot, id) {
    return this.apply('buyCosmetic', { slot, id }, s => E.buyCosmetic(s, slot, id));
  }

  setCosmetic(carId, slot, id) {
    return this.apply('setCosmetic', { carId, slot, id }, s => E.setCosmetic(s, carId, slot, id));
  }

  // Settles a finished run locally (the sync layer submits the same run to the server).
  settleRun(run, dateKey) {
    const result = E.settleRun(this.state, run, { dateKey, now: Date.now() });
    this.store.save();
    return result;
  }
}
