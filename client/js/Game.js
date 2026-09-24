import { CAMERA, PLAYER, ROAD, GAME, BEAM, PERF, PALETTE, laneCenter } from './config.js';
import { DIFFICULTY, DAMAGE, PICKUPS, SCORE } from './balance.js';
import { clamp, lerp, rand, randInt, sign } from './utils.js';
import { Camera } from './Camera.js';
import { Road } from './Road.js';
import { Environment, getEnvironment } from './Environment.js';
import { Weather } from './Weather.js';
import { Player } from './Player.js';
import { TrafficManager } from './TrafficManager.js';
import { PickupManager, PICKUP_REPAIR, PICKUP_CREDITS } from './PickupManager.js';
import { Effects } from './Effects.js';
import { PARTICLE } from './ParticleSystem.js';
import { SkillSystem } from './SkillSystem.js';
import { ScoreSystem } from './ScoreSystem.js';
import { EventDirector } from './EventDirector.js';
import { Goals, objectiveText } from './Goals.js';
import { AudioManager } from './AudioManager.js';
import { InputManager } from './InputManager.js';
import { UIManager } from './UIManager.js';
import { Menus } from './Menus.js';
import { registerMenuScreens } from './MenuScreens.js';
import { SaveManager } from './SaveManager.js';
import { Progression } from './Progression.js';
import { resolveCustom } from './data/cosmetics.js';
import { tipFor, SHOW_CONTROLS_RACES } from './data/tips.js';
import { ENV } from './env.js';
import { AppShell } from './AppShell.js';
import { ApiClient } from './net/ApiClient.js';
import { PlayerService } from './net/PlayerService.js';
import { RaceService } from './net/RaceService.js';
import { Ghost } from './Ghost.js';
import { Analytics } from './net/Analytics.js';
import { takeChallengeFromUrl, shareRun } from './Share.js';
import { createSpriteBank, createPlayerSprites, createUnderglowSprite, createBeamSprite } from './Sprites.js';

export const STATE = Object.freeze({
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  PAUSED: 'paused',
  CRASHING: 'crashing',
  GAMEOVER: 'gameover',
});

// Graphics presets: cosmetic detail (particles, rain, backdrops) and resolution cap.
// Gameplay is identical at every level.
const QUALITY = {
  low: { detail: 0.35, maxDpr: 1 },
  medium: { detail: 0.65, maxDpr: 1.25 },
  high: { detail: 1, maxDpr: PERF.MAX_DPR },
};
const AUTO_DETAIL_STEPS = [1, 0.6, 0.35];
const GOAL_CHECK_INTERVAL = 0.5;
const INTRO_LINGER = 2.5; // seconds the race intro stays up after GO
const MIN_SETTLE_DISTANCE = 150; // abandoned runs shorter than this don't count

const sortBackToFront = (a, b) => b.sortZ - a.sortZ;

