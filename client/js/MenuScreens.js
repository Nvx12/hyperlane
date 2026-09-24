import { ENVIRONMENTS } from './data/environments.js';
import { OBJECTIVES } from './data/missions.js';
import { CARS } from './balance.js';
import { escapeHtml } from './UIManager.js';
import { checkName } from './net/PlayerService.js';

const fmt = n => Math.floor(n).toLocaleString('en-US');
const km = m => `${(m / 1000).toFixed(1)} km`;
const duration = s => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
};

// Play (route select), Missions, Profile (identity, records, achievements) and Settings screens.
// Rendered on open / on change only — never per frame.
export function registerMenuScreens(menus, game) {
  const prog = () => game.progression;
  const save = () => game.save;

  // ---------------------------------------------------------------- home: daily card
  menus.onHome = () => {
    const daily = game.goals.daily();
    const d = save().daily;
    const done = daily.goals.filter(g => game.goals.dailyValue(g, null) >= g.target).length;
    document.getElementById('home-daily').innerHTML = `
      <div class="daily-head"><b>TODAY'S CHALLENGE</b><span class="muted small">${d.claimed ? 'Completed ✓' : `${done}/3 · +${fmt(daily.reward.credits)} CR`}</span></div>
      <div class="daily-goals">${daily.goals.map(g => dailyGoalHtml(g)).join('')}</div>`;
    const up = prog().nextUpgrade();
    const unlocked = save().unlockedCars.length;
    const garageSub = document.getElementById('nav-garage-sub');
    garageSub.textContent = up && up.affordable ? `Upgrade ready: ${up.label}` : `${unlocked} / ${CARS.length} cars unlocked`;
    garageSub.classList.toggle('ready', Boolean(up && up.affordable));
    const ach = Object.keys(save().achievements).length;
    document.getElementById('nav-profile-sub').textContent = game.players.registered
      ? `${game.players.name} · ${ach} achievements` : `Records · ${ach} achievements`;
    const ready = save().missions.active.filter(m => game.goals.missionValue(m, null) >= m.target).length;
    document.getElementById('nav-missions-sub').textContent = ready ? `${ready} ready to claim` : 'Daily & objectives';
  };

  function dailyGoalHtml(g) {
    const v = game.goals.dailyValue(g, null);
    const ratio = Math.min(1, v / g.target);
    const shown = OBJECTIVES[g.type].unit === 'km' ? v.toFixed(1) : Math.floor(v);
    return `<div class="daily-goal ${ratio >= 1 ? 'done' : ''}">${escapeHtml(g.text)} <span class="muted small">${shown}/${g.target}</span>
      <div class="xp-bar"><i style="transform:scaleX(${ratio})"></i></div></div>`;
  }

  // ---------------------------------------------------------------- play
  menus.register('play', () => {
    const level = save().level;
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
    const d = save().daily;
    const missions = goals.ensureMissions();
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    const hoursLeft = Math.max(0, Math.ceil((tomorrow - Date.now()) / 3600000));
    document.getElementById('missions-body').innerHTML = `
      <h3 class="section-title">Today's challenge</h3>
      <div class="daily-card">
        <div class="daily-head"><b>${d.claimed ? 'COMPLETED ✓' : `REWARD ◈ ${fmt(daily.reward.credits)} + ${daily.reward.xp} XP`}</b>
          <span class="muted small">Local challenge · resets in ${hoursLeft}h</span></div>
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
          <div class="mission-meta"><span>${obj.single ? 'In one run · ' : ''}${shown} / ${m.target}${done ? ' · claimed after your next run' : ''}</span><b>◈ ${m.credits} · ${m.xp} XP</b></div></div>`;
      }).join('')}</div>
      <p class="muted small">Completed missions pay out when a run ends and are replaced with new ones. ${save().stats.missionsCompleted} completed so far.</p>`;
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
    const join = game.players.registered ? '' : '<p class="lb-note">Create an online profile in <b style="display:inline">Profile</b> to post your runs here.</p>';
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
  // Online identity card + Records (stats) and Achievements tabs.
  let ptab = 'stats';
  let idMode = 'view'; // view | rename
  let idMessage = '';

  menus.register('profile', () => {
    renderIdentity();
    const list = game.goals.achievementList();
    document.getElementById('ach-count').textContent = `${list.filter(a => a.unlocked).length}/${list.length}`;
    document.querySelectorAll('[data-ptab]').forEach(t => t.classList.toggle('active', t.dataset.ptab === ptab));
    document.getElementById('stats-body').hidden = ptab !== 'stats';
    document.getElementById('ach-grid').hidden = ptab !== 'achievements';
    if (ptab === 'stats') renderStats();
    else renderAchievements(list);
    // Pull server-side bests in the background; re-render only the card when they arrive.
    if (game.players.registered && !game.players.busy) {
      game.players.refresh().then(r => {
        if (!r.ok && r.message && !r.offline) idMessage = r.message; // offline shows in the card label
        if (menus.current === 'profile') renderIdentity();
      });
    }
  });

  function renderIdentity() {
    const players = game.players;
    const card = document.getElementById('identity-card');
    const online = game.api.online;
    const msg = `<p class="id-msg" role="alert">${escapeHtml(idMessage)}</p>`;
    const nameForm = (label, value) => `<form data-id-form novalidate>
        <input type="text" name="name" maxlength="16" minlength="3" required autocomplete="nickname" spellcheck="false"
          placeholder="Racer name" value="${escapeHtml(value)}" aria-label="Racer name" ${online ? '' : 'disabled'}>
        <button class="btn-small ghost" type="submit" ${online ? '' : 'disabled'}>${label}</button>
        ${players.registered ? '<button class="btn-small link" type="button" data-id-act="cancel">Cancel</button>' : ''}
      </form>`;

    if (!players.registered) {
      card.innerHTML = `<div class="id-main"><span class="hud-label">Race online</span>
          <p>${online ? 'Pick a racer name to post your runs to the global leaderboards. Only this name is shared — no email, no account.'
    : 'Offline — you can create an online profile when you are connected. Your progress is always saved on this device.'}</p></div>
        ${nameForm('Create profile', '')}${msg}`;
      return;
    }
    if (idMode === 'rename') {
      card.innerHTML = `<div class="id-main"><span class="hud-label">Change racer name</span><p>Your name appears on the leaderboards.</p></div>${nameForm('Save', players.name)}${msg}`;
      card.querySelector('input').focus();
      return;
    }
    const b = players.profile && players.profile.best;
    const best = b ? `Online best ${fmt(b.score)} · ${km(b.distance)} · ${fmt(b.speed)} km/h · x${b.combo}` : 'No ranked runs yet — finish a race while online.';
    card.innerHTML = `<div class="id-main"><span class="hud-label">Online profile${online ? '' : ' · offline'}</span>
        <b class="id-name">${escapeHtml(players.name)}</b><p>${escapeHtml(best)}</p></div>
      <div class="id-actions">
        <button class="btn-small ghost" data-id-act="rename" ${online ? '' : 'disabled'}>Rename</button>
        <button class="btn-small" data-id-act="delete" ${online ? '' : 'disabled'}>Delete online profile</button>
      </div>${msg}`;
  }

  const profileBody = document.getElementById('profile-body');
  profileBody.addEventListener('submit', async e => {
    const form = e.target.closest('[data-id-form]');
    if (!form) return;
    e.preventDefault();
    const name = form.elements.name.value;
    const check = checkName(name);
    if (!check.ok) {
      idMessage = check.message;
      renderIdentity();
      return;
    }
    game.audio.ui('click');
    idMessage = '';
    form.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
    const wasRegistered = game.players.registered;
    const r = wasRegistered ? await game.players.rename(name) : await game.players.create(name);
    if (r.ok) {
      idMode = 'view';
      game.ui.toast('Online profile', `Racing as ${game.players.name}`, 'unlock');
      game.shell.emit('profile', { action: wasRegistered ? 'renamed' : 'created' });
    } else {
      idMessage = r.message;
    }
    if (menus.current === 'profile') renderIdentity();
  });
  profileBody.addEventListener('click', async e => {
    const act = e.target.closest('[data-id-act]');
    if (!act) return;
    game.audio.ui('click');
    idMessage = '';
    if (act.dataset.idAct === 'rename') idMode = 'rename';
    else if (act.dataset.idAct === 'cancel') idMode = 'view';
    else if (act.dataset.idAct === 'delete') {
      if (!window.confirm('Delete your online profile? Your leaderboard entries are removed. Progress on this device is kept.')) return;
      const r = await game.players.remove();
      if (!r.ok) idMessage = r.message;
      else game.ui.toast('Online profile deleted', 'Leaderboard entries removed', 'mission');
    }
    renderIdentity();
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
        ${a.unlocked ? `<p class="small" style="color:var(--green)">Unlocked · +${a.reward} CR</p>` : secret ? '' : `<div class="xp-bar"><i style="transform:scaleX(${a.progress})"></i></div>`}</div></div>`;
    }).join('');
  }

  function renderStats() {
    const s = save().stats;
    const r = save().records;
    const fav = prog().favoriteCar();
    const tile = (label, value) => `<div class="stat-tile"><span class="hud-label">${label}</span><b>${value}</b></div>`;
    document.getElementById('stats-body').innerHTML = `
      <h3 class="section-title">Career</h3>
      <div class="stat-grid">
        ${tile('Total distance', km(s.distance))}${tile('Total races', fmt(s.races))}${tile('Play time', duration(s.playTime))}
        ${tile('Overtakes', fmt(s.overtakes))}${tile('Near misses', fmt(s.nearMisses))}${tile('Insane misses', fmt(s.insaneMisses))}
        ${tile('Perfect overtakes', fmt(s.perfectOvertakes))}${tile('Crashes', fmt(s.crashes))}${tile('Boost time', duration(s.boostTime))}
        ${tile('Police escapes', fmt(s.policeEscapes))}${tile('Missions done', fmt(s.missionsCompleted))}${tile('Credits earned', fmt(s.creditsEarned))}
        ${tile('Favorite car', fav ? escapeHtml(fav.name) : '—')}${tile('Cars unlocked', `${save().unlockedCars.length} / ${CARS.length}`)}
      </div>
      <h3 class="section-title">Personal records</h3>
      <div class="stat-grid">
        ${tile('Highest score', fmt(r.score))}${tile('Longest run', km(r.distance))}${tile('Top speed', `${fmt(r.topSpeed)} km/h`)}
        ${tile('Best combo', `x${r.combo}`)}${tile('Most near misses', fmt(r.nearMisses))}${tile('Most overtakes', fmt(r.overtakes))}
        ${tile('Longest chase', `${fmt(r.chase)} s`)}${tile('Clean streak', km(r.cleanDistance))}
      </div>`;
  }

  // ---------------------------------------------------------------- settings
  const SLIDERS = [['master', 'Master volume'], ['music', 'Music volume'], ['sfx', 'Effects volume'], ['engine', 'Engine volume']];
  const CHOICES = {
    quality: { label: 'Graphics quality', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
    shake: { label: 'Screen shake', options: [[0, 'Off'], [0.5, 'Subtle'], [1, 'Full']] },
    touch: { label: 'Touch controls', options: [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']] },
    musicEnabled: { label: 'Music', options: [[true, 'On'], [false, 'Off']] },
  };

  menus.register('settings', () => {
    const st = save().settings;
    const seg = key => {
      const c = CHOICES[key];
      return `<div class="setting"><span>${c.label}</span><div class="seg">${c.options.map(([v, label]) =>
        `<button class="${st[key] === v ? 'active' : ''}" data-setting="${key}" data-value="${String(v)}">${label}</button>`).join('')}</div></div>`;
    };
    document.getElementById('settings-body').innerHTML = `
      <h3 class="section-title">Audio</h3>
      <div class="settings-grid">
        ${SLIDERS.map(([key, label]) => `<label class="setting"><span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${st[key]}" data-slider="${key}"></label>`).join('')}
        ${seg('musicEnabled')}
      </div>
      <h3 class="section-title">Graphics &amp; controls</h3>
      <div class="settings-grid">${seg('quality')}${seg('shake')}${seg('touch')}</div>
      <p class="muted small" style="margin-top:14px">Graphics quality only changes visual detail — gameplay is identical at every setting.</p>
      <div class="danger-zone"><button class="btn-small" data-reset="1">Reset all progress</button></div>`;
  });

  const body = document.getElementById('settings-body');
  body.addEventListener('input', e => {
    const key = e.target.dataset.slider;
    if (!key) return;
    save().settings[key] = Number(e.target.value);
    game.applySettings();
    game.store.saveSoon();
  });
  body.addEventListener('click', e => {
    const btn = e.target.closest('[data-setting]');
    if (btn) {
      const key = btn.dataset.setting;
      const option = CHOICES[key].options.find(([v]) => String(v) === btn.dataset.value);
      save().settings[key] = option[0];
      game.audio.ui('click');
      game.applySettings();
      game.store.save();
      menus.renderers.settings();
      return;
    }
    if (e.target.closest('[data-reset]')) {
      if (window.confirm('Reset ALL progress, cars, credits and records? This cannot be undone.')) {
        game.store.reset();
        game.goals.ensureMissions();
        game.applySelectedCar();
        game.applySettings();
        game.ui.setMuted(save().settings.muted);
        menus.open('home');
      }
    }
  });
}
