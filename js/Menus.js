import { CARS, UPGRADES } from './balance.js';
import { UPGRADE_KEYS, getCar, upgradeBonus } from './Progression.js';
import { COSMETICS, COSMETIC_SLOTS, resolveCustom } from './data/cosmetics.js';
import { createPlayerSprites, createUnderglowSprite } from './Sprites.js';
import { escapeHtml } from './UIManager.js';

const STAT_KEYS = ['TOP SPEED', 'ACCELERATION', 'HANDLING', 'BRAKING', 'BOOST', 'DURABILITY'];

// Menu screens. Everything here is event-driven DOM work (never per-frame), except the
// garage preview canvas which the game loop redraws while the garage is open.
export class Menus {
  constructor(game) {
    this.game = game;
    this.current = 'home';
    this.garageCarId = null;
    this.gtab = 'stats';
    this.previewCache = new Map();
    this.previewEntry = null;
    this.previewTime = 0;
    this.previewCanvas = document.getElementById('garage-canvas');
    this.previewCtx = this.previewCanvas.getContext('2d');
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
      const carBtn = e.target.closest('[data-car]');
      if (carBtn) {
        this.game.audio.ui('click');
        this.garageCarId = carBtn.dataset.car;
        this.renderGarage();
        return;
      }
      const act = e.target.closest('[data-gact]');
      if (act) this.garageAction(act.dataset.gact, act.dataset.key, act.dataset.value);
    });
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
  }

  renderHome() {
    const prog = this.progression;
    const car = prog.selectedCar();
    document.getElementById('home-car-name').textContent = car.name;
    document.getElementById('home-car-class').textContent = `${car.class} · ${car.role}`;
    if (this.onHome) this.onHome();
  }

  // ---------------------------------------------------------------- garage

  renderGarage() {
    this.previewEntry = null;
    const prog = this.progression;
    if (!this.garageCarId) this.garageCarId = prog.selectedCar().id;
    const car = getCar(this.garageCarId);
    const unlocked = prog.isUnlocked(car.id);
    const hidden = car.secret && !unlocked;

    document.getElementById('car-list').innerHTML = CARS.map(c => {
      const open = prog.isUnlocked(c.id);
      const secretHidden = c.secret && !open;
      const selected = prog.save.selectedCar === c.id;
      return `<button class="car-card ${c.id === car.id ? 'active' : ''} ${open ? '' : 'locked'}" data-car="${c.id}">
        <span class="car-card-name">${secretHidden ? '???' : escapeHtml(c.name)}</span>
        <small>${secretHidden ? 'Secret' : escapeHtml(c.class)}</small>
        ${selected ? '<em class="chip">Driving</em>' : open ? '' : '<em class="chip lock">Locked</em>'}
      </button>`;
    }).join('');

    document.getElementById('garage-class').textContent = hidden ? 'Secret vehicle' : car.class;
    document.getElementById('garage-name').textContent = hidden ? '???' : car.name;
    document.getElementById('garage-blurb').innerHTML = hidden ? '' : `<b class="car-role">${escapeHtml(car.role)}</b>${escapeHtml(car.blurb)}`;

    const action = document.getElementById('garage-action');
    if (unlocked) {
      const selected = prog.save.selectedCar === car.id;
      action.innerHTML = selected
        ? '<span class="chip big">Currently driving</span>'
        : '<button class="btn btn-primary" data-gact="select">Select car</button>';
    } else {
      const p = prog.unlockProgress(car);
      const ratio = Math.min(1, p.value / p.target);
      const value = car.unlock.type === 'secret' ? '' : `${this.fmtProgress(car, p.value)} / ${this.fmtProgress(car, p.target)}`;
      action.innerHTML = `<div class="unlock-req"><span class="hud-label">To unlock</span><p>${escapeHtml(p.text)}</p>
        ${car.unlock.type === 'secret' ? '' : `<div class="xp-bar big"><i style="transform:scaleX(${ratio})"></i></div><small>${value}</small>`}</div>`;
    }
    this.renderGarageTab();
  }

  fmtProgress(car, v) {
    if (car.unlock.type === 'totalDistance') return `${(v / 1000).toFixed(1)} km`;
    if (car.unlock.type === 'topSpeed') return `${Math.round(v)} km/h`;
    return Math.floor(v).toLocaleString('en-US');
  }

  renderGarageTab() {
    document.querySelectorAll('[data-gtab]').forEach(t => t.classList.toggle('active', t.dataset.gtab === this.gtab));
    const prog = this.progression;
    const car = getCar(this.garageCarId);
    const unlocked = prog.isUnlocked(car.id);
    const body = document.getElementById('garage-tab');
    if (car.secret && !unlocked) {
      body.innerHTML = '<p class="muted">Specifications classified.</p>';
      return;
    }
    if (this.gtab === 'stats') body.innerHTML = this.statsHtml(car);
    else if (this.gtab === 'upgrades') body.innerHTML = this.upgradesHtml(car, unlocked);
    else body.innerHTML = this.styleHtml(car, unlocked);
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
      BRAKING: p.brake.toFixed(0),
      BOOST: `+${Math.round(p.boostKmh)} km/h`,
      DURABILITY: `${Math.round(100 / p.damageMult)}%`,
    };
    return `<div class="stat-bars">${STAT_KEYS.map(k => `
      <div class="stat-bar"><div class="stat-head"><span>${k}</span><b>${values[k]}</b></div>
        <div class="bar-track"><i class="gain" style="transform:scaleX(${tuned[k]})"></i><i class="base" style="transform:scaleX(${base[k]})"></i></div></div>`).join('')}
    </div><p class="muted small">Bright segments show upgrade gains.</p>`;
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
    }).join('')}</div>${unlocked ? '' : '<p class="muted small">Unlock this car to upgrade it.</p>'}`;
  }

  styleHtml(car, unlocked) {
    const prog = this.progression;
    const custom = prog.carState(car.id).custom;
    const level = prog.save.level;
    return `<div class="style-list">${COSMETIC_SLOTS.map(([slot, label]) => `
      <div class="style-row"><span class="hud-label">${label}</span><div class="chips">${COSMETICS[slot].map(o => {
        const locked = !unlocked || (o.level && level < o.level);
        const swatch = o.color || (o.rgb ? `rgb(${o.rgb})` : slot === 'paint' ? car.paint : '');
        return `<button class="opt ${custom[slot] === o.id ? 'active' : ''} ${locked ? 'locked' : ''}" data-gact="style" data-key="${slot}" data-value="${o.id}" ${locked ? 'disabled' : ''} title="${o.level && level < o.level ? `Unlocks at level ${o.level}` : escapeHtml(o.label)}">
          ${swatch ? `<i style="background:${swatch}"></i>` : ''}<span>${escapeHtml(o.label)}</span>${o.level && level < o.level ? `<small>Lv ${o.level}</small>` : ''}</button>`;
      }).join('')}</div></div>`).join('')}</div>`;
  }

  garageAction(action, key, value) {
    const prog = this.progression;
    const audio = this.game.audio;
    const id = this.garageCarId;
    if (action === 'select') {
      if (prog.selectCar(id)) {
        audio.ui('confirm');
        this.game.applySelectedCar();
      }
    } else if (action === 'buy') {
      if (prog.buyUpgrade(id, key)) {
        audio.purchase();
        if (id === prog.save.selectedCar) this.game.applySelectedCar();
        this.refreshTopbar();
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

    ctx.clearRect(0, 0, W, H);
    const floor = ctx.createRadialGradient(W / 2, H * 0.82, 10, W / 2, H * 0.82, W * 0.55);
    floor.addColorStop(0, locked ? 'rgba(120,110,160,0.18)' : 'rgba(255,45,149,0.28)');
    floor.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, W, H);
    // Light sweep across the platform
    const sweepX = ((t * 0.35) % 1.6 - 0.3) * W;
    const sweep = ctx.createLinearGradient(sweepX - 60, 0, sweepX + 60, 0);
    sweep.addColorStop(0, 'rgba(34,230,255,0)');
    sweep.addColorStop(0.5, 'rgba(34,230,255,0.12)');
    sweep.addColorStop(1, 'rgba(34,230,255,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, H * 0.7, W, H * 0.3);

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
