import { EVENTS } from './balance.js';

// Development-only event panel (created only with ?debug in non-production builds — see
// Game.debug). Lets a developer trigger any heat level, police behaviour, event or formation
// instantly and watch the director's state, instead of playing for minutes hoping it happens.
export class DevPanel {
  constructor(game) {
    this.game = game;
    const root = document.createElement('div');
    root.className = 'dev-panel';
    root.innerHTML = `<button class="dev-toggle" data-dev="toggle">DEV</button>
      <div class="dev-body" hidden>
        <div class="dev-row"><b>Heat</b>${[0, 1, 2, 3, 4, 5].map(n => `<button data-dev="heat" data-v="${n}">${n}</button>`).join('')}</div>
        <div class="dev-row"><b>Police</b><button data-dev="spawnPolice">Spawn unit</button><button data-dev="chase">Start chase</button>
          <button data-dev="stopChase">Stop chase</button><button data-dev="roadblock">Roadblock</button><button data-dev="patrol">Patrol</button><button data-dev="escape">Escape</button></div>
        <div class="dev-row"><b>Audio</b><button data-dev="testChaseMusic">Test chase music</button><button data-dev="testEscape">Test escape transition</button><button data-dev="musicNormal">Music → normal</button></div>
        <div class="dev-row"><b>Events</b>${Object.keys(EVENTS).map(k => `<button data-dev="event" data-v="${k}">${k}</button>`).join('')}</div>
        <div class="dev-row"><b>Traffic</b>${['gate', 'stagger', 'truckWall', 'pack', 'movingGap'].map(k => `<button data-dev="formation" data-v="${k}">${k}</button>`).join('')}</div>
        <div class="dev-row"><b>Player</b><button data-dev="combo">Combo x10</button><button data-dev="boost">Boost 100</button><button data-dev="repair">Repair</button><button data-dev="god">God mode</button></div>
        <pre class="dev-state" id="dev-state"></pre>
      </div>`;
    document.getElementById('app').appendChild(root);
    this.root = root;
    this.body = root.querySelector('.dev-body');
    this.state = root.querySelector('#dev-state');
    root.addEventListener('click', e => this.onClick(e));
    this.timer = setInterval(() => this.render(), 500);
  }

  onClick(e) {
    const btn = e.target.closest('[data-dev]');
    if (!btn) return;
    e.stopPropagation();
    const g = this.game;
    const v = btn.dataset.v;
    const racing = g.state === 'playing';
    switch (btn.dataset.dev) {
      case 'toggle':
        this.body.hidden = !this.body.hidden;
        break;
      case 'heat':
        g.police.debugSetHeat(Number(v));
        break;
      case 'spawnPolice':
        if (racing) g.police.dispatch();
        break;
      case 'chase':
        if (racing) {
          if (g.police.heat < 200) g.police.debugSetHeat(2);
          if (!g.police.active) g.police.startChase();
        }
        break;
      case 'stopChase':
        g.police.debugCancelChase();
        break;
      case 'testChaseMusic':
        // Audio only: no police involved (the real trigger is a unit on screen during a chase).
        g.audio.unlock();
        g.audio.setMusicState('chase');
        break;
      case 'testEscape':
        if (g.police.chase) g.police.chase.escape = 0.999; // the real escape path
        else if (g.audio.musicState === 'chase') {
          g.audio.escape();
          g.audio.setMusicState('normal', { after: 'escape' });
        }
        break;
      case 'musicNormal':
        g.audio.setMusicState(racing ? 'normal' : 'menu');
        break;
      case 'roadblock':
        if (racing) g.police.spawnRoadblock();
        break;
      case 'patrol':
        if (racing) g.police.spawnPatrol();
        break;
      case 'escape':
        if (g.police.chase) g.police.chase.escape = 0.99;
        break;
      case 'event':
        if (racing) {
          if (g.events.busy) g.events.endEvent('interrupted');
          g.director.startEvent(v);
        }
        break;
      case 'formation':
        if (racing) g.traffic.spawnFormation(v, g.difficulty);
        break;
      case 'combo':
        g.score.addCombo(80);
        break;
      case 'boost':
        g.player.boost = 100;
        break;
      case 'repair':
        g.player.health = 100;
        break;
      case 'god':
        g.player.invulnerable = g.player.invulnerable > 1000 ? 0 : 1e9;
        break;
      default:
        break;
    }
    this.render();
  }

  render() {
    if (this.body.hidden) return;
    const g = this.game;
    const d = g.director;
    const p = g.police;
    const c = p.chase;
    const tail = g.telemetry.slice(-8).map(e => `${e.t.toFixed(0).padStart(4)}s ${e.what}`).join('\n');
    this.state.textContent = `run ${Math.round(g.runTime)}s · ${d.personalityKey} · seed ${d.seed}
phase ${d.phase} (cycle ${d.cycle}) · intensity ${Math.round(d.intensity)} → ${Math.round(d.target)} · pressure ${g.traffic.pressure.toFixed(2)}
heat ${Math.round(p.heat)} (★${p.level}) · units ${p.units.length}${c ? ` · chase ${c.time.toFixed(0)}s escape ${(c.escape * 100).toFixed(0)}% bust ${(c.bust * 100).toFixed(0)}%` : ''}
event ${g.events.current ? g.events.current.key : '—'} · flow ${g.flow} · combo x${g.score.multiplier}
audio ${Object.entries(g.audio.debugInfo()).map(([k, v]) => `${k}:${v}`).join(' ')}
${tail}`;
  }
}
