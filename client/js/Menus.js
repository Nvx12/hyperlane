import { CARS, UPGRADES } from './balance.js';
import { UPGRADE_KEYS, getCar, upgradeBonus } from './Progression.js';
import { COSMETICS, COSMETIC_SLOTS, resolveCustom } from './data/cosmetics.js';
import { getEnvironment } from './Environment.js';
import { createPlayerSprites, createUnderglowSprite } from './Sprites.js';
import { escapeHtml } from './UIManager.js';

// The five stats a player actually reads on a phone (braking lives in the upgrade list).
const STAT_KEYS = [['TOP SPEED', 'SPEED'], ['ACCELERATION', 'ACCELERATION'], ['HANDLING', 'HANDLING'], ['BOOST', 'BOOST'], ['DURABILITY', 'DURABILITY']];
const SWIPE_MIN_PX = 40;

// Menu screens. Everything here is event-driven DOM work (never per-frame), except the
// garage preview canvas which the game loop redraws while the garage is open.
export class Menus {
  constructor(game) {
    this.game = game;
    this.current = 'home';
    this.garageCarId = null;
    this.gtab = 'upgrades';
    this.sheetOpen = false;
    this.previewCache = new Map();
    this.previewEntry = null;
    this.previewTime = 0;
    this.previewCanvas = document.getElementById('garage-canvas');
    this.previewCtx = this.previewCanvas.getContext('2d');
    this.sheet = document.getElementById('upgrade-sheet');
    this.renderers = {
      home: () => this.renderHome(),
      garage: () => this.renderGarage(),
    };

    document.addEventListener('click', e => {
      const nav = e.target.closest('[data-nav]');
      if (nav) {
        e.preventDefault();
        nav.blur();
        this.game.audio.ui('click');
        this.open(nav.dataset.nav);
        return;
      }
      const tab = e.target.closest('[data-gtab]');
      if (tab) {
        this.game.audio.ui('click');
        this.gtab = tab.dataset.gtab;
        this.renderGarageTab();
        return;
      }
      const step = e.target.closest('[data-car-step]');
      if (step) {
        this.stepCar(Number(step.dataset.carStep));
        return;
      }
      if (e.target.closest('[data-sheet-close]') || e.target === this.sheet) {
        this.closeSheet();
        return;
      }
      const act = e.target.closest('[data-gact]');
      if (act) this.garageAction(act.dataset.gact, act.dataset.key, act.dataset.value);
    });

    // Swipe between cars on the stage (the page itself never scrolls horizontally).
    const stage = document.getElementById('car-stage');
    let startX = null;
    let startY = 0;
    stage.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      startX = e.clientX;
      startY = e.clientY;
    });
    stage.addEventListener('pointerup', e => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      startX = null;
      if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.3) this.stepCar(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', () => { startX = null; });
  }

  get progression() {
    return this.game.progression;
  }

  register(name, renderer) {
    this.renderers[name] = renderer;
  }

  open(name) {
    if (name === 'play' && !this.renderers.play) {
      this.game.startRace();
      return;
    }
    if (this.sheetOpen) this.closeSheet();
    this.current = name;
    this.game.ui.showScreen(name === 'home' ? 'menu' : name);
    this.refreshTopbar();
    const render = this.renderers[name];
    if (render) render();
  }

  back() {
    if (this.current !== 'home') this.open('home');
  }

  refreshTopbar() {
    const prog = this.progression;
    this.game.ui.setTopbar({ ...prog.levelProgress(), credits: prog.save.credits });
    const credits = prog.save.credits.toLocaleString('en-US');
    document.getElementById('sheet-credits').textContent = credits;
    document.getElementById('garage-credits').textContent = credits;
  }

  renderHome() {
    const prog = this.progression;
    const car = prog.selectedCar();
    document.getElementById('home-car-name').textContent = car.name;
    document.getElementById('home-car-class').textContent = car.role;
    const env = getEnvironment(this.game.selectedEnv);
    document.getElementById('home-route').textContent = this.game.tour ? 'World tour' : env.name;
    if (this.onHome) this.onHome();
  }

  // ---------------------------------------------------------------- garage

  stepCar(dir) {
    const i = CARS.findIndex(c => c.id === this.garageCarId);
    const next = CARS[(i + dir + CARS.length) % CARS.length];
    this.garageCarId = next.id;
    this.game.audio.ui('click');
    this.game.haptics.pulse('tap');
    this.renderGarage();
  }

  renderGarage() {
    this.previewEntry = null;
    const prog = this.progression;
    if (!this.garageCarId) this.garageCarId = prog.selectedCar().id;
    const car = getCar(this.garageCarId);
    const unlocked = prog.isUnlocked(car.id);
    const hidden = car.secret && !unlocked;

    document.getElementById('car-dots').innerHTML = CARS.map(c =>
      `<i class="${c.id === car.id ? 'active' : ''} ${prog.isUnlocked(c.id) ? '' : 'locked'}"></i>`).join('');
    document.getElementById('garage-class').textContent = hidden ? 'Secret vehicle' : car.class;
    document.getElementById('garage-name').textContent = hidden ? '???' : car.name;
    document.getElementById('garage-role').textContent = hidden ? '' : car.role;
    document.getElementById('garage-stats').innerHTML = hidden ? '<p class="muted">Specifications classified.</p>' : this.statsHtml(car);

    const action = document.getElementById('garage-action');
    const up = unlocked ? this.cheapestUpgrade(car.id) : null;
    const upgradeBtn = `<button class="btn btn-ghost" data-gact="openUpgrades" ${unlocked ? '' : 'disabled'}>Upgrade${up && up.affordable ? '<span class="badge">READY</span>' : ''}</button>`;
    if (unlocked) {
      const selected = prog.save.selectedCar === car.id;
      action.innerHTML = `<div class="btn-pair">${selected
        ? '<span class="chip big">Driving</span>'
        : '<button class="btn btn-primary" data-gact="select">Select</button>'}${upgradeBtn}</div>`;
    } else {
      const p = prog.unlockProgress(car);
      const ratio = Math.min(1, p.value / p.target);
      const value = car.unlock.type === 'secret' ? '' : `${this.fmtProgress(car, p.value)} / ${this.fmtProgress(car, p.target)}`;
      action.innerHTML = `<div class="unlock-req"><span class="hud-label">To unlock</span><p>${escapeHtml(p.text)}</p>
        ${car.unlock.type === 'secret' ? '' : `<div class="xp-bar big"><i style="transform:scaleX(${ratio})"></i></div><small>${value}</small>`}</div>`;
    }
    this.refreshTopbar();
    if (this.sheetOpen) this.renderGarageTab();
  }

  cheapestUpgrade(carId) {
    const prog = this.progression;
    let best = null;
    for (const key of UPGRADE_KEYS) {
      const cost = prog.upgradeCost(carId, key);
      if (cost !== null && (!best || cost < best.cost)) best = { key, cost };
    }
    if (best) best.affordable = prog.save.credits >= best.cost;
    return best;
  }

  fmtProgress(car, v) {
    if (car.unlock.type === 'totalDistance') return `${(v / 1000).toFixed(1)} km`;
    if (car.unlock.type === 'topSpeed') return `${Math.round(v)} km/h`;
    return Math.floor(v).toLocaleString('en-US');
  }

  // Upgrade / style drawer (a sheet over the garage; Back closes it).
  openSheet(tab = 'upgrades') {
    if (this.current !== 'garage') return;
    if (!this.progression.isUnlocked(this.garageCarId || this.progression.selectedCar().id)) return;
    this.gtab = tab;
    this.sheetOpen = true;
    this.sheet.hidden = false;
    this.renderGarageTab();
  }

  closeSheet() {
    this.sheetOpen = false;
    this.sheet.hidden = true;
  }

  renderGarageTab() {
    document.querySelectorAll('[data-gtab]').forEach(t => t.classList.toggle('active', t.dataset.gtab === this.gtab));
    const car = getCar(this.garageCarId);
    const unlocked = this.progression.isUnlocked(car.id);
    const body = document.getElementById('garage-tab');
    body.innerHTML = this.gtab === 'style' ? this.styleHtml(car, unlocked) : this.upgradesHtml(car, unlocked);
  }

  statsHtml(car) {
    const prog = this.progression;
    const base = prog.statBars(prog.getCarProfile(car.id, false));
    const tuned = prog.statBars(prog.getCarProfile(car.id, true));
    const p = prog.getCarProfile(car.id, true);
    const values = {
      'TOP SPEED': `${Math.round(p.topKmh)} km/h`,
      ACCELERATION: p.accel.toFixed(1),
      HANDLING: p.lateralMax.toFixed(1),
      BOOST: `+${Math.round(p.boostKmh)} km/h`,
      DURABILITY: `${Math.round(100 / p.damageMult)}%`,
    };
    return STAT_KEYS.map(([k, label]) => `
      <div class="stat-bar"><div class="stat-head"><span>${label}</span><b>${values[k]}</b></div>
        <div class="bar-track"><i class="gain" style="transform:scaleX(${tuned[k]})"></i><i class="base" style="transform:scaleX(${base[k]})"></i></div></div>`).join('');
  }

  upgradesHtml(car, unlocked) {
    const prog = this.progression;
    const state = prog.carState(car.id);
    const credits = prog.save.credits;
    return `<div class="upgrade-list">${UPGRADE_KEYS.map(key => {
      const u = UPGRADES[key];
      const level = state.upgrades[key];
      const cost = prog.upgradeCost(car.id, key);
      const max = cost === null;
      const next = max ? '' : `+${u.steps[level]}%`;
      const afford = !max && credits >= cost && unlocked;
      const pips = u.steps.map((_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
      return `<div class="upgrade-row">
        <div class="up-info"><b>${u.label}</b><small>${u.stat} · +${Math.round(upgradeBonus(key, level) * 100)}%</small><div class="pips">${pips}</div></div>
        ${max ? '<span class="chip">Maxed</span>' : `<button class="buy-btn" data-gact="buy" data-key="${key}" ${afford ? '' : 'disabled'}><span>${next}</span><b>◈ ${cost.toLocaleString('en-US')}</b></button>`}
      </div>`;
    }).join('')}</div>`;
  }

  styleHtml(car, unlocked) {
    const prog = this.progression;
    const custom = prog.carState(car.id).custom;
    const level = prog.save.level;
    return `<div class="style-list">${COSMETIC_SLOTS.map(([slot, label]) => `
      <div class="style-row"><span class="hud-label">${label}</span><div class="chips">${COSMETICS[slot].map(o => {
        const locked = !unlocked || (o.level && level < o.level);
        const swatch = o.color || (o.rgb ? `rgb(${o.rgb})` : slot === 'paint' ? car.paint : '');
        return `<button class="opt ${custom[slot] === o.id ? 'active' : ''} ${locked ? 'locked' : ''}" data-gact="style" data-key="${slot}" data-value="${o.id}" ${locked ? 'disabled' : ''}>
          ${swatch ? `<i style="background:${swatch}"></i>` : ''}<span>${escapeHtml(o.label)}</span>${o.level && level < o.level ? `<small>Lv ${o.level}</small>` : ''}</button>`;
      }).join('')}</div></div>`).join('')}</div>`;
  }

  garageAction(action, key, value) {
    const prog = this.progression;
    const audio = this.game.audio;
    const id = this.garageCarId;
    if (action === 'openUpgrades') {
      audio.ui('click');
      this.openSheet('upgrades');
      return;
    }
    if (action === 'select') {
      if (prog.selectCar(id)) {
        audio.ui('confirm');
        this.game.haptics.pulse('tap');
        this.game.applySelectedCar();
        this.game.analytics.track('car_selected', { car: id });
      }
    } else if (action === 'buy') {
      if (prog.buyUpgrade(id, key)) {
        audio.purchase();
        this.game.haptics.pulse('unlock');
        this.game.analytics.track('upgrade_bought', { car: id, upgrade: key, level: prog.carState(id).upgrades[key] });
        if (id === prog.save.selectedCar) this.game.applySelectedCar();
      } else {
        audio.ui('deny');
      }
    } else if (action === 'style') {
      if (prog.setCustom(id, key, value)) {
        audio.ui('click');
        if (id === prog.save.selectedCar) this.game.applySelectedCar();
      }
    }
    this.renderGarage();
  }

  // ---------------------------------------------------------------- preview

  previewSprites(car, locked) {
    const custom = this.progression.carState(car.id).custom;
    const key = `${car.id}|${locked}|${JSON.stringify(custom)}`;
    let entry = this.previewCache.get(key);
    if (!entry) {
      const look = resolveCustom(car, custom);
      const sprites = createPlayerSprites(car, { paint: look.paint, rim: look.rim, accent: look.underglowRgb ? `rgb(${look.underglowRgb})` : null });
      let canvas = sprites.normal.canvas;
      if (locked) {
        // Silhouette for locked cars.
        const sil = document.createElement('canvas');
        sil.width = canvas.width;
        sil.height = canvas.height;
        const sctx = sil.getContext('2d');
        sctx.drawImage(canvas, 0, 0);
        sctx.globalCompositeOperation = 'source-atop';
        sctx.fillStyle = '#0c0818';
        sctx.fillRect(0, 0, sil.width, sil.height);
        canvas = sil;
      }
      entry = { sprite: sprites.normal, canvas, glow: look.underglowRgb && !locked ? createUnderglowSprite(look.underglowRgb) : null };
      if (this.previewCache.size > 24) this.previewCache.clear();
      this.previewCache.set(key, entry);
    }
    return entry;
  }

  // Floor glow and sweep gradients are built once per canvas size (not per frame).
  previewGradients(W, H) {
    const g = this.gradients;
    if (g && g.W === W && g.H === H) return g;
    const ctx = this.previewCtx;
    const floor = locked => {
      const grad = ctx.createRadialGradient(W / 2, H * 0.82, 10, W / 2, H * 0.82, W * 0.55);
      grad.addColorStop(0, locked ? 'rgba(120,110,160,0.18)' : 'rgba(255,45,149,0.28)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      return grad;
    };
    const sweep = ctx.createLinearGradient(-60, 0, 60, 0);
    sweep.addColorStop(0, 'rgba(34,230,255,0)');
    sweep.addColorStop(0.5, 'rgba(34,230,255,0.12)');
    sweep.addColorStop(1, 'rgba(34,230,255,0)');
    this.gradients = { W, H, open: floor(false), locked: floor(true), sweep };
    return this.gradients;
  }

  renderPreview(dt) {
    if (this.current !== 'garage' || !this.garageCarId) return;
    this.previewTime += dt;
    const canvas = this.previewCanvas;
    const ctx = this.previewCtx;
    const W = canvas.width;
    const H = canvas.height;
    const car = getCar(this.garageCarId);
    const locked = !this.progression.isUnlocked(car.id);
    // Resolved once per garage re-render (car/paint change), not per frame.
    if (!this.previewEntry) this.previewEntry = this.previewSprites(car, locked);
    const entry = this.previewEntry;
    const t = this.previewTime;
    const grads = this.previewGradients(W, H);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = locked ? grads.locked : grads.open;
    ctx.fillRect(0, 0, W, H);
    // Light sweep across the platform
    ctx.save();
    ctx.translate(((t * 0.35) % 1.6 - 0.3) * W, 0);
    ctx.fillStyle = grads.sweep;
    ctx.fillRect(-60, H * 0.7, 120, H * 0.3);
    ctx.restore();

    const sprite = entry.sprite;
    const scale = Math.min((W * 0.62) / (car.width * sprite.ppm), (H * 0.62) / (car.height * sprite.ppm * 1.6));
    const bob = Math.sin(t * 2) * 2;
    const groundY = H * 0.8;
    if (entry.glow) {
      ctx.globalCompositeOperation = 'lighter';
      const gw = car.width * sprite.ppm * scale * 1.6;
      ctx.drawImage(entry.glow, W / 2 - gw / 2, groundY - gw * 0.12, gw, gw * 0.3);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(entry.canvas, W / 2 - sprite.anchorX * scale, groundY - sprite.anchorY * scale + bob, entry.canvas.width * scale, entry.canvas.height * scale);
  }
}
