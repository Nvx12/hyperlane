import { ENVIRONMENTS } from './data/environments.js';
import { OBJECTIVES } from './data/missions.js';
import { AVATARS, getAvatar } from './data/avatars.js';
import { CARS } from './balance.js';
import { escapeHtml } from './UIManager.js';
import { validateDisplayName } from './names.js';
import { browserOptedOut } from './net/Analytics.js';

const fmt = n => Math.floor(n).toLocaleString('en-US');
const km = m => `${(m / 1000).toFixed(1)} km`;
const duration = s => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
};
const dateText = t => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export const avatarHtml = (id, size = '') => {
  const a = getAvatar(id);
  return `<span class="avatar ${size}" style="--av:${a.color}" aria-hidden="true">${a.glyph}</span>`;
};

function avatarPicker(selected) {
  return AVATARS.map(a => `<button type="button" class="avatar-opt ${a.id === selected ? 'active' : ''}" data-avatar="${a.id}" role="radio"
    aria-checked="${a.id === selected}" aria-label="${a.id}" style="--av:${a.color}">${a.glyph}</button>`).join('');
}

// Welcome (first launch), Play (route select), Missions, Profile and Settings screens.
// Rendered on open / on change only — never per frame.
export function registerMenuScreens(menus, game) {
  const prog = () => game.progression;
  const state = () => game.progress;
  const save = () => game.save;

  // ---------------------------------------------------------------- welcome (first launch)
  let welcomeAvatar = AVATARS[0].id;
  menus.register('welcome', () => {
    document.getElementById('welcome-avatars').innerHTML = avatarPicker(welcomeAvatar);
    document.getElementById('welcome-msg').textContent = '';
    const input = document.querySelector('#welcome-form input[name="name"]');
    if (!input.value && game.players.registered) input.value = game.players.name; // an existing online name
  });
  document.getElementById('welcome-avatars').addEventListener('click', e => {
    const opt = e.target.closest('[data-avatar]');
    if (!opt) return;
    game.audio.ui('click');
    welcomeAvatar = opt.dataset.avatar;
    document.getElementById('welcome-avatars').innerHTML = avatarPicker(welcomeAvatar);
  });
  document.getElementById('welcome-form').addEventListener('submit', e => {
    e.preventDefault();
    const r = game.store.setProfile(e.target.elements.name.value, welcomeAvatar);
    if (!r.ok) {
      game.audio.ui('deny');
      document.getElementById('welcome-msg').textContent = r.message;
      return;
    }
    game.audio.ui('confirm');
    game.analytics.track('driver_created');
    menus.open('home');
    game.play(); // "Start racing" means it: the first race (with the tutorial) starts now
  });

  // ---------------------------------------------------------------- home: daily card
  menus.onHome = () => {
    const ch = game.challenge;
    const chEl = document.getElementById('home-challenge');
    chEl.hidden = !ch;
    if (ch) {
      const env = ENVIRONMENTS.find(e => e.id === ch.env);
      chEl.innerHTML = `<div class="daily-head"><b>CHALLENGE</b><span class="muted small">${ch.accepted ? 'In progress' : 'From a shared link'}</span></div>
        <p><b>${escapeHtml(ch.name)}</b> scored <b>${fmt(ch.score)}</b> on ${escapeHtml(env ? env.name : 'the highway')}. Beat it.</p>
        <div class="challenge-actions"><button class="btn-small ghost" data-challenge="accept">${ch.accepted ? 'Try again' : 'Accept'}</button>
        <button class="btn-small link" data-challenge="dismiss">Dismiss</button></div>`;
    }
    const daily = game.goals.daily();
    const d = state().daily;
    const done = daily.goals.filter(g => game.goals.dailyValue(g, null) >= g.target).length;
    document.getElementById('home-daily').innerHTML = `<b>DAILY CHALLENGE</b><span>${d.claimed ? 'Completed ✓' : `${done}/3 · +${fmt(daily.reward.credits)} ◈`}</span>`;
    const up = prog().nextUpgrade();
    const buyable = CARS.some(c => prog().status(c.id).state === 'available');
    const garageSub = document.getElementById('nav-garage-sub');
    garageSub.textContent = buyable ? 'New car available' : up && up.affordable ? 'Upgrade ready' : `${state().ownedCars.length}/${CARS.length} cars`;
    garageSub.classList.toggle('ready', Boolean(buyable || (up && up.affordable)));
    const ready = state().missions.active.filter(m => game.goals.missionValue(m, null) >= m.target).length;
    const missionsSub = document.getElementById('nav-missions-sub');
    missionsSub.textContent = ready ? `${ready} complete` : `${state().missions.active.length} active`;
    missionsSub.classList.toggle('ready', ready > 0);
    const p = save().profile;
    document.getElementById('nav-profile-sub').textContent = p ? p.name : 'Driver';
    if (save().flags.rebalanced) {
      delete save().flags.rebalanced;
      game.store.save();
      game.ui.toast('Progression rebalanced', 'Cars now unlock with level and skill, then are bought with credits', 'unlock');
    }
  };

  document.getElementById('home-challenge').addEventListener('click', e => {
    const btn = e.target.closest('[data-challenge]');
    if (!btn) return;
    game.audio.ui('click');
    if (btn.dataset.challenge === 'accept') {
      game.acceptChallenge();
    } else {
      game.challenge = null;
      menus.onHome();
    }
  });

  function dailyGoalHtml(g) {
    const v = game.goals.dailyValue(g, null);
    const ratio = Math.min(1, v / g.target);
    const shown = OBJECTIVES[g.type].unit === 'km' ? v.toFixed(1) : Math.floor(v);
    return `<div class="daily-goal ${ratio >= 1 ? 'done' : ''}">${escapeHtml(g.text)} <span class="muted small">${shown}/${g.target}</span>
      <div class="xp-bar"><i style="transform:scaleX(${ratio})"></i></div></div>`;
  }

  // ---------------------------------------------------------------- play
  menus.register('play', () => {
    const level = state().level;
    const selected = game.selectedEnv;
    document.getElementById('env-grid').innerHTML = ENVIRONMENTS.map(env => {
      const locked = level < env.level;
      return `<button class="env-card ${env.id === selected ? 'active' : ''} ${locked ? 'locked' : ''}" data-env="${env.id}" style="--env-bg:${env.card}" ${locked ? 'disabled' : ''}>
        ${locked ? `<span class="chip lock">Level ${env.level}</span>` : ''}
        <b>${escapeHtml(env.name)}</b><small>${escapeHtml(env.tagline)}</small></button>`;
    }).join('');
    const tour = document.getElementById('tour-toggle');
    tour.checked = game.tour;
    tour.disabled = level < 5;
    tour.parentElement.title = level < 5 ? 'Unlocks at level 5' : '';
  });

  document.getElementById('env-grid').addEventListener('click', e => {
    const card = e.target.closest('[data-env]');
    if (!card || card.disabled) return;
    game.audio.ui('click');
    game.selectedEnv = card.dataset.env;
    save().environment = game.selectedEnv;
    game.store.saveSoon();
    game.environment.start(game.selectedEnv, false, false);
    game.weather.start(game.environment.env, false);
    menus.renderers.play();
  });
  document.getElementById('tour-toggle').addEventListener('change', e => {
    game.tour = e.target.checked;
  });

  // ---------------------------------------------------------------- missions
  menus.register('missions', () => {
    const goals = game.goals;
    const daily = goals.daily();
    const d = state().daily;
    const missions = goals.missions();
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    const hoursLeft = Math.max(0, Math.ceil((tomorrow - Date.now()) / 3600000));
    document.getElementById('missions-body').innerHTML = `
      <h3 class="section-title">Today's challenge</h3>
      <div class="daily-card">
        <div class="daily-head"><b>${d.claimed ? 'COMPLETED ✓' : `REWARD ◈ ${fmt(daily.reward.credits)} + ${fmt(daily.reward.xp)} XP`}</b>
          <span class="muted small">Resets in ${hoursLeft}h</span></div>
        <div class="daily-goals">${daily.goals.map(g => dailyGoalHtml(g)).join('')}</div>
      </div>
      <h3 class="section-title">Active missions</h3>
      <div class="mission-list">${missions.map(m => {
        const v = Math.min(m.target, goals.missionValue(m, null));
        const obj = OBJECTIVES[m.type];
        const shown = obj.unit === 'km' ? v.toFixed(1) : Math.floor(v);
        const done = v >= m.target;
        return `<div class="mission ${done ? 'done' : ''}"><p>${escapeHtml(obj.text(m.target))}</p>
          <div class="xp-bar"><i style="transform:scaleX(${v / m.target})"></i></div>
          <div class="mission-meta"><span>${obj.single ? 'In one run · ' : ''}${shown} / ${m.target}${done ? ' · claimed after your next run' : ''}</span><b>◈ ${fmt(m.credits)} · ${fmt(m.xp)} XP</b></div></div>`;
      }).join('')}</div>
      <p class="muted small">Completed missions pay out when a run ends and are replaced with new ones. ${fmt(state().stats.missionsCompleted)} completed so far.</p>`;
  });

  // ---------------------------------------------------------------- leaderboard
  const LB_FORMAT = {
    score: v => fmt(v),
    distance: v => km(v),
    speed: v => `${fmt(v)} km/h`,
    combo: v => `x${v}`,
  };
  const carName = id => (CARS.find(c => c.id === id) || { name: '' }).name;
  const lb = { category: 'score', period: 'week', cache: new Map(), seq: 0 };

  menus.register('leaderboard', () => renderLeaderboard());

  async function renderLeaderboard() {
    document.querySelectorAll('[data-lb-cat]').forEach(b => b.classList.toggle('active', b.dataset.lbCat === lb.category));
    document.querySelectorAll('[data-lb-period]').forEach(b => b.classList.toggle('active', b.dataset.lbPeriod === lb.period));
    const body = document.getElementById('lb-body');
    const key = `${lb.category}:${lb.period}:${game.players.registered ? game.players.name : ''}`;
    const cached = lb.cache.get(key);
    if (cached && Date.now() - cached.at < 15_000) {
      body.innerHTML = leaderboardHtml(cached.data);
      return;
    }
    if (navigator.onLine === false) {
      body.innerHTML = '<p class="lb-note"><b>Offline</b>Leaderboards need a connection. Your runs are still saved on this device.</p>';
      return;
    }
    body.innerHTML = '<p class="lb-note">Loading…</p>';
    const seq = ++lb.seq;
    const r = await game.api.request('GET', `/leaderboard?category=${lb.category}&period=${lb.period}`, { token: game.players.token });
    if (seq !== lb.seq || menus.current !== 'leaderboard') return; // superseded by another tab/period
    if (!r.ok) {
      if (r.status === 401) game.players.forget();
      body.innerHTML = r.offline
        ? '<p class="lb-note"><b>Local only</b>The leaderboard server can\'t be reached right now. Try again in a moment.</p>'
        : `<p class="lb-note"><b>Unavailable</b>${escapeHtml(r.error.message)}</p>`;
      return;
    }
    lb.cache.set(key, { at: Date.now(), data: r.data });
    body.innerHTML = leaderboardHtml(r.data);
  }

  function leaderboardHtml(data) {
    const f = LB_FORMAT[data.category];
    const row = (rank, name, value, car, me) => `<li class="lb-row ${me ? 'me' : ''}"><span class="lb-rank">#${rank}</span>
      <span class="lb-name">${escapeHtml(name)}${car ? `<small>${escapeHtml(carName(car))}</small>` : ''}</span><span class="lb-value">${f(value)}</span></li>`;
    const join = game.players.registered ? '' : '<p class="lb-note">Go online from your <b style="display:inline">Profile</b> to post your runs here.</p>';
    if (!data.entries.length) {
      return `<p class="lb-note"><b>No runs yet</b>${data.period === 'day' ? 'Nobody has set a time today — be the first.' : 'Be the first on the board.'}</p>${join}`;
    }
    const list = `<ol class="lb-list">${data.entries.map(e => row(e.rank, e.name, e.value, e.car, e.me)).join('')}</ol>`;
    const inTop = data.entries.some(e => e.me);
    const mine = data.me && !inTop ? `<ol class="lb-list lb-me">${row(data.me.rank, game.players.name, data.me.value, '', true)}</ol>` : '';
    return list + mine + join;
  }

  document.getElementById('screen-leaderboard').addEventListener('click', e => {
    const cat = e.target.closest('[data-lb-cat]');
    const period = e.target.closest('[data-lb-period]');
    if (!cat && !period) return;
    game.audio.ui('click');
    if (cat) lb.category = cat.dataset.lbCat;
    if (period) lb.period = period.dataset.lbPeriod;
    renderLeaderboard();
  });

  // ---------------------------------------------------------------- profile
  // Driver card (local identity), online account card, then Records / Awards tabs.
  let ptab = 'stats';
  let editing = false;
  let editAvatar = null;
  let driverMessage = '';
  const account = game.accountUi ? game.accountUi : null;

  menus.register('profile', () => {
    renderDriver();
    if (account) account.render();
    const list = game.goals.achievementList();
    document.getElementById('ach-count').textContent = `${list.filter(a => a.unlocked).length}/${list.length}`;
    document.querySelectorAll('[data-ptab]').forEach(t => t.classList.toggle('active', t.dataset.ptab === ptab));
    document.getElementById('stats-body').hidden = ptab !== 'stats';
    document.getElementById('ach-grid').hidden = ptab !== 'achievements';
    if (ptab === 'stats') renderStats(list);
    else renderAchievements(list);
  });

  function renderDriver() {
    const card = document.getElementById('driver-card');
    const p = save().profile;
    if (!p) {
      card.innerHTML = '';
      return;
    }
    const lv = prog().levelProgress();
    if (editing) {
      card.innerHTML = `<form class="driver-edit" data-driver-form novalidate>
          <span class="hud-label">Edit driver</span>
          <input type="text" name="name" maxlength="32" value="${escapeHtml(p.name)}" aria-label="Driver name" spellcheck="false" autocomplete="nickname">
          <div class="avatar-pick">${avatarPicker(editAvatar || p.avatar)}</div>
          <div class="id-actions"><button class="btn-small ghost" type="submit">Save</button><button class="btn-small link" type="button" data-driver-act="cancel">Cancel</button></div>
          <p class="id-msg" role="alert">${escapeHtml(driverMessage)}</p>
        </form>`;
      return;
    }
    card.innerHTML = `${avatarHtml(p.avatar, 'big')}
      <div class="driver-main">
        <b class="id-name">${escapeHtml(p.name)}</b>
        <span class="driver-level">Level ${lv.level} · ${lv.title}</span>
        <div class="xp-bar"><i style="transform:scaleX(${lv.need ? lv.xp / lv.need : 1})"></i></div>
        <small class="muted">${lv.max ? 'Max level' : `${fmt(lv.xp)} / ${fmt(lv.need)} XP`} · Driver since ${dateText(p.createdAt)}</small>
      </div>
      <button class="btn-small ghost" data-driver-act="edit">Edit</button>`;
  }

  const profileBody = document.getElementById('profile-body');
  profileBody.addEventListener('submit', async e => {
    const form = e.target.closest('[data-driver-form]');
    if (!form) return;
    e.preventDefault();
    const p = save().profile;
    const name = form.elements.name.value;
    const check = validateDisplayName(name);
    if (!check.ok) {
      driverMessage = check.message;
      renderDriver();
      return;
    }
    // Online accounts rename on the server first (it enforces the same rules and rate limits).
    if (account && game.players.registered && check.name !== game.players.name) {
      const r = await game.players.rename(check.name);
      if (!r.ok) {
        driverMessage = r.message;
        renderDriver();
        return;
      }
    }
    game.store.setProfile(check.name, editAvatar || p.avatar);
    game.audio.ui('confirm');
    editing = false;
    driverMessage = '';
    menus.renderers.profile();
  });
  profileBody.addEventListener('click', e => {
    const act = e.target.closest('[data-driver-act]');
    const av = e.target.closest('.driver-edit [data-avatar]');
    if (av) {
      editAvatar = av.dataset.avatar;
      renderDriver();
      return;
    }
    if (!act) return;
    game.audio.ui('click');
    editing = act.dataset.driverAct === 'edit';
    editAvatar = null;
    driverMessage = '';
    renderDriver();
  });
  document.querySelector('.profile-tabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-ptab]');
    if (!tab) return;
    game.audio.ui('click');
    ptab = tab.dataset.ptab;
    menus.renderers.profile();
  });

  function renderAchievements(list) {
    document.getElementById('ach-grid').innerHTML = list.map(a => {
      const secret = a.hidden && !a.unlocked;
      return `<div class="ach ${a.unlocked ? 'unlocked' : 'locked'}"><span class="ach-icon">${a.unlocked ? a.icon : secret ? '?' : a.icon}</span>
        <div><b>${secret ? '???' : escapeHtml(a.name)}</b><p>${secret ? 'Hidden achievement' : escapeHtml(a.desc)}</p>
        ${a.unlocked ? `<p class="small" style="color:var(--green)">Unlocked · +${fmt(a.reward)} CR</p>` : secret ? '' : `<div class="xp-bar"><i style="transform:scaleX(${a.progress})"></i></div>`}</div></div>`;
    }).join('');
  }

  // Real statistics only (endless runs have no wins, so there is no win count).
  function renderStats(achievements) {
    const s = state().stats;
    const r = state().records;
    const fav = prog().favoriteCar();
    const tile = (label, value) => `<div class="stat-tile"><span class="hud-label">${label}</span><b>${value}</b></div>`;
    document.getElementById('stats-body').innerHTML = `
      <h3 class="section-title">Best</h3>
      <div class="stat-grid">
        ${tile('Best score', fmt(r.score))}${tile('Top speed', `${fmt(r.topSpeed)} km/h`)}${tile('Best combo', `x${r.combo}`)}
        ${tile('Longest run', km(r.distance))}${tile('Clean streak', km(r.cleanDistance))}${tile('Longest chase', `${fmt(r.chase)} s`)}
      </div>
      <h3 class="section-title">Career</h3>
      <div class="stat-grid">
        ${tile('Total distance', km(s.distance))}${tile('Total races', fmt(s.races))}${tile('Play time', duration(s.playTime))}
        ${tile('Cars owned', `${state().ownedCars.length} / ${CARS.length}`)}${tile('Achievements', `${achievements.filter(a => a.unlocked).length} / ${achievements.length}`)}${tile('Missions done', fmt(s.missionsCompleted))}
        ${tile('Near misses', fmt(s.nearMisses))}${tile('Perfect overtakes', fmt(s.perfectOvertakes))}${tile('Police escapes', fmt(s.policeEscapes))}
        ${tile('Credits earned', fmt(s.creditsEarned))}${tile('Crashes', fmt(s.crashes))}${tile('Favorite car', fav ? escapeHtml(fav.name) : '—')}
      </div>`;
  }

  // ---------------------------------------------------------------- settings
  // Concise and thumb-sized: controls, display, sound, then the rarely-touched extras.
  const CHOICES = {
    steering: { label: 'Steering', options: [['touch', 'Touch'], ['tilt', 'Tilt']] },
    haptics: { label: 'Haptics', options: [[true, 'On'], [false, 'Off']] },
    quality: { label: 'Graphics', options: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']] },
    fps: { label: 'Frame rate', options: [['auto', 'Auto'], ['30', '30'], ['60', '60']] },
    shake: { label: 'Screen shake', options: [[0, 'Off'], [0.35, 'Low'], [0.7, 'Normal']] },
    muted: { label: 'Audio', options: [[false, 'On'], [true, 'Off']] },
    musicEnabled: { label: 'Music', options: [[true, 'On'], [false, 'Off']] },
    ghost: { label: 'Best-run ghost', options: [[true, 'On'], [false, 'Off']] },
    analytics: { label: 'Usage stats', options: [[true, 'On'], [false, 'Off']] },
  };
  let settingsNote = '';
  let tiltTimer = 0;

  menus.register('settings', () => {
    const st = save().settings;
    const seg = (key, note = '') => {
      const c = CHOICES[key];
      return `<div class="setting"><span>${c.label}${note ? `<small>${note}</small>` : ''}</span><div class="seg">${c.options.map(([v, label]) =>
        `<button class="${st[key] === v ? 'active' : ''}" data-setting="${key}" data-value="${String(v)}">${label}</button>`).join('')}</div></div>`;
    };
    const perf = game.perf;
    const autoNote = st.quality === 'auto' ? `Auto picked ${perf.levelName}${perf.extra ? ' (reduced)' : ''}` : '';
    const tilt = st.steering === 'tilt';
    const haptics = game.haptics.supported ? seg('haptics')
      : '<div class="setting disabled"><span>Haptics<small>Not supported on this device</small></span></div>';
    const stats = browserOptedOut()
      ? '<div class="setting disabled"><span>Usage stats<small>Off — your browser asks not to be tracked</small></span></div>'
      : seg('analytics', 'Anonymous counts, never your name');
    // Progress of an online account lives on the server; only guests can wipe it locally.
    const reset = game.players.registered ? '' : '<button class="btn-small" data-reset="progress">Reset progress</button>';
    const devReset = game.debug ? '<button class="btn-small" data-reset="dev">Dev: reset everything</button>' : '';
    document.getElementById('settings-body').innerHTML = `
      ${settingsNote ? `<p class="lb-note" role="status">${escapeHtml(settingsNote)}</p>` : ''}
      <h3 class="section-title">Controls</h3>
      <div class="settings-list">
        ${seg('steering', tilt ? 'Hold the phone like a wheel' : 'Hold the left or right pad')}
        <label class="setting"><span>Sensitivity<small>${st.sensitivity < 0.95 ? 'Calm' : st.sensitivity > 1.05 ? 'Sharp' : 'Normal'}</small></span>
          <input type="range" min="0.6" max="1.4" step="0.1" value="${st.sensitivity}" data-slider="sensitivity" aria-label="Steering sensitivity"></label>
        ${tilt ? `<div class="setting"><span>Tilt center<small>Races re-center at GO</small></span>
          <span class="tilt-meter" aria-hidden="true"><i id="tilt-dot"></i></span><button class="btn-small ghost" data-tilt-center>Center</button></div>` : ''}
        ${haptics}
      </div>
      <h3 class="section-title" style="margin-top:18px">Display</h3>
      <div class="settings-list">${seg('quality', autoNote)}${seg('fps', 'Auto = 60, or 30 if the phone struggles')}${seg('shake')}</div>
      <h3 class="section-title" style="margin-top:18px">Sound</h3>
      <div class="settings-list">${seg('muted')}${seg('musicEnabled')}</div>
      <h3 class="section-title" style="margin-top:18px">More</h3>
      <div class="settings-list">${seg('ghost')}${stats}</div>
      <div class="danger-zone">
        <button class="btn-small ghost" data-replay-tutorial>Replay tutorial</button>
        ${reset}${devReset}
      </div>`;
    settingsNote = '';
    clearInterval(tiltTimer);
    if (tilt && game.input.tilt.active) {
      // Live tilt readout while this screen is open (a light timer, not the render loop).
      tiltTimer = setInterval(() => {
        const dot = document.getElementById('tilt-dot');
        if (!dot || menus.current !== 'settings') {
          clearInterval(tiltTimer);
          return;
        }
        game.input.tilt.update(0.05);
        dot.style.transform = `translateX(${Math.round(game.input.tilt.steer * 64)}px)`;
      }, 50);
    }
  });

  const body = document.getElementById('settings-body');
  body.addEventListener('input', e => {
    const key = e.target.dataset.slider;
    if (!key) return;
    save().settings[key] = Number(e.target.value);
    game.applySettings();
    game.store.saveSoon();
  });
  body.addEventListener('change', e => {
    if (e.target.dataset.slider) menus.renderers.settings();
  });
  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-setting]');
    if (btn) {
      const key = btn.dataset.setting;
      const option = CHOICES[key].options.find(([v]) => String(v) === btn.dataset.value);
      game.audio.ui('click');
      game.haptics.pulse('tap');
      if (key === 'steering' && option[0] === 'tilt' && !game.input.tilt.active) {
        // This tap is the user gesture iOS needs for the motion-sensor permission prompt.
        const result = await game.input.enableTilt();
        if (result !== 'ok') {
          settingsNote = result === 'denied' ? 'Motion access was denied. Touch steering stays on.'
            : 'This device has no motion sensor. Touch steering stays on.';
          menus.renderers.settings();
          return;
        }
        game.input.tilt.calibrate();
      }
      save().settings[key] = option[0];
      if (key === 'analytics') game.analytics.optOutChanged();
      else game.analytics.track('settings_changed', { key, value: String(option[0]) });
      game.applySettings();
      game.store.save();
      menus.renderers.settings();
      return;
    }
    if (e.target.closest('[data-tilt-center]')) {
      save().settings.tiltCenter = game.input.tilt.calibrate();
      game.store.save();
      game.haptics.pulse('tap');
      return;
    }
    if (e.target.closest('[data-replay-tutorial]')) {
      delete save().flags.tutorial;
      game.store.save();
      settingsNote = 'The tutorial will run at the start of your next race.';
      menus.renderers.settings();
      return;
    }
    const reset = e.target.closest('[data-reset]');
    if (reset) {
      const dev = reset.dataset.reset === 'dev';
      const question = dev
        ? 'DEVELOPMENT RESET: delete the driver profile, progression, garage, missions, statistics and the online link on this device?'
        : 'Reset ALL progress, cars, credits and records? Your driver name is kept. This cannot be undone.';
      if (!window.confirm(question)) return;
      game.resetLocal(dev);
    }
  });
}