// Piecewise-linear difficulty over racing time (see DIFFICULTY.TIMELINE).
function difficultyAt(seconds) {
  const tl = DIFFICULTY.TIMELINE;
  for (let i = 1; i < tl.length; i++) {
    if (seconds <= tl[i][0]) {
      const [t0, d0] = tl[i - 1];
      const [t1, d1] = tl[i];
      return d0 + ((d1 - d0) * (seconds - t0)) / (t1 - t0);
    }
  }
  return tl[tl.length - 1][1];
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.store = new SaveManager();
    this.progression = new Progression(this.store);
    this.goals = new Goals(this.store, this.progression);

    this.bank = createSpriteBank();
    this.camera = new Camera();
    this.environment = new Environment();
    this.road = new Road(this.bank, this.environment);
    this.player = new Player();
    this.traffic = new TrafficManager(this.bank);
    this.pickups = new PickupManager(this.bank);
    this.pickups.creditChance = PICKUPS.CREDIT_CHIP_CHANCE;
    this.effects = new Effects(this.bank);
    this.score = new ScoreSystem();
    this.skills = new SkillSystem(this);
    this.audio = new AudioManager(this.save.settings);
    this.weather = new Weather(this.audio);
    this.events = new EventDirector(this);
    this.input = new InputManager();
    this.ui = new UIManager({
      start: () => this.startRace(),
      resume: () => this.resume(),
      restart: () => this.restartRace(),
      menu: () => this.quitToMenu(),
      garage: () => this.enterMenu('garage'),
      pause: () => this.togglePause(),
      mute: () => this.toggleMute(),
      fullscreen: () => this.shell.toggleFullscreen(),
      install: () => this.shell.install(),
      update: () => this.shell.applyUpdate(),
      share: () => this.shareLastRun(),
      uiSound: kind => this.audio.ui(kind),
    });
    this.shell = new AppShell(this);
    // Optional backend. Only ever used from menus and at run end — never in the frame loop.
    this.api = new ApiClient();
    this.players = new PlayerService(this.api);
    this.race = new RaceService(this.api, this.players);
    this.ghost = new Ghost();
    this.analytics = new Analytics(this.api, () => this.save.settings);
    // App-shell events → analytics (coarse, no identifiers).
    this.shell.on((type, data) => {
      if (type === 'installed') this.analytics.track('pwa_installed');
      else if (type === 'gamepad') this.analytics.track('gamepad', { connected: data.connected });
      else if (type === 'profile' && data.action === 'created') this.analytics.track('profile_created');
      else if (type === 'share') this.analytics.track('share', { result: data.result });
    });
    this.challenge = takeChallengeFromUrl(); // { name, score, distance, env, accepted } | null
    this.lastRun = null;
    this.api.onStatus(() => this.shell.syncNetwork());
    this.menus = new Menus(this);
    registerMenuScreens(this.menus, this);

    this.input.bindTouchControls(document.getElementById('touch-controls'));
    this.input.onPause = () => {
      if (this.state === STATE.MENU) this.menus.back();
      else if (this.state === STATE.GAMEOVER) this.enterMenu();
      else this.togglePause();
    };
    this.input.onConfirm = () => this.confirm();
    this.input.onMute = () => this.toggleMute();
    this.input.onGarage = () => {
      if (this.state === STATE.MENU && this.menus.current === 'home') this.menus.open('garage');
    };
    // Developer performance monitor: only with ?debug in the URL, toggled with F.
    // Never available in production builds.
    this.debug = !ENV.isProduction && new URLSearchParams(location.search).has('debug');
    this.input.onToggleFps = () => {
      if (this.debug) this.ui.setFpsVisible(!this.ui.fpsVisible);
    };
    this.input.onFirstInteraction = () => {
      this.audio.unlock();
      if (this.input.touchMode) this.ui.noteTouch();
    };
    this.input.isRacing = () => this.isRaceActive();
    this.input.onMethodChange = () => this.ui.updateTouchVisibility();
    this.input.onPadConnect = () => {
      this.ui.toast('Controller connected', 'RT accelerate · LT brake · A boost', 'unlock');
      this.shell.emit('gamepad', { connected: true });
    };
    this.input.onPadDisconnect = () => {
      // Never let the car drive on unattended.
      const racing = this.state === STATE.PLAYING || this.state === STATE.COUNTDOWN;
      if (racing) this.pause();
      this.ui.toast('Controller disconnected', racing ? 'Game paused' : 'Keyboard and touch still work', 'mission');
      this.shell.emit('gamepad', { connected: false });
    };
    this.traffic.onPass = car => this.skills.onPass(car);
    this.handlePickup = this.handlePickup.bind(this);

    this.state = STATE.MENU;
    this.pausedFrom = STATE.PLAYING;
    this.controls = { steer: 0, throttle: false, brake: false, boost: false };
    this.playerScreen = { x: 0, y: 0, scale: 1, w: 0, h: 0 };
    this.entities = [];
    this.hudData = {
      score: 0, best: 0, speed: 0, distance: 0, mult: 1, tier: 0, tierProgress: 0, comboTime: 0,
      health: 100, boost: 0, boosting: false, boostReady: true, lowHealth: false, slipstream: false,
    };
    this.runView = {}; // reused live snapshot of the run for goal checks

    this.difficulty = 0;
    this.maxKmh = this.player.profile.topKmh;
    this.timeScale = 1;
    this.time = 0;
    this.renderScale = 1;
    this.qualityCap = PERF.MAX_DPR;
    this.autoDetailStep = 0;
    this.frameAvg = 16.7;
    this.slowTime = 0;
    this.fastTime = 0;
    this.fpsTimer = 0;
    this.fpsFrames = 0;
    this.lastTime = 0;
    this.resizePending = true;
    this.needsRender = true;
    this.selectedEnv = this.save.environment;
    this.tour = false;
    this.resetRunState();

    this.frame = this.frame.bind(this);
    window.addEventListener('resize', () => { this.resizePending = true; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else this.lastTime = performance.now();
    });
  }

  resetRunState() {
    this.crashTimer = 0;
    this.countdown = 0;
    this.countdownStep = 0;
    this.scrapeTimer = 0;
    this.hudTimer = 0;
    this.goalTimer = 0;
    this.autoTimer = 0;
    this.autoLane = 1;
    this.gameOverAt = 0;
    this.runTime = 0;
    this.runSettled = false;
    this.introTimer = 0;
    this.dustAcc = 0;
    this.rainLevel = -1;
  }

  get save() {
    return this.store.data;
  }

  isPlaying() {
    return this.state === STATE.PLAYING;
  }

  bestScore() {
    return this.save.records.score;
  }

  // Applies the garage car: handling profile, sprites and cosmetics. Called at startup and
  // whenever the selection, upgrades or customization change (never during a race frame).
  applySelectedCar() {
    const car = this.progression.selectedCar();
    const look = resolveCustom(car, this.progression.carState(car.id).custom);
    this.car = car;
    this.player.setProfile(this.progression.getCarProfile(car.id));
    this.bank.player = createPlayerSprites(car, {
      paint: look.paint,
      rim: look.rim,
      accent: look.underglowRgb ? `rgb(${look.underglowRgb})` : null,
    });
    this.bank.underglow = look.underglowRgb ? createUnderglowSprite(look.underglowRgb) : null;
    this.bank.beam = createBeamSprite(look.headlightRgb);
    this.effects.trail = look.trail ? PARTICLE[look.trail] : null;
    this.maxKmh = this.player.topKmh(0);
    this.updatePlayerScreen();
  }

  // Applies persisted settings to every subsystem. Cheap; called when any setting changes.
  applySettings() {
    const st = this.save.settings;
    const q = QUALITY[st.quality] || QUALITY.high;
    const detail = Math.min(q.detail, AUTO_DETAIL_STEPS[this.autoDetailStep]);
    this.effects.setDetail(detail);
    this.weather.detail = detail;
    this.environment.setDetail(detail >= 0.6 ? 1 : 0.5);
    this.camera.shakeScale = st.shake;
    this.audio.applySettings(st);
    this.ui.setTouchMode(st.touch);
    // Phones: small screens with DPR 3 are fill-rate bound; 1.25x is visually indistinguishable.
    const cap = this.ui.isTouchDevice() ? Math.min(q.maxDpr, PERF.MOBILE_MAX_DPR) : q.maxDpr;
    if (cap !== this.qualityCap) {
      this.qualityCap = cap;
      this.resizePending = true;
    }
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    this.analytics.track('session_start', {
      pwa: this.shell.pwa.isStandalone,
      touch: this.ui.isTouchDevice(),
      returning: this.save.stats.races > 0,
    });
    if (this.challenge) this.analytics.track('challenge_opened');
    this.goals.ensureMissions();
    this.applySelectedCar();
    this.applySettings();
    this.applyResize();
    this.ui.setMuted(this.save.settings.muted);
    this.enterMenu();
    this.shell.start();
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
    // Billboards use the display font; redraw them once it has loaded.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.environment.rebuildProps());
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const raw = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Clamp spikes (tab switches, GC pauses) so the simulation never teleports.
    const dt = raw > PERF.MAX_DT ? PERF.MAX_DT : raw < 0 ? 0 : raw;
    if (this.resizePending) this.applyResize();
    this.monitorPerformance(raw);
    this.input.poll(dt);

    if (this.state === STATE.PAUSED) {
      if (this.needsRender) {
        this.render();
        this.needsRender = false;
      }
      return;
    }
    this.update(dt);
    this.render();
    if (this.state === STATE.MENU) this.menus.renderPreview(dt);
  }

  applyResize() {
    this.resizePending = false;
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(240, window.innerHeight);
    // High-DPI screens are held to the pixel budget, but never below native (1x) resolution;
    // sustained slowness beyond that is handled by monitorPerformance().
    const budget = Math.max(1, Math.sqrt(PERF.MAX_PIXELS / (w * h)));
    this.renderScale = Math.min(window.devicePixelRatio || 1, this.qualityCap, budget);
    this.canvas.width = Math.round(w * this.renderScale);
    this.canvas.height = Math.round(h * this.renderScale);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.resize(w, h);
    this.environment.resize(w, h, this.camera.horizonY);
    this.road.resize(this.ctx, this.camera);
    this.effects.resize(w, h);
    this.road.prepare(this.camera);
    this.updatePlayerScreen();
    this.ui.updateTouchVisibility();
    this.shell.checkOrientation();
    this.needsRender = true;
  }

  // Cosmetic auto-scaling: sustained frame drops first reduce effects detail, then render
  // resolution. Gameplay (traffic, physics, difficulty) is never touched.
  monitorPerformance(raw) {
    if (raw <= 0 || raw > 0.25) return;
    this.frameAvg += (raw * 1000 - this.frameAvg) * 0.05;
    if (this.state === STATE.PLAYING && this.frameAvg > PERF.SLOW_FRAME_MS) {
      this.slowTime += raw;
      if (this.slowTime > PERF.SLOW_FRAME_GRACE) {
        this.slowTime = 0;
        this.frameAvg = 16.7;
        if (this.autoDetailStep < AUTO_DETAIL_STEPS.length - 1) {
          this.autoDetailStep++;
          this.applySettings();
        } else if (this.renderScale > PERF.MIN_RENDER_SCALE) {
          this.qualityCap = Math.max(PERF.MIN_RENDER_SCALE, this.renderScale - 0.25);
          this.resizePending = true;
        }
      }
    } else {
      this.slowTime = 0;
    }
    // Recover detail after a long stretch of comfortable frame times.
    if (this.autoDetailStep > 0 && this.frameAvg < PERF.SLOW_FRAME_MS * 0.6) {
      this.fastTime += raw;
      if (this.fastTime > PERF.RECOVER_GRACE) {
        this.fastTime = 0;
        this.autoDetailStep--;
        this.applySettings();
      }
    } else {
      this.fastTime = 0;
    }
    this.fpsFrames++;
    this.fpsTimer += raw;
    if (this.fpsTimer >= 0.5) {
      if (this.ui.fpsVisible) {
        this.ui.setFps(`${Math.round(this.fpsFrames / this.fpsTimer)} FPS · ${this.frameAvg.toFixed(1)} ms · ${this.traffic.vehicles.length} vehicles · ${this.effects.particles.count} particles · x${this.renderScale.toFixed(2)} · detail ${AUTO_DETAIL_STEPS[this.autoDetailStep]}`);
      }
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }
  }

  // ---------------------------------------------------------------- state transitions

  resetWorld() {
    this.road.reset();
    this.player.reset();
    this.traffic.reset();
    this.pickups.reset();
    this.effects.reset();
    this.score.reset();
    this.skills.reset();
    this.events.reset();
    this.goals.resetRun();
    this.camera.reset();
    this.difficulty = 0;
    this.maxKmh = this.player.topKmh(0);
    this.timeScale = 1;
    this.resetRunState();
  }

  enterMenu(screen = 'home') {
    if (getEnvironment(this.selectedEnv).level > this.save.level) this.selectedEnv = 'neon';
    this.resetWorld();
    this.state = STATE.MENU;
    this.player.speed = GAME.MENU_KMH / 3.6;
    this.environment.start(this.selectedEnv, false, false);
    this.weather.start(getEnvironment(this.selectedEnv), false);
    this.audio.resume();
    this.audio.setMusicMode('menu');
    this.ui.setHudVisible(false);
    this.hideIntro();
    this.menus.open(screen);
    this.shell.refreshUpdateBanner();
    this.shell.pingServer();
    this.race.flush().then(n => {
      if (n) this.ui.toast('Leaderboard', `${n} offline run${n > 1 ? 's' : ''} submitted`, 'unlock');
    });
  }

  startRace() {
    this.audio.unlock();
    this.audio.resume();
    this.resetWorld();
    this.environment.start(this.selectedEnv, this.tour, true);
    this.weather.start(this.environment.env, true);
    this.state = STATE.COUNTDOWN;
    this.countdown = GAME.COUNTDOWN;
    this.countdownStep = GAME.COUNTDOWN + 1;
    this.input.reset();
    this.ui.showScreen(null);
    this.ui.setHudVisible(true, true);
    this.ui.setMissionTracker(this.goals.trackerItems(null));
    this.ui.peekMissions(true);
    const ch = this.challenge && this.challenge.accepted ? this.challenge : null;
    this.ui.showRaceIntro(this.save.stats.races < SHOW_CONTROLS_RACES,
      ch ? `Challenge: beat ${ch.name}'s ${ch.score.toLocaleString('en-US')}` : tipFor(this.save.stats.races));
    this.audio.setMusicMode('race');
    this.shell.refreshUpdateBanner();
    this.shell.checkOrientation();
    this.race.begin(this.car.id, this.selectedEnv); // background request; never blocks the countdown
    this.ghost.enabled = this.save.settings.ghost;
    this.ghost.startRun();
    this.analytics.track('race_start', { car: this.car.id, env: this.selectedEnv, tour: this.tour, ghost: Boolean(this.ghost.active) });
    this.lastTime = performance.now();
  }

  // Leaving a run from the pause menu still banks its progress (if it went anywhere).
  settleAbandonedRun() {
    if (this.runSettled || this.state === STATE.MENU || this.score.distance < MIN_SETTLE_DISTANCE) return null;
    return this.finishRun();
  }

  restartRace() {
    const summary = this.state === STATE.GAMEOVER ? null : this.settleAbandonedRun();
    if (summary) this.toastRunSummary(summary);
    this.startRace();
  }

  quitToMenu() {
    const summary = this.state === STATE.GAMEOVER ? null : this.settleAbandonedRun();
    this.enterMenu();
    if (summary) this.toastRunSummary(summary);
  }

  hideIntro() {
    this.introTimer = 0;
    this.ui.hideRaceIntro();
    this.ui.peekMissions(false);
  }

  noteUnlock(car, events) {
    events.push(['unlock', `NEW CAR UNLOCKED · ${car.name}`]);
    this.analytics.track('car_unlocked', { car: car.id });
  }

  // Coarse run summary for analytics: rounded numbers and ids of game content only.
  trackRunEnd(run, goalEvents, newLevel) {
    const a = this.analytics;
    a.track('race_end', {
      car: this.car.id,
      env: this.selectedEnv,
      score_k: Math.round(run.score / 1000),
      km: Math.round(run.distance / 100) / 10,
      secs: Math.round(this.runTime),
      combo: run.bestMultiplier,
      wrecked: this.player.health <= 0,
    });
    const count = kind => goalEvents.filter(([k]) => k === kind).length;
    if (count('mission')) a.track('mission_complete', { count: count('mission') });
    if (count('achievement')) a.track('achievement', { count: count('achievement') });
    if (goalEvents.some(([, text]) => text.startsWith('DAILY'))) a.track('daily_complete');
    if (newLevel) a.track('level_up', { level: newLevel });
  }

  async shareLastRun() {
    if (!this.lastRun) return;
    const { result, text, url } = await shareRun({ name: this.players.registered ? this.players.name : '', ...this.lastRun });
    let outcome = result;
    if (result === 'copied') {
      this.ui.toast('Link copied', 'Send it to a friend to challenge them', 'unlock');
    } else if (result === 'failed') {
      // Clipboard API blocked (embedded browsers, strict settings): show the link to copy by hand.
      if (this.ui.showShareFallback(`${text} ${url}`)) {
        outcome = 'copied';
        this.ui.toast('Link copied', 'Send it to a friend to challenge them', 'unlock');
      }
    }
    this.shell.emit('share', { result: outcome });
  }

  acceptChallenge() {
    const ch = this.challenge;
    if (!ch) return;
    ch.accepted = true;
    this.analytics.track('challenge_accepted');
    // Race the same route when it's unlocked; otherwise the current one (score is score).
    if (getEnvironment(ch.env).level <= this.save.level) this.selectedEnv = ch.env;
    this.startRace();
  }

  toastRunSummary(summary) {
    this.ui.toast('Run banked', `+${summary.creditsTotal} credits · +${summary.xp} XP`, 'unlock');
  }

  togglePause() {
    if (this.state === STATE.PAUSED) this.resume();
    else this.pause();
  }

  pause() {
    if (this.state !== STATE.PLAYING && this.state !== STATE.COUNTDOWN) return;
    this.pausedFrom = this.state;
    this.state = STATE.PAUSED;
    this.input.reset();
    this.audio.suspend();
    this.ui.setMissionTracker(this.goals.trackerItems(this.liveRun()));
    this.ui.showScreen('pause');
    this.needsRender = true;
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = this.pausedFrom;
    this.audio.resume();
    this.ui.showScreen(null);
    this.lastTime = performance.now();
  }

  confirm() {
    if (this.state === STATE.MENU) {
      if (this.menus.current === 'home') this.menus.open('play');
      else if (this.menus.current === 'play') this.startRace();
    } else if (this.state === STATE.PAUSED) {
      this.resume();
    } else if (this.state === STATE.GAMEOVER && performance.now() - this.gameOverAt > GAME.GAMEOVER_INPUT_DELAY * 1000) {
      this.startRace();
    }
  }

  toggleMute() {
    const muted = !this.audio.muted;
    this.save.settings.muted = muted;
    this.audio.applySettings(this.save.settings);
    this.store.save();
    this.ui.setMuted(muted);
  }

  beginCrashSequence(direction) {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.CRASHING;
    this.crashTimer = GAME.CRASH_SLOWMO;
    this.timeScale = GAME.CRASH_TIMESCALE;
    this.player.wreck(direction);
    this.traffic.spawnEnabled = false;
    this.camera.addTrauma(1);
    this.input.rumble(1, 450);
    this.camera.fovOverride = 0.12; // pull in on the wreck
    this.audio.crash(1.2);
    this.audio.siren(false);
    this.audio.setMusicMode('wreck');
    this.ui.hideBanner();
    this.hideIntro();
    this.ui.showCallout('WRECKED', 'danger');
  }

  gameOver() {
    this.state = STATE.GAMEOVER;
    this.timeScale = 1;
    this.camera.fovOverride = 0;
    this.gameOverAt = performance.now();
    this.ui.setHudVisible(false);
    const summary = this.finishRun();
    this.ui.showResults(summary);
    this.ui.setOnlineResult(this.players.registered ? 'pending' : null);
    const runId = this.gameOverAt;
    summary.online.then(res => {
      // Ignore late answers once the player has moved on to another run.
      if (this.state === STATE.GAMEOVER && this.gameOverAt === runId) this.ui.setOnlineResult(res);
    });
    this.audio.gameOver();
    this.shell.refreshUpdateBanner();
    this.audio.setMusicMode('menu');
  }

  // Live run snapshot (numbers only) used by goals and the mission tracker.
  liveRun() {
    const v = this.runView;
    const s = this.score.stats;
    for (const k in s) v[k] = s[k];
    v.score = Math.floor(this.score.score);
    v.distance = this.score.distance;
    return v;
  }

  // Settles a run: records, lifetime stats, goals, rewards, unlocks. One save write.
  finishRun() {
    this.runSettled = true;
    const prog = this.progression;
    const save = this.save;
    const run = { ...this.liveRun() };
    if (run.bestMultiplier >= 10 && run.policeEscapes > 0) save.flags.phantom = true;

    // Ranked submission (validated server-side; local rewards never depend on it).
    const online = this.race.submit({
      score: run.score,
      distance: Math.round(run.distance * 10) / 10,
      topSpeed: Math.round(run.topSpeed * 10) / 10,
      bestCombo: run.bestMultiplier,
      durationMs: Math.round(this.runTime * 1000),
      nearMisses: run.nearMisses,
      overtakes: run.overtakes,
      perfectOvertakes: run.perfectOvertakes,
    });

    const beaten = prog.updateRecords(run);
    prog.addLifetimeStats(run, this.car.id, this.runTime);
    const events = [];
    for (const car of prog.checkUnlocks()) this.noteUnlock(car, events);
    this.lastRun = { score: run.score, distance: run.distance, topSpeed: run.topSpeed, combo: run.bestMultiplier, env: this.selectedEnv };
    const ch = this.challenge;
    if (ch && ch.accepted) {
      if (run.score > ch.score) {
        events.unshift(['unlock', `CHALLENGE WON · you beat ${ch.name}'s ${ch.score.toLocaleString('en-US')}`]);
        this.challenge = null;
      } else {
        events.push(['mission', `Challenge · ${(ch.score - run.score).toLocaleString('en-US')} short of ${ch.name}`]);
      }
    }
    const hadGhost = Boolean(this.ghost.best);
    if (this.ghost.finishRun(run.score, this.car.id) && hadGhost && this.ghost.enabled) {
      events.push(['unlock', 'You beat your ghost — this run is the new one']);
    }

    const rewards = prog.runRewards(run);
    const goals = this.goals.settle(run);
    const credits = rewards.credits.concat(goals.credits);
    const xp = rewards.xp + goals.xp;
    for (const e of goals.events) events.push(e);
    const creditsTotal = credits.reduce((sum, [, v]) => sum + v, 0);
    save.credits += creditsTotal;
    save.stats.creditsEarned += creditsTotal;

    const before = prog.levelProgress();
    const levelsGained = prog.addXp(xp);
    const after = prog.levelProgress();
    for (const car of prog.checkUnlocks()) this.noteUnlock(car, events);
    if (levelsGained.length) events.unshift(['unlock', `LEVEL ${after.level} · ${after.title}`]);
    this.store.save();
    this.trackRunEnd(run, goals.events, levelsGained.length ? after.level : 0);

    const km = v => `${(v / 1000).toFixed(2)} KM`;
    const isRecord = key => beaten.includes(key);
    if (levelsGained.length) this.audio.levelUp();
    else if (isRecord('score')) this.audio.record();
    return {
      online,
      title: this.player.health <= 0 ? 'Wrecked' : 'Run complete',
      score: run.score,
      newBest: isRecord('score'),
      stats: [
        ['Distance', km(run.distance), isRecord('distance')],
        ['Max speed', `${Math.round(run.topSpeed)} KM/H`, isRecord('topSpeed')],
        ['Best combo', `x${run.bestMultiplier}`, isRecord('combo')],
        ['Near misses', String(run.nearMisses), isRecord('nearMisses')],
        ['Overtakes', String(run.overtakes), isRecord('overtakes')],
        ['Perfect overtakes', String(run.perfectOvertakes), false],
        ['Police escapes', String(run.policeEscapes), isRecord('chase')],
        ['Clean streak', km(run.bestCleanDistance), isRecord('cleanDistance')],
      ],
      credits,
      creditsTotal,
      xp,
      level: after,
      levelsGained,
      xpStart: before.xp / before.need,
      xpEnd: after.xp / after.need,
      events,
      next: this.nextGoals(run, isRecord('score')),
    };
  }

  // "Why play again?" — the closest concrete things to go after next run.
  nextGoals(run, newBest) {
    const prog = this.progression;
    const fmt = n => Math.floor(n).toLocaleString('en-US');
    const out = [];
    const up = prog.nextUpgrade();
    if (up) {
      out.push(up.affordable
        ? { hot: true, title: `Upgrade ready: ${up.label}`, detail: `◈ ${fmt(up.cost)} — you have ◈ ${fmt(this.save.credits)}. Visit the garage.`, ratio: -1 }
        : { title: `Next upgrade: ${up.label}`, detail: `◈ ${fmt(this.save.credits)} / ${fmt(up.cost)}`, ratio: this.save.credits / up.cost });
    }
    const car = prog.nextCar();
    if (car) out.push({ title: `Unlock ${car.car.name}`, detail: car.text, ratio: car.ratio });
    const missions = this.save.missions.active;
    let bestMission = null;
    let bestRatio = -1;
    for (const m of missions) {
      const r = Math.min(1, this.goals.missionValue(m, null) / m.target);
      if (r > bestRatio) {
        bestRatio = r;
        bestMission = m;
      }
    }
    if (bestMission) out.push({ title: 'Mission', detail: `${objectiveText(bestMission.type, bestMission.target)} · ◈ ${bestMission.credits}`, ratio: bestRatio });
    if (!newBest && this.save.records.score > 0) {
      out.push({ title: `Beat your best: ${fmt(this.save.records.score)}`, detail: `This run: ${fmt(run.score)}`, ratio: Math.min(1, run.score / this.save.records.score) });
    }
    return out.slice(0, 3);
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    this.time += dt;
    if (this.state === STATE.COUNTDOWN) this.updateCountdown(dt);
    if (this.state === STATE.CRASHING) {
      this.crashTimer -= dt;
      const t = 1 - Math.max(0, this.crashTimer) / GAME.CRASH_SLOWMO;
      this.timeScale = lerp(GAME.CRASH_TIMESCALE, 1, t * t);
    }
    const sim = dt * this.timeScale;
    const p = this.player;
    const playing = this.state === STATE.PLAYING;
    if (playing) this.runTime += dt;
    if (this.introTimer > 0) {
      this.introTimer -= dt;
      if (this.introTimer <= 0) this.hideIntro();
    }

    // input → player
    this.updateDifficulty();
    this.updateControls(sim);
    p.grip = this.weather.grip;
    p.update(sim, this.controls, this.maxKmh, this.cruiseKmh(), this.road.playerCurve);
    if (p.boostStarted && playing) this.onBoostStart();
    const traveled = p.speed * sim;
    const kmh = p.speed * 3.6;

    // world, weather, events, spawning
    this.road.update(sim, p.speed, this.difficulty);
    this.environment.update(this.state === STATE.MENU ? this.road.distance : this.score.distance, this.weather.wet);
    this.weather.update(sim, this.score.distance, clamp(kmh / 300, 0, 1.2), this.environment.env, this.road.cameraInTunnel);
    const rainLevel = this.road.cameraInTunnel ? 0 : Math.round(this.weather.rain * 10);
    if (rainLevel !== this.rainLevel) {
      this.rainLevel = rainLevel;
      this.audio.rain(rainLevel / 10);
    }
    if (playing) this.events.update(sim);
    this.traffic.update(sim, p.speed, traveled, this.difficulty, p.x);
    this.pickups.update(sim, p.speed, traveled, this.traffic, playing, p.health < PLAYER.MAX_HEALTH);

    // collisions → scoring → goals
    if (playing) {
      this.skills.scan(sim);
      this.pickups.collect(p, this.handlePickup);
    }
    if (this.state === STATE.PLAYING) {
      this.skills.updateScoring(sim, traveled, this.events.scoreBonus);
      this.ghost.record(this.runTime, this.score.distance, p.x);
      this.updateGoals(dt);
    }
    this.skills.comboFeedback();

    // camera + effects
    this.camera.update(sim, p, kmh);
    this.road.prepare(this.camera);
    this.road.setFog(this.ctx, this.camera, this.environment.fogRgb, this.weather.fog);
    this.updatePlayerScreen();
    this.updateEffects(sim, kmh);
    this.audio.updateEngine(dt, kmh / GAME.ENGINE_TOP_KMH, p.throttle, p.boosting, this.isRaceActive(), p.slipstream, this.road.cameraInTunnel);
    this.audio.updateMusic(this.musicIntensity(kmh));
    this.updateHud(dt);

    if (this.state === STATE.CRASHING && this.crashTimer <= 0) this.gameOver();
  }

  isRaceActive() {
    return this.state === STATE.COUNTDOWN || this.state === STATE.PLAYING || this.state === STATE.CRASHING;
  }

  musicIntensity(kmh) {
    if (!this.isRaceActive()) return 0;
    let v = clamp((kmh - 100) / 220, 0, 1) * 0.5 + this.score.tier * 0.08;
    if (this.player.boosting) v += 0.15;
    if (this.events.police.active) v = Math.max(v, 0.85);
    return clamp(v, 0, 1);
  }

  updateGoals(dt) {
    this.goalTimer -= dt;
    if (this.goalTimer > 0) return;
    this.goalTimer = GOAL_CHECK_INTERVAL;
    const run = this.liveRun();
    const done = this.goals.checkLive(run);
    for (const [variant, kicker, title] of done) {
      this.ui.toast(kicker, title, variant);
      if (variant === 'achievement') this.audio.achievement();
      else this.audio.perfect();
    }
    this.ui.setMissionTracker(this.goals.trackerItems(run));
  }

  updateCountdown(dt) {
    this.countdown -= dt;
    const step = Math.ceil(this.countdown);
    if (step !== this.countdownStep && step > 0) {
      this.countdownStep = step;
      this.ui.showCallout(String(step), 'count');
      this.audio.countdown(false, step);
      this.camera.addTrauma(0.12);
    }
    if (this.countdown <= 0) {
      this.state = STATE.PLAYING;
      this.traffic.spawnEnabled = true;
      this.introTimer = INTRO_LINGER;
      this.ui.showCallout('GO!', 'go');
      this.audio.countdown(true, 0);
      this.camera.addTrauma(0.25);
      this.camera.kick(0.05);
    }
  }

  updateDifficulty() {
    if (this.state === STATE.MENU) {
      this.difficulty = 0.4;
      this.maxKmh = this.player.topKmh(0);
      return;
    }
    const t = difficultyAt(this.runTime);
    this.difficulty = t;
    this.maxKmh = this.player.topKmh(DIFFICULTY.PLAYER_SPEED_BONUS * t);
  }

  cruiseKmh() {
    switch (this.state) {
      case STATE.MENU: return GAME.MENU_KMH;
      case STATE.COUNTDOWN: return PLAYER.START_KMH;
      case STATE.PLAYING: return PLAYER.CRUISE_KMH;
      default: return 0;
    }
  }

  updateControls(dt) {
    const c = this.controls;
    const input = this.input;
    switch (this.state) {
      case STATE.PLAYING:
        c.steer = input.steer;
        c.throttle = input.throttle;
        c.brake = input.brake;
        c.boost = input.boost;
        break;
      case STATE.COUNTDOWN:
        c.steer = input.steer;
        c.throttle = false;
        c.brake = false;
        c.boost = false;
        break;
      case STATE.MENU:
        // Attract mode: drift between lanes behind the menu.
        this.autoTimer -= dt;
        if (this.autoTimer <= 0) {
          this.autoTimer = rand(2.5, 5.5);
          this.autoLane = randInt(0, ROAD.LANES - 1);
        }
        c.steer = clamp((laneCenter(this.autoLane) - this.player.x) * 0.45, -1, 1);
        c.throttle = false;
        c.brake = false;
        c.boost = false;
        break;
      default:
        c.steer = 0;
        c.throttle = false;
        c.brake = true;
        c.boost = false;
    }
  }

  onBoostStart() {
    this.effects.callout('BOOST!', PALETTE.CYAN, this.camera, 40, 0.36, 0.9);
    this.audio.boost();
    this.camera.addTrauma(0.12);
    this.camera.kick(0.04);
  }

  handlePickup(type) {
    const p = this.player;
    const stats = this.score.stats;
    stats.pickups++;
    if (type === PICKUP_REPAIR) {
      p.repair(PICKUPS.REPAIR_AMOUNT);
      this.skills.award('REPAIR', SCORE.PICKUP, 1, PALETTE.GREEN);
      this.effects.flash.pickup = 1;
    } else if (type === PICKUP_CREDITS) {
      stats.bonusCredits += PICKUPS.CREDIT_CHIP_VALUE;
      this.skills.award('CREDIT CHIP', SCORE.PICKUP * 2, 1, PALETTE.GOLD);
    } else {
      p.addBoost(PICKUPS.BOOST_AMOUNT);
      this.skills.award('BOOST CELL', SCORE.PICKUP, 1, PALETTE.CYAN);
      this.effects.flash.near = 0.6;
    }
    this.audio.pickup(type);
    const ps = this.playerScreen;
    this.effects.particles.burst(PARTICLE.BOOST, ps.x, ps.y - ps.h * 0.8, 16, ps.scale * 4, 0.5, ps.scale * 0.3, 0);
  }

  resolveCrash(car, dx, dz, limX, limZ) {
    const p = this.player;
    const dir = sign(dx); // +1: car is to our right
    const penX = (limX - Math.abs(dx)) / limX;
    const penZ = (limZ - Math.abs(dz)) / limZ;
    const sideHit = penX < penZ && !car.barrier;
    const rel = Math.abs(p.speed - car.speed);
    let damage = lerp(DAMAGE.MIN, DAMAGE.MAX, clamp(rel / DAMAGE.FULL_REL_SPEED, 0, 1));

    if (sideHit) {
      damage *= DAMAGE.SIDE_FACTOR;
      p.x -= dir * (limX - Math.abs(dx) + 0.05);
      p.vx = -dir * DAMAGE.SIDE_BOUNCE;
      p.speed *= 0.85;
      car.kickX = dir * 3.5;
    } else if (dz > 0) {
      // Rear-ended the vehicle ahead: it gets shoved forward, we lose speed but keep rolling.
      const impact = p.speed;
      p.speed = Math.min(p.speed * DAMAGE.REAR_SPEED_KEEP, car.barrier ? p.speed * 0.5 : car.speed * 0.9);
      if (car.barrier) {
        // Can't shove a barrier: bounce the player sideways toward open road instead.
        const away = car.lane === 0 ? 1 : car.lane === ROAD.LANES - 1 ? -1 : -dir;
        p.x += away * (limX - Math.abs(dx) + 0.3);
        p.vx = away * DAMAGE.SIDE_BOUNCE;
      } else {
        car.speed = Math.max(car.speed, impact * 0.85);
        car.z = CAMERA.PLAYER_DEPTH + (car.length + p.profile.length) * 0.5 + 0.3;
        car.kickX = (Math.random() < 0.5 ? -1 : 1) * 1.5;
      }
    } else {
      p.speed += 6;
      car.speed *= 0.7;
      car.z = CAMERA.PLAYER_DEPTH - (car.length + p.profile.length) * 0.5 - 0.3;
    }
    if (!car.barrier) {
      car.hit = true;
      car.wobble = 1;
      if (car.patternSlot >= 0) this.traffic.resolvePattern(car, true);
    }
    const applied = p.takeDamage(damage);
    const lost = this.score.breakCombo();
    this.score.stats.crashes++;
    this.events.onCrash();
    this.effects.flash.damage = 1;
    this.camera.addTrauma(sideHit ? 0.4 : 0.65);
    this.input.rumble(sideHit ? 0.45 : 0.75, 180);
    this.audio.crash(sideHit ? 0.6 : 1);
    this.ui.damageFlash(dir);

    const ps = this.playerScreen;
    this.effects.impact(ps.x + dir * ps.w * (sideHit ? 0.5 : 0.2), ps.y - ps.h * (sideHit ? 0.4 : 0.9), ps.scale, !sideHit);
    this.effects.popAtPlayer(`-${applied} HULL`, PALETTE.RED, ps);
    if (lost > 1) {
      this.effects.callout(`COMBO x${lost} LOST`, PALETTE.RED, this.camera, 26, 0.24, 1);
      this.audio.comboDown();
    }
    if (p.health <= 0) this.beginCrashSequence(-dir);
  }

  updatePlayerScreen() {
    const cam = this.camera;
    const ps = this.playerScreen;
    const p = this.player;
    const z = p.sortZ;
    const s = cam.focal / z;
    ps.scale = s;
    ps.x = cam.cx + (p.x + this.road.offsetAt(z) - cam.x) * s;
    ps.y = cam.horizonY + CAMERA.HEIGHT * s;
    ps.w = p.profile.width * s;
    ps.h = p.profile.height * s;
  }

  updateEffects(sim, kmh) {
    const p = this.player;
    this.effects.emitPlayer(sim, p, this.playerScreen, this.state !== STATE.MENU);
    if (p.scraping) {
      this.scrapeTimer -= sim;
      if (this.scrapeTimer <= 0) {
        this.scrapeTimer = 0.11;
        this.audio.scrape();
        this.camera.addTrauma(0.04);
      }
    }
    if ((p.braking && p.speed > 15) || (kmh > 160 && Math.abs(p.vx) > p.lateralLimit * 0.8)) this.audio.tires(sim);
    // Desert dust kicked up along the road edges at speed.
    if (this.environment.env.dust && kmh > 140 && !this.road.cameraInTunnel) {
      this.dustAcc += sim * (kmh - 140) * 0.25 * this.effects.detail;
      const cam = this.camera;
      while (this.dustAcc >= 1) {
        this.dustAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        const x = cam.cx + side * cam.width * rand(0.3, 0.55);
        this.effects.particles.emit(PARTICLE.DUST, x, cam.height * rand(0.6, 0.95), side * rand(80, 260), rand(40, 160),
          rand(0.4, 0.8), cam.height * rand(0.05, 0.12), cam.height * 0.1, 1, 0);
      }
    }
    this.effects.update(sim, this.speedLineIntensity(kmh), p.boosting);
  }

  // Calm below ~160 km/h, intense past ~300 km/h.
  speedLineIntensity(kmh) {
    if (this.player.boosting) return 1;
    return clamp((kmh - 160) / 160, 0, 0.9);
  }

  updateHud(dt) {
    if (!this.isRaceActive()) return;
    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = PERF.HUD_INTERVAL;
    const p = this.player;
    const s = this.score;
    const d = this.hudData;
    d.score = s.score;
    d.best = Math.max(this.save.records.score, Math.floor(s.score));
    d.speed = p.speed * 3.6;
    d.distance = s.distance;
    d.mult = s.multiplier;
    d.tier = s.tier;
    d.tierProgress = s.tierProgress;
    d.comboTime = s.comboTimeRatio;
    d.health = p.health;
    d.boost = p.boost;
    d.boosting = p.boosting;
    d.boostReady = p.boost >= 8;
    d.lowHealth = p.health < PLAYER.LOW_HEALTH;
    d.slipstream = p.slipstream > 0.5;
    this.ui.updateHud(d);
  }

  // ---------------------------------------------------------------- render

  render() {
    const ctx = this.ctx;
    const cam = this.camera;
    const rs = this.renderScale;
    ctx.setTransform(rs, 0, 0, rs, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.environment.renderSky(ctx);
    ctx.save();
    // Shake + roll pivot around the vanishing point so the horizon stays stable.
    ctx.translate(cam.cx + cam.shakeX, cam.horizonY + cam.shakeY);
    ctx.rotate(cam.roll);
    ctx.translate(-cam.cx, -cam.horizonY);
    this.environment.renderSkyline(ctx, cam, this.road.skyOffset);
    this.road.render(ctx, cam);
    this.road.renderFog(ctx, cam);
    this.events.renderMarkers(ctx, cam, this.road);
    this.renderEntities(ctx);
    this.events.renderPolice(ctx, cam, this.road);
    this.effects.renderWorld(ctx);
    ctx.restore();

    const kmh = this.player.speed * 3.6;
    this.weather.render(ctx, cam, clamp(kmh / 300, 0, 1.2), this.road.cameraInTunnel);
    const racing = this.state === STATE.PLAYING || this.state === STATE.CRASHING;
    const lowHealth = racing && this.player.health < PLAYER.LOW_HEALTH ? 0.28 + 0.18 * Math.sin(this.time * 6) : 0;
    this.effects.renderScreen(ctx, cam, lowHealth);
  }

  renderEntities(ctx) {
    const list = this.entities;
    list.length = 0;
    const cars = this.traffic.vehicles;
    for (let i = 0; i < cars.length; i++) list.push(cars[i]);
    const pickups = this.pickups.pool;
    for (let i = 0; i < pickups.length; i++) if (pickups[i].active) list.push(pickups[i]);
    list.push(this.player);
    if (this.state === STATE.PLAYING || this.state === STATE.CRASHING) {
      const ghost = this.ghost.place(this.runTime, this.score.distance);
      if (ghost) list.push(ghost);
    }
    list.sort(sortBackToFront);

    const cam = this.camera;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.kind === 'vehicle') this.traffic.drawVehicle(ctx, e, cam, this.road);
      else if (e.kind === 'pickup') this.pickups.draw(ctx, e, cam, this.road);
      else if (e.kind === 'ghost') this.drawGhost(ctx, e);
      else this.drawPlayer(ctx);
    }
  }

  // Personal-best ghost: the player's own car sprite, translucent and additive. Fades out
  // when it's right on top of the player so it never hides the real car.
  drawGhost(ctx, g) {
    const cam = this.camera;
    const rear = g.sortZ;
    const s = cam.focal / rear;
    const sprite = this.bank.player.normal;
    const k = s / sprite.ppm;
    const sx = cam.cx + (g.x + this.road.offsetAt(rear) - cam.x) * s;
    const sy = cam.horizonY + CAMERA.HEIGHT * s;
    const near = clamp(Math.abs(g.ahead) / 6, 0, 1);
    const far = rear > this.road.fadeStart ? Math.max(0, 1 - (rear - this.road.fadeStart) / (ROAD.DRAW_DISTANCE - this.road.fadeStart)) : 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.32 * near * far;
    ctx.drawImage(sprite.canvas, sx - sprite.anchorX * k, sy - sprite.anchorY * k, sprite.canvas.width * k, sprite.canvas.height * k);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  drawPlayer(ctx) {
    const p = this.player;
    const ps = this.playerScreen;
    const cam = this.camera;
    const bank = this.bank;

    // Headlight wash on the road ahead, skewed so it follows the car's perspective line.
    const frontZ = CAMERA.PLAYER_DEPTH + p.profile.length * 0.5;
    const farZ = frontZ + BEAM.LENGTH;
    const fs = cam.focal / frontZ;
    const fz = cam.focal / farZ;
    const xFront = cam.cx + (p.x + this.road.offsetAt(frontZ) - cam.x) * fs;
    const xFar = cam.cx + (p.x + this.road.offsetAt(farZ) - cam.x) * fz;
    const yFront = cam.horizonY + CAMERA.HEIGHT * fs;
    const yFar = cam.horizonY + CAMERA.HEIGHT * fz;
    const beamH = yFront - yFar;
    const beamW = BEAM.FAR_WIDTH * fz;
    // Headlights matter more at night and in tunnels.
    const beamStrength = this.road.cameraInTunnel ? 1 : 0.45 + 0.5 * this.environment.lampAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (p.wrecked ? 0.25 : 0.9) * beamStrength;
    ctx.save();
    ctx.translate(xFront, yFront);
    ctx.transform(1, 0, (xFront - xFar) / beamH, 1, 0, 0);
    ctx.drawImage(bank.beam, -beamW / 2, -beamH, beamW, beamH);
    ctx.restore();

    if (bank.underglow) {
      ctx.globalAlpha = 0.85;
      const ugW = ps.w * 1.5;
      const ugH = ps.h * 0.5;
      ctx.drawImage(bank.underglow, ps.x - ugW / 2, ps.y - ugH * 0.55, ugW, ugH);
    }
    ctx.globalCompositeOperation = 'source-over';

    const sprite = p.braking ? bank.player.brake : bank.player.normal;
    const k = ps.scale / sprite.ppm;
    const blink = p.invulnerable > 0 && !p.wrecked && ((this.time * 14) | 0) % 2 === 0;
    ctx.globalAlpha = blink ? 0.4 : 1;
    ctx.save();
    ctx.translate(ps.x, ps.y);
    ctx.rotate(p.tilt);
    ctx.drawImage(sprite.canvas, -sprite.anchorX * k, -sprite.anchorY * k, sprite.canvas.width * k, sprite.canvas.height * k);
    if (p.boosting) {
      ctx.globalCompositeOperation = 'lighter';
      const fw = ps.w * 0.16;
      for (let side = -1; side <= 1; side += 2) {
        const fh = ps.h * (0.9 + Math.random() * 0.5);
        ctx.drawImage(bank.flame, side * ps.w * 0.3 - fw / 2, -ps.h * 0.2, fw, fh);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
