const SPEEDO_ARC = 395.84; // 270° of a r=84 circle
const SPEEDO_CIRC = 527.79;
const SPEEDO_MAX_KMH = 420;
const TOAST_LIMIT = 3;
const TOAST_TIME = 3600;

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// DOM overlay: HUD, race overlays, screen switching and results. HUD writes are throttled
// by the caller and diffed here, so gameplay touches the DOM only when a value changes.
export class UIManager {
  constructor(handlers) {
    const $ = id => document.getElementById(id);
    this.$ = $;
    this.el = {
      hud: $('hud'),
      score: $('hud-score'),
      best: $('hud-best'),
      mult: $('hud-mult'),
      multBlock: $('hud-mult-block'),
      multBar: $('hud-mult-bar'),
      comboTimer: $('hud-combo-timer'),
      slipstream: $('hud-slipstream'),
      hitLeft: $('hit-left'),
      hitRight: $('hit-right'),
      distance: $('hud-distance'),
      speed: $('hud-speed'),
      speedo: $('speedo'),
      speedArc: $('speedo-arc'),
      health: $('hud-health'),
      healthMeter: $('meter-health'),
      boost: $('hud-boost'),
      boostMeter: $('meter-boost'),
      callout: $('callout'),
      toasts: $('toasts'),
      touch: $('touch-controls'),
      fps: $('fps'),
      topbar: $('menu-topbar'),
      banner: $('event-banner'),
      bannerKicker: $('event-kicker'),
      bannerTitle: $('event-title'),
      bannerSub: $('event-sub'),
      bannerBar: $('event-bar'),
      tracker: $('mission-tracker'),
      pauseMissions: $('pause-missions'),
    };
    this.screens = {};
    document.querySelectorAll('.screen').forEach(s => { this.screens[s.id.replace('screen-', '')] = s; });
    this.numberFormat = new Intl.NumberFormat('en-US');
    this.cache = {};
    this.resetCache();
    this.fpsVisible = false;
    this.touchMode = 'auto';
    this.touchSeen = false;
    this.hudVisible = false;
    this.bannerState = { visible: false, progress: -1, sub: '' };

    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.currentTarget.blur();
        if (handlers.uiSound) handlers.uiSound('click');
        const fn = handlers[btn.dataset.action];
        if (fn) fn();
      });
    });
    // Hover sounds via delegation: one listener instead of one per button.
    document.addEventListener('pointerover', e => {
      const btn = e.target.closest && e.target.closest('button');
      if (btn && btn !== this.lastHover && handlers.uiSound) handlers.uiSound('hover');
      this.lastHover = btn;
    });
  }

  resetCache() {
    const c = this.cache;
    c.score = c.best = c.speed = c.distance = c.mult = c.multBar = c.comboTime = c.health = c.boost = -1;
    c.boosting = c.lowHealth = c.boostReady = c.slipstream = null;
  }

  format(n) {
    return this.numberFormat.format(Math.floor(n));
  }

  // ---------------------------------------------------------------- screens

  showScreen(name) {
    for (const key in this.screens) this.screens[key].classList.toggle('active', key === name);
    const menuScreens = name && !['pause', 'results'].includes(name);
    this.el.topbar.classList.toggle('visible', Boolean(menuScreens));
    if (!name) return;
    const primary = this.screens[name].querySelector('.btn-primary');
    if (primary && !this.isTouchDevice()) primary.focus({ preventScroll: true });
  }

  setHudVisible(visible, intro = false) {
    this.hudVisible = visible;
    document.body.classList.toggle('in-race', visible);
    this.el.hud.classList.toggle('hidden', !visible);
    this.el.hud.classList.toggle('intro', visible && intro);
    this.updateTouchVisibility();
    if (visible) this.resetCache();
    if (!visible) this.hideBanner();
  }

  setTouchMode(mode) {
    this.touchMode = mode;
    this.updateTouchVisibility();
  }

  // Touch devices: a coarse primary pointer, touch points without a fine pointer, or an
  // actual touch already seen this session (some browsers misreport media queries).
  isTouchDevice() {
    const mm = q => window.matchMedia(q).matches;
    return this.touchSeen || mm('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && !mm('(pointer: fine)'));
  }

  noteTouch() {
    if (this.touchSeen) return;
    this.touchSeen = true;
    this.updateTouchVisibility();
  }

  updateTouchVisibility() {
    const padActive = document.body.classList.contains('pad-active');
    const show = this.hudVisible && (this.touchMode === 'on' || (this.touchMode === 'auto' && this.isTouchDevice() && !padActive));
    this.el.touch.classList.toggle('enabled', show);
    document.body.classList.toggle('touch-device', this.isTouchDevice());
    document.body.classList.toggle('touch-active', show);
  }

  setTopbar(p) {
    const $ = this.$;
    $('top-level').textContent = p.level;
    $('top-title').textContent = p.title;
    $('top-xp').style.transform = `scaleX(${Math.min(1, p.xp / p.need)})`;
    $('top-xp-text').textContent = `${this.format(p.xp)} / ${this.format(p.need)} XP`;
    $('top-credits').textContent = this.format(p.credits);
  }

  // ---------------------------------------------------------------- HUD

  updateHud(d) {
    const c = this.cache;
    const el = this.el;
    const score = Math.floor(d.score);
    if (score !== c.score) {
      c.score = score;
      el.score.textContent = this.format(score);
    }
    if (d.best !== c.best) {
      c.best = d.best;
      el.best.textContent = this.format(d.best);
    }
    const speed = Math.round(d.speed);
    if (speed !== c.speed) {
      c.speed = speed;
      el.speed.textContent = speed;
      const ratio = Math.min(1, speed / SPEEDO_MAX_KMH);
      el.speedArc.setAttribute('stroke-dasharray', `${(SPEEDO_ARC * ratio).toFixed(1)} ${SPEEDO_CIRC}`);
    }
    const distance = Math.floor(d.distance / 10);
    if (distance !== c.distance) {
      c.distance = distance;
      el.distance.textContent = (d.distance / 1000).toFixed(2);
    }
    if (d.mult !== c.mult) {
      c.mult = d.mult;
      el.mult.textContent = `x${d.mult}`;
      el.multBlock.dataset.tier = d.tier;
    }
    const multBar = Math.round(d.tierProgress * 50) / 50;
    if (multBar !== c.multBar) {
      c.multBar = multBar;
      el.multBar.style.transform = `scaleX(${multBar})`;
    }
    const comboTime = Math.round(d.comboTime * 40) / 40;
    if (comboTime !== c.comboTime) {
      c.comboTime = comboTime;
      el.comboTimer.style.transform = `scaleX(${comboTime})`;
    }
    if (d.slipstream !== c.slipstream) {
      c.slipstream = d.slipstream;
      el.slipstream.classList.toggle('active', d.slipstream);
    }
    const health = Math.round(d.health);
    if (health !== c.health) {
      if (health < c.health) this.restartAnimation(el.healthMeter, 'hit');
      c.health = health;
      el.health.style.transform = `scaleX(${health / 100})`;
    }
    const boost = Math.round(d.boost);
    if (boost !== c.boost) {
      c.boost = boost;
      el.boost.style.transform = `scaleX(${boost / 100})`;
    }
    if (d.boosting !== c.boosting) {
      c.boosting = d.boosting;
      el.boostMeter.classList.toggle('boosting', d.boosting);
      el.speedo.classList.toggle('boosting', d.boosting);
    }
    if (d.boostReady !== c.boostReady) {
      c.boostReady = d.boostReady;
      el.boostMeter.classList.toggle('empty', !d.boostReady);
    }
    if (d.lowHealth !== c.lowHealth) {
      c.lowHealth = d.lowHealth;
      el.healthMeter.classList.toggle('low', d.lowHealth);
    }
  }

  restartAnimation(node, className) {
    node.classList.remove(className);
    void node.offsetWidth; // force reflow so the animation replays (rare event, not per-frame)
    node.classList.add(className);
  }

  // +1: tier up (pop), -1: tier decayed (shake).
  comboPulse(direction) {
    const block = this.el.multBlock;
    block.classList.remove('pop', 'drop');
    void block.offsetWidth;
    block.classList.add(direction > 0 ? 'pop' : 'drop');
  }

  // Brief red edge on the side the hit came from.
  damageFlash(side) {
    this.restartAnimation(side > 0 ? this.el.hitRight : this.el.hitLeft, 'show');
  }

  showCallout(text, variant = '') {
    const node = this.el.callout;
    node.textContent = text;
    node.dataset.variant = variant;
    this.restartAnimation(node, 'show');
  }

  // Event/police banner under the combo. progress: 0..1 bar, or -1 for none.
  showBanner(kicker, title, sub, variant = '') {
    const el = this.el;
    el.bannerKicker.textContent = kicker;
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub;
    el.banner.dataset.variant = variant;
    el.banner.classList.add('visible');
    this.bannerState.visible = true;
    this.bannerState.sub = sub;
    this.bannerState.progress = -2;
  }

  updateBanner(sub, progress) {
    const st = this.bannerState;
    if (!st.visible) return;
    if (sub !== null && sub !== st.sub) {
      st.sub = sub;
      this.el.bannerSub.textContent = sub;
    }
    const p = Math.round(progress * 100) / 100;
    if (p !== st.progress) {
      st.progress = p;
      this.el.bannerBar.style.transform = `scaleX(${Math.max(0, p)})`;
      this.el.bannerBar.parentElement.style.display = p < 0 ? 'none' : '';
    }
  }

  hideBanner() {
    if (!this.bannerState.visible) return;
    this.bannerState.visible = false;
    this.el.banner.classList.remove('visible');
  }

  showRaceIntro(showControls, tip) {
    this.$('intro-keys').classList.toggle('hidden', !showControls);
    this.$('intro-pad').classList.toggle('hidden', !showControls);
    this.$('intro-tip').textContent = tip;
    this.$('race-intro').classList.add('visible');
  }

  hideRaceIntro() {
    this.$('race-intro').classList.remove('visible');
  }

  peekMissions(on) {
    this.el.tracker.classList.toggle('peek', on);
  }

  // Non-blocking notification (achievements, unlocks, missions, level-ups).
  toast(kicker, title, variant = '') {
    const box = this.el.toasts;
    while (box.children.length >= TOAST_LIMIT) box.firstElementChild.remove();
    const node = document.createElement('div');
    node.className = `toast ${variant}`;
    node.innerHTML = `<span class="toast-kicker">${escapeHtml(kicker)}</span><b>${escapeHtml(title)}</b>`;
    box.appendChild(node);
    setTimeout(() => node.classList.add('leaving'), TOAST_TIME);
    setTimeout(() => node.remove(), TOAST_TIME + 400);
  }

  // Compact in-race list of active mission progress. Rebuilt only when progress text changes.
  setMissionTracker(items) {
    const html = items.map(m => `<div class="track ${m.done ? 'done' : ''}"><span>${escapeHtml(m.text)}</span><b>${escapeHtml(m.progress)}</b></div>`).join('');
    if (html !== this.trackerHtml) {
      this.trackerHtml = html;
      this.el.tracker.innerHTML = html;
      this.el.pauseMissions.innerHTML = html ? `<span class="hud-label">Missions</span>${html}` : '';
    }
  }

  // ---------------------------------------------------------------- results

  // Online ranking line under the score. state: hidden | pending | an online result.
  setOnlineResult(res) {
    const el = this.$('res-online');
    el.className = 'online-line';
    if (!res) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    let text;
    if (res === 'pending') {
      text = 'Submitting to the leaderboard…';
      el.classList.add('pending');
    } else if (res.status === 'ranked') {
      const r = res.ranks;
      const parts = [r.day && `#${r.day.rank} today`, r.week && `#${r.week.rank} this week`, r.all && `#${r.all.rank} all time`].filter(Boolean);
      text = `${res.personalBest ? 'Online best! ' : ''}Ranked ${parts.join(' · ')}`;
      el.classList.add('ranked');
    } else if (res.status === 'queued') {
      text = 'Offline — your run will be submitted when you reconnect';
    } else if (res.status === 'rejected') {
      text = res.message || 'Not ranked';
      el.classList.add('rejected');
    } else {
      el.hidden = true;
      return;
    }
    el.textContent = text;
  }

  // Shows the share text in a selectable field and tries the legacy copy command.
  // Returns true if the text reached the clipboard.
  showShareFallback(text) {
    const box = this.$('share-fallback');
    const input = this.$('share-link');
    box.hidden = false;
    input.value = text;
    input.focus({ preventScroll: true });
    input.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }

  showResults(r) {
    const $ = this.$;
    $('share-fallback').hidden = true;
    $('results-title').textContent = r.title;
    $('res-score').textContent = this.format(r.score);
    $('res-newbest').classList.toggle('visible', r.newBest);
    $('res-stats').innerHTML = r.stats.map(([label, value, record]) =>
      `<div class="${record ? 'record' : ''}"><span class="hud-label">${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${record ? '<em>NEW RECORD</em>' : ''}</div>`).join('');
    $('res-credits').textContent = `+${this.format(r.creditsTotal)}`;
    $('res-credit-list').innerHTML = r.credits.map(([label, v]) => `<li><span>${escapeHtml(label)}</span><b>+${this.format(v)}</b></li>`).join('');
    $('res-xp').textContent = `+${this.format(r.xp)}`;
    $('res-level').textContent = r.level.level;
    $('res-levelup').textContent = r.levelsGained.length ? `LEVEL UP! You are now level ${r.level.level} — ${r.level.title}` : r.level.title;
    $('res-levelup').classList.toggle('active', r.levelsGained.length > 0);
    $('res-events').innerHTML = r.events.slice(0, 4).map(([kind, text]) => `<li class="${kind}">${escapeHtml(text)}</li>`).join('');
    $('res-next').innerHTML = r.next.map(n => `<li class="${n.hot ? 'hot' : ''}"><div><b>${escapeHtml(n.title)}</b><small>${escapeHtml(n.detail)}</small></div>
      ${n.ratio >= 0 ? `<div class="xp-bar"><i style="transform:scaleX(${n.ratio})"></i></div>` : ''}</li>`).join('');
    this.countUp($('res-score'), r.score);
    const bar = $('res-xp-bar');
    bar.style.transition = 'none';
    bar.style.transform = `scaleX(${r.xpStart})`;
    void bar.offsetWidth;
    bar.style.transition = '';
    bar.style.transform = `scaleX(${r.levelsGained.length ? 1 : r.xpEnd})`;
    if (r.levelsGained.length) setTimeout(() => {
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(0)';
      void bar.offsetWidth;
      bar.style.transition = '';
      bar.style.transform = `scaleX(${r.xpEnd})`;
    }, 900);
    this.showScreen('results');
  }

  // Rolls a number up to its final value (results screen). Uses its own short rAF chain.
  countUp(node, target) {
    const start = performance.now();
    const duration = 900;
    const tick = now => {
      const t = Math.min(1, (now - start) / duration);
      node.textContent = this.format(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- misc

  setMuted(muted) {
    document.querySelectorAll('[data-action="mute"]').forEach(btn => {
      btn.classList.toggle('muted', muted);
      btn.setAttribute('aria-pressed', String(muted));
      btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    });
  }

  setFpsVisible(visible) {
    this.fpsVisible = visible;
    this.el.fps.classList.toggle('hidden', !visible);
  }

  setFps(text) {
    if (this.fpsVisible) this.el.fps.textContent = text;
  }
}

export { escapeHtml };
