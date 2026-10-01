import { ROAD, CAMERA, TRAFFIC, laneCenter } from './config.js';
import { HEAT, POLICE, ROADBLOCK } from './balance.js';
import { BARRIER_ROADBLOCK, BARRIER_SPIKES } from './TrafficManager.js';
import { clamp, approach, randInt } from './utils.js';
import { PRIORITY } from './BonusFeed.js';

const UNIT = { width: 1.95, length: 4.5 };
// Feed text uses a number: the display font draws ☆ almost like ★ at small sizes.
const STARS = n => `${n}★`;
const laneOf = x => clamp(Math.round((x + ROAD.HALF_WIDTH) / ROAD.LANE_WIDTH - 0.5), 0, ROAD.LANES - 1);

// Heat and police. Risky driving builds HEAT (0–5 stars, shown on the HUD). From ★2 real
// police cars are dispatched: they appear behind you (off screen, siren and rear-view warning
// first), catch up physically, and pursue you through traffic. Higher stars add units,
// interceptors that get ahead and brake-check, telegraphed ramming, and roadblocks with spike
// strips. You escape by breaking line of sight (filling the escape meter); you are busted if
// they box you in while you're slow. Escapes pay by heat — police are opportunity, not only danger.
//
// Units are ordinary traffic vehicles with a controller (this), so they collide, block lanes,
// sort and render like everything else; nothing ever spawns on or in front of the player.
export class PoliceSystem {
  constructor(game) {
    this.game = game;
    this.units = [];
    this.reset();
  }

  reset() {
    this.heat = 0;
    this.pendingChase = false;
    this.level = 0;
    this.chase = null;
    this.lastRisk = -10;
    this.gainScale = 1; // run personality (RunDirector)
    this.roadblock = null;
    this.roadblockCooldown = 0;
    this.units.length = 0;
    this.patrols = 0;
    this.radar = null; // { dz, side } of the closest unit behind, for the HUD
    this.alert = 0; // 0..1 danger pulse (ram / brake-check warnings) for the HUD edges
    this.sirenLevel = 0;
    this.releaseTimer = 0; // short musical release after an escape
    this.stats = { maxHeat: 0, escapes: 0, escapeStars: 0, bestEscape: 0, busted: 0, chaseTime: 0, longestChase: 0 };
    this.game.audio.sirenLevel(0);
    this.game.signals.emit('heat:level', { level: 0, up: false });
  }

  get active() {
    return this.chase !== null;
  }

  get scoreScale() {
    return 1 + HEAT.SCORE_BONUS_PER_STAR * this.level;
  }

  // ---------------------------------------------------------------- heat

  addHeat(amount, reason) {
    const g = this.game;
    if (amount <= 0 || g.state !== 'playing') return;
    const warm = g.runTime < HEAT.WARMUP_SECONDS ? HEAT.WARMUP_GAIN : 1;
    this.heat = Math.min(HEAT.MAX, this.heat + amount * warm * this.gainScale);
    if (reason) this.lastRisk = g.time;
    this.refreshLevel();
  }

  setHeat(value) {
    this.heat = clamp(value, 0, HEAT.MAX);
    if (this.heat < HEAT.CHASE_AT) this.pendingChase = false;
    this.refreshLevel();
  }

  refreshLevel() {
    const level = Math.min(5, Math.floor(this.heat / HEAT.PER_STAR));
    if (level === this.level) return;
    const g = this.game;
    const up = level > this.level;
    this.level = level;
    if (level > this.stats.maxHeat) this.stats.maxHeat = level;
    g.telemetry.push({ t: g.runTime, what: `heat:${up ? 'up' : 'down'}:${level}` });
    g.signals.emit('heat:level', { level, up });
    if (up && level >= 1) {
      g.ui.feed.push(`HEAT ${STARS(level)}`, 0, level >= 3 ? PRIORITY.IMPORTANT : PRIORITY.ROUTINE, 'danger', 'heat');
      g.audio.heatUp(level);
      g.haptics.pulse(level >= 3 ? 'near' : 'tap');
    }
  }

  onNearMiss(grade, car) {
    this.addHeat(car.police ? HEAT.POLICE_NEAR_MISS : HEAT.NEAR_MISS[grade], true);
    if (car.police && this.chase) this.chase.escape = Math.min(1, this.chase.escape + 0.05);
  }

  onPerfect() {
    this.addHeat(HEAT.PERFECT, true);
  }

  onChicane() {
    this.addHeat(HEAT.CHICANE, true);
  }

  onCrash(car) {
    const c = this.chase;
    if (car && car.police) {
      this.addHeat(HEAT.POLICE_HIT, true);
      if (c) c.bust = Math.min(1, c.bust + POLICE.BUST_HIT);
    }
    if (car && car.barrier === BARRIER_ROADBLOCK) {
      this.addHeat(HEAT.ROADBLOCK_CRASH, true);
      if (c) c.bust = Math.min(1, c.bust + POLICE.BUST_HIT);
    }
    if (c) c.escape = Math.max(0, c.escape - POLICE.ESCAPE_CRASH);
  }

  // Overtaking a police car: patrols notice fast drivers; pursuers lose ground.
  onPass(car) {
    const g = this.game;
    if (!car.police) return;
    const kmh = g.player.speed * 3.6;
    if (car.role === 'patrol') {
      if (kmh >= POLICE.PATROL_BLAST_KMH) {
        g.skills.award('BLASTED PAST', POLICE.PATROL_POINTS, 2, 'danger');
        this.addHeat(HEAT.SPOTTED, true);
        car.lights = true;
        this.recruit(car);
        g.telemetry.push({ t: g.runTime, what: 'police:spotted' });
      }
      return;
    }
    if (this.chase && car.role === 'unit') {
      this.chase.escape = Math.min(1, this.chase.escape + POLICE.ESCAPE_PASS);
      g.skills.award('POLICE PASSED', POLICE.PASS_POINTS, 1, 'cyan');
    }
  }

  // ---------------------------------------------------------------- frame update

  update(dt) {
    const g = this.game;
    const p = g.player;
    const kmh = p.speed * 3.6;
    const top = g.maxKmh;
    const playing = g.state === 'playing';
    if (playing) {
      // Passive heat from how you drive right now.
      let gain = 0;
      if (kmh >= top * HEAT.SPEED_RATIO) gain += HEAT.SPEED_PER_SEC;
      if (p.boosting) gain += HEAT.BOOST_PER_SEC;
      if (g.score.tier >= 2) gain += (g.score.tier - 1) * HEAT.COMBO_PER_TIER_SEC;
      if (gain > 0) this.addHeat(gain * dt, false);
      if (!this.chase) {
        const calm = kmh < top * HEAT.CALM_RATIO && !p.boosting && g.time - this.lastRisk > 4;
        // Heat that called the police during a blocking event (roadwork, rival…) waits for it
        // to end instead of quietly decaying away: the chase is only postponed.
        const floor = this.pendingChase ? HEAT.CHASE_AT : 0;
        this.heat = Math.max(floor, this.heat - (calm ? HEAT.DECAY_CALM : HEAT.DECAY) * dt);
        this.refreshLevel();
        if (this.heat >= HEAT.CHASE_AT) {
          if (g.director.allowChase()) this.startChase();
          else this.pendingChase = true;
        }
      }
    }
    if (this.releaseTimer > 0) this.releaseTimer -= dt;
    if (this.roadblockCooldown > 0) this.roadblockCooldown -= dt;
    if (this.chase && playing) this.updateChase(dt, kmh);
    if (this.roadblock) this.updateRoadblock();
    this.updateRadar(dt);
  }

  // ---------------------------------------------------------------- chase

  startChase() {
    const g = this.game;
    this.pendingChase = false;
    this.chase = { time: 0, escape: 0, bust: 0, dispatch: 0, engaged: false, startLevel: this.level };
    g.ui.feed.push('POLICE DETECTED', 0, PRIORITY.IMPORTANT, 'danger', 'police');
    g.audio.policeAlert();
    g.telemetry.push({ t: g.runTime, what: `chase:start:${this.level}` });
    g.director.onChaseStart();
    // Patrol cars that already have their lights on join straight away.
    for (const car of g.traffic.vehicles) if (car.police && car.role === 'patrol' && car.lights) this.recruit(car);
  }

  // A patrol car becomes a pursuing unit.
  recruit(car) {
    if (!this.units.includes(car)) this.units.push(car);
    car.role = 'unit';
    car.lights = true;
    car.ai = { state: 'shadow', timer: 1.5, cooldown: 2 };
  }

  updateChase(dt, kmh) {
    const g = this.game;
    const c = this.chase;
    c.time += dt;
    this.stats.chaseTime += dt;
    // Keep the pursuit staffed for the current heat level (replacements take a while).
    c.dispatch -= dt;
    const wanted = Math.max(1, POLICE.UNITS[this.level]);
    if (this.units.length < wanted && c.dispatch <= 0) {
      if (this.dispatch()) c.dispatch = this.units.length < wanted ? 1.2 : POLICE.REDISPATCH;
      else c.dispatch = 0.5;
    }
    // Escape: the farther behind the closest pursuer (and nobody waiting ahead), the faster
    // the meter fills; fully out of sight fills it fastest. Anyone close drains it.
    let seen = false;
    let close = false;
    let ahead = false;
    let nearestBehind = Infinity;
    for (const car of this.units) {
      const dz = car.z - CAMERA.PLAYER_DEPTH;
      if (dz > TRAFFIC.DESPAWN_BEHIND - CAMERA.PLAYER_DEPTH + 2 && dz < POLICE.VIEW_AHEAD) seen = true;
      if (Math.abs(dz) < POLICE.PRESSURE_DZ) close = true;
      if (dz > 2 && dz < POLICE.VIEW_AHEAD * 0.7) ahead = true;
      if (dz <= 2) nearestBehind = Math.min(nearestBehind, -dz);
      // The chase is officially on once a unit is physically on screen (right behind, beside or
      // ahead) — never just because one was dispatched somewhere behind.
      if (!c.engaged && dz > POLICE.ENGAGE_DZ) {
        c.engaged = true;
        g.ui.feed.push(`PURSUIT ${STARS(this.level)}`, 0, PRIORITY.IMPORTANT, 'danger', 'police');
        g.telemetry.push({ t: g.runTime, what: 'chase:engaged' });
        g.signals.emit('chase:engaged', { level: this.level });
      }
    }
    const top = Math.max(1, g.maxKmh);
    const rate = POLICE.ESCAPE_RATE[0] + (POLICE.ESCAPE_RATE[1] - POLICE.ESCAPE_RATE[0]) * clamp(kmh / top, 0, 1.2);
    // You can't escape police you never saw: the meter waits for the first unit on screen
    // (with a safety valve if traffic keeps every unit back).
    if (!c.engaged && c.time < POLICE.ENGAGE_GRACE) c.escape = 0;
    else if (!seen) c.escape += rate * dt;
    else if (close) c.escape = Math.max(0, c.escape - POLICE.ESCAPE_DRAIN * dt);
    else if (!ahead && nearestBehind > POLICE.ESCAPE_FROM_DZ) c.escape += rate * clamp((nearestBehind - POLICE.ESCAPE_FROM_DZ) / 15, 0.25, 0.8) * dt;
    else c.escape += POLICE.ESCAPE_BASE * dt;
    if (close && kmh < POLICE.BUST_SLOW_KMH) c.bust += POLICE.BUST_RATE * dt;
    else c.bust = Math.max(0, c.bust - POLICE.BUST_DECAY * dt);

    if (this.level >= ROADBLOCK.FROM_STAR && !this.roadblock && this.roadblockCooldown <= 0 && c.time > 6 && g.director.allowObstacle()) this.spawnRoadblock();

    if (c.bust >= 1) this.endChase(false);
    else if (c.escape >= 1) this.endChase(true);
  }

  // One unit enters from behind in a lane next to yours, off screen, siren first.
  dispatch() {
    const g = this.game;
    const player = laneOf(g.player.x);
    const order = [player - 1, player + 1, player - 2, player + 2].filter(l => l >= 0 && l < ROAD.LANES);
    const z = CAMERA.PLAYER_DEPTH + POLICE.SPAWN_DZ;
    for (const lane of order) {
      const car = g.traffic.spawnUnit({
        typeKey: 'police', sprites: g.bank.police, width: UNIT.width, length: UNIT.length,
        lane, z, speed: g.player.speed, controller: this, police: true, role: 'unit',
      });
      if (car) {
        car.ai = { state: 'approach', timer: 0, cooldown: 3, blocked: 0, first: this.chase && !this.chase.firstSent };
        if (this.chase) this.chase.firstSent = true;
        this.units.push(car);
        g.telemetry.push({ t: g.runTime, what: 'police:spawn' });
        return true;
      }
    }
    return false;
  }

  endChase(escaped) {
    const g = this.game;
    const c = this.chase;
    const level = Math.max(1, this.level);
    this.chase = null;
    this.stats.longestChase = Math.max(this.stats.longestChase, Math.round(c.time));
    g.score.stats.longestChase = Math.max(g.score.stats.longestChase, Math.round(c.time));
    // Every unit gives up: lights off, falling back.
    for (const car of this.units) {
      car.role = 'retreat';
      car.lights = false;
    }
    this.units.length = 0;
    g.signals.emit('chase:end', { escaped, engaged: c.engaged, level });
    if (escaped) {
      const points = POLICE.ESCAPE_POINTS[level];
      this.stats.escapes++;
      this.stats.escapeStars += level;
      g.score.stats.policeEscapes++;
      g.score.stats.escapeStars += level;
      const best = level > this.stats.bestEscape;
      this.stats.bestEscape = Math.max(this.stats.bestEscape, level);
      g.score.stats.heatEscaped = Math.max(g.score.stats.heatEscaped, level);
      g.score.addBonus(points);
      g.player.addBoost(40);
      const secs = Math.round(c.time);
      g.ui.feed.push(`ESCAPED ${STARS(level)} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, points, PRIORITY.MAJOR, 'good', 'escape');
      if (best && level >= 2) g.ui.feed.push('BEST ESCAPE', 0, PRIORITY.IMPORTANT, 'good', 'best-escape');
      g.audio.escape();
      g.haptics.pulse('unlock');
      this.releaseTimer = 4;
      this.heat *= HEAT.ESCAPE_KEEP;
      g.telemetry.push({ t: g.runTime, what: `chase:escaped:${level}:${secs}s` });
    } else {
      this.stats.busted++;
      g.ui.feed.push('BUSTED', 0, PRIORITY.MAJOR, 'danger', 'busted');
      g.score.breakCombo();
      g.player.takeDamage(POLICE.BUSTED_DAMAGE);
      g.effects.flash.damage = 1;
      g.camera.addTrauma(0.5);
      g.audio.crash(0.7);
      this.heat = 0;
      g.telemetry.push({ t: g.runTime, what: `chase:busted:${level}` });
      if (g.player.health <= 0) g.beginCrashSequence(1);
    }
    this.refreshLevel();
    g.director.onChaseEnd(escaped);
  }

  onDespawn(car) {
    const i = this.units.indexOf(car);
    if (i >= 0) this.units.splice(i, 1);
    if (car.role === 'patrol') this.patrols = Math.max(0, this.patrols - 1);
  }

  // ---------------------------------------------------------------- unit AI

  // Called by TrafficManager for every police vehicle. Obeys traffic: never drives through
  // cars, never changes lane into you at close range except a telegraphed ram, and never
  // exceeds its speed limit for the current heat (so outrunning them is always possible).
  updateUnit(car, dt, playerSpeed) {
    const g = this.game;
    const ai = car.ai;
    const dz = car.z - CAMERA.PLAYER_DEPTH;
    const player = laneOf(g.player.x);
    const maxV = (POLICE.SPEED_RATIO[Math.max(1, this.level)] * g.maxKmh) / 3.6;
    let target = car.baseSpeed;
    ai.cooldown = (ai.cooldown || 0) - dt;
    ai.timer = (ai.timer || 0) - dt;
    car.braking = false;

    switch (car.role) {
      case 'patrol':
        target = POLICE.PATROL_SPEED_KMH / 3.6;
        break;
      case 'retreat':
        target = playerSpeed * 0.55;
        car.blinkDir = 0;
        break;
      default: {
        // 'unit' in pursuit
        const intercept = this.level >= POLICE.INTERCEPT_FROM_STAR;
        switch (ai.state) {
          case 'approach':
            // Close in from behind in a lane next to you.
            target = playerSpeed + clamp((-4 - dz) * 0.6, -6, POLICE.CATCH_UP);
            if (dz > -9) {
              ai.state = 'shadow';
              ai.timer = intercept ? 2.2 : 999;
            }
            break;
          case 'shadow':
            // Sit on your rear quarter: pressure. From ★3, overtake to get ahead of you.
            target = playerSpeed + clamp((-1.5 - dz) * 0.8, -6, 6);
            if (this.level >= POLICE.RAM_FROM_STAR && ai.cooldown <= 0 && Math.abs(dz) < 2.8
              && Math.abs(car.lane - player) === 1 && car.targetLane === car.lane) {
              ai.state = 'ramWarn';
              ai.timer = POLICE.RAM_WARN;
              ai.ramDir = player > car.lane ? 1 : -1;
              car.blinkDir = ai.ramDir;
              g.telemetry.push({ t: g.runTime, what: 'police:ramWarn' });
            } else if (intercept && ai.timer <= 0) {
              ai.state = 'overtake';
            }
            break;
          case 'ramWarn':
            target = playerSpeed + clamp(-dz * 0.8, -4, 4);
            this.alert = Math.max(this.alert, 1);
            if (ai.timer <= 0) {
              ai.state = 'ram';
              ai.timer = 0.45;
              car.kickX = ai.ramDir * 5;
              g.audio.policeRam();
            }
            break;
          case 'ram':
            target = playerSpeed;
            if (ai.timer <= 0) {
              car.blinkDir = 0;
              car.kickX = -ai.ramDir * 2.5;
              ai.state = 'shadow';
              ai.timer = 2.5;
              ai.cooldown = POLICE.RAM_COOLDOWN;
            }
            break;
          case 'overtake':
            // Pass you (in its own lane) to get ahead.
            target = Math.max(playerSpeed + 7, playerSpeed * 1.05);
            if (dz > POLICE.INTERCEPT_DZ - 6) {
              ai.state = 'block';
              ai.timer = 1.0; // signal before moving into your lane
              car.blinkDir = player === car.lane ? 0 : Math.sign(player - car.lane);
            }
            break;
          case 'block': {
            // Ahead of you, moving into your lane (signalled), then brake-checking you.
            target = playerSpeed + clamp((POLICE.INTERCEPT_DZ - dz) * 0.7, -6, 8);
            if (ai.timer <= 0 && car.lane !== player && car.targetLane === car.lane && dz > 16) {
              const dir = Math.sign(player - car.lane);
              if (this.laneFree(car, car.lane + dir)) {
                car.targetLane = car.lane + dir;
                car.blinkDir = dir;
              }
              ai.timer = 0.8;
            }
            if (car.lane === player && car.targetLane === car.lane) car.blinkDir = 0;
            if (car.lane === player && dz > 18 && dz < 40 && ai.cooldown <= 0) {
              ai.state = 'brakeWarn';
              ai.timer = POLICE.BRAKE_CHECK_WARN;
            }
            if (dz < -2) ai.state = 'approach'; // you got past it
            break;
          }
          case 'brakeWarn':
            target = playerSpeed + clamp((POLICE.INTERCEPT_DZ - dz) * 0.5, -4, 4);
            car.braking = (g.time * 6) % 1 < 0.5; // flashing brake lights: warning
            this.alert = Math.max(this.alert, 0.6);
            if (ai.timer <= 0) {
              ai.state = 'brakeCheck';
              ai.timer = POLICE.BRAKE_CHECK_TIME;
              g.telemetry.push({ t: g.runTime, what: 'police:brakeCheck' });
            }
            break;
          case 'brakeCheck':
            target = playerSpeed * 0.72;
            car.braking = true;
            if (ai.timer <= 0) {
              ai.state = 'block';
              ai.timer = 1.5;
              ai.cooldown = 5;
            }
            break;
          default:
            ai.state = 'approach';
        }
        // A unit arriving from behind comes in fast enough to reach you once (you must SEE the
        // police); once engaged it is held to its heat speed limit, so you can shake it.
        // Until the pursuit has engaged, closing units have no cap at all: they are off screen,
        // so the catch-up is invisible, and even a boosting player gets caught up with once.
        const unseen = this.chase && !this.chase.engaged && (ai.state === 'approach' || ai.state === 'shadow');
        const cap = unseen ? Infinity
          : ai.state === 'approach' ? maxV * (ai.first ? 1.35 : 1.1)
            : ai.state === 'overtake' ? maxV * 1.1
              : ai.state === 'shadow' && dz < -2.5 ? maxV * 1.1 : maxV;
        target = Math.min(target, cap);
        // Lane keeping while behind: stay next to you, never in your lane close up.
        if ((ai.state === 'approach' || ai.state === 'shadow') && car.targetLane === car.lane) {
          if (car.lane === player && dz > -14) {
            const dir = player === 0 ? 1 : player === ROAD.LANES - 1 ? -1 : (g.player.x > laneCenter(player) ? -1 : 1);
            if (this.laneFree(car, car.lane + dir)) car.targetLane = car.lane + dir;
          } else if (Math.abs(car.lane - player) > 1 && ai.cooldown <= 0) {
            const dir = Math.sign(player - car.lane);
            if (this.laneFree(car, car.lane + dir)) car.targetLane = car.lane + dir;
            ai.cooldown = 1;
          }
        }
      }
    }

    // Traffic: never through other cars. Stuck behind one → slow down and look for a gap.
    // Exception: a pursuer that hasn't reached you yet and is still well behind the camera
    // slips past slow traffic — nobody can see it, and otherwise it could be stuck back there
    // (sirens and no police) until it falls off the road. It drives normally once close.
    const hidden = car.role === 'unit' && this.chase && !this.chase.engaged && dz < POLICE.HIDDEN_DZ;
    const leader = hidden ? null : g.traffic.findLeader(car);
    if (leader) {
      const gap = leader.z - leader.length * 0.5 - (car.z + car.length * 0.5);
      if (gap < 14) {
        target = Math.min(target, leader.speed - (14 - gap) * 0.4);
        if (car.targetLane === car.lane && car.role !== 'patrol') {
          for (const dir of [-1, 1]) {
            const lane = car.lane + dir;
            if (lane === player && dz > -12 && dz < 10) continue;
            if (this.laneFree(car, lane)) {
              car.targetLane = lane;
              break;
            }
          }
        }
      }
    }
    if (target < 0) target = 0;
    const accel = target > car.speed ? 7 : 11;
    car.speed = approach(car.speed, target, accel * dt);
    if (target < car.speed - 0.5) car.braking = true;

    const dx = laneCenter(car.targetLane) - car.x;
    const step = TRAFFIC.LANE_CHANGE_SPEED * 1.5 * dt;
    car.x += (dx > step ? step : dx < -step ? -step : dx) + car.kickX * dt;
    car.kickX *= Math.max(0, 1 - 3 * dt);
    car.x = clamp(car.x, -ROAD.HALF_WIDTH + car.width / 2, ROAD.HALF_WIDTH - car.width / 2);
    if (car.targetLane !== car.lane && Math.abs(dx) < 0.05) {
      car.lane = car.targetLane;
      if (car.role === 'unit' && ai.state !== 'ramWarn') car.blinkDir = 0;
    }
    if (car.wobble > 0) car.wobble = Math.max(0, car.wobble - dt * 1.4);
    car.z += (car.speed - playerSpeed) * dt;
    car.sortZ = car.z - car.length * 0.5;
  }

  // Can this unit move into `lane` without hitting anything (including you)?
  laneFree(car, lane) {
    if (lane < 0 || lane >= ROAD.LANES) return false;
    const g = this.game;
    const dz = car.z - CAMERA.PLAYER_DEPTH;
    if (laneOf(g.player.x) === lane && Math.abs(dz) < 9) return false;
    return g.traffic.isLaneClear(lane, car.z, car.length + 6, car.length + 10);
  }

  // ---------------------------------------------------------------- patrols & roadblocks

  // Road event: one or two patrol cars cruising ahead, lights off. Blast past → spotted.
  spawnPatrol() {
    const g = this.game;
    let placed = 0;
    const count = Math.random() < 0.4 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const lane = randInt(0, ROAD.LANES - 1);
      const car = g.traffic.spawnUnit({
        typeKey: 'police', sprites: g.bank.police, width: UNIT.width, length: UNIT.length,
        lane, z: TRAFFIC.SPAWN_DEPTH + k * 45, speed: POLICE.PATROL_SPEED_KMH / 3.6, controller: this, police: true, role: 'patrol',
      });
      if (car) {
        car.lights = false;
        car.ai = {};
        placed++;
        this.patrols++;
      }
    }
    if (placed) g.telemetry.push({ t: g.runTime, what: `police:patrol:${placed}` });
    return placed > 0;
  }

  // Parked police cars across all lanes but one (always at least one open lane), announced
  // with a countdown from the spawn distance (~5 s at top speed). ★5 adds a spike strip.
  spawnRoadblock() {
    const g = this.game;
    const traffic = g.traffic;
    const z = TRAFFIC.SPAWN_DEPTH;
    const open = g.events.clearestLane();
    const lanes = [];
    for (let l = 0; l < ROAD.LANES; l++) if (l !== open) lanes.push(l);
    // Leave a second gap sometimes so the choice isn't always the same.
    if (Math.random() < 0.35) lanes.splice(randInt(0, lanes.length - 1), 1);
    const spikes = this.level >= ROADBLOCK.SPIKES_FROM_STAR && lanes.length > 1 ? lanes.splice(randInt(0, lanes.length - 1), 1)[0] : -1;
    let placed = 0;
    for (const l of lanes) if (traffic.spawnBarrier(BARRIER_ROADBLOCK, l, z, 4, open)) placed++;
    if (spikes >= 0) traffic.spawnBarrier(BARRIER_SPIKES, spikes, z + 2, 1.2, open);
    if (!placed) return;
    this.roadblock = { z, open, spikes, shown: -1 };
    this.roadblockCooldown = ROADBLOCK.COOLDOWN;
    const diagram = [];
    for (let l = 0; l < ROAD.LANES; l++) diagram.push(l === spikes ? '⋀' : lanes.includes(l) ? '✕' : '▮');
    this.roadblock.sub = `${diagram.join(' ')}`;
    g.ui.showBanner('Police', spikes >= 0 ? 'ROADBLOCK + SPIKES' : 'ROADBLOCK AHEAD', this.roadblock.sub, 'police');
    g.audio.eventWarn(false);
    g.telemetry.push({ t: g.runTime, what: `roadblock:spawn:${this.level}` });
  }

  updateRoadblock() {
    const g = this.game;
    const rb = this.roadblock;
    // The barrier vehicles carry the position (no per-frame allocation: plain loop).
    let barrier = null;
    const list = g.traffic.vehicles;
    for (let i = 0; i < list.length; i++) {
      if (list[i].barrier === BARRIER_ROADBLOCK || list[i].barrier === BARRIER_SPIKES) {
        barrier = list[i];
        break;
      }
    }
    if (!barrier) {
      this.roadblock = null;
      g.ui.hideBanner();
      return;
    }
    const remaining = barrier.z - CAMERA.PLAYER_DEPTH;
    const meters = Math.max(0, Math.round(remaining / 10) * 10);
    if (meters !== rb.shown) {
      rb.shown = meters;
      g.ui.updateBanner(`${rb.sub} · ${meters}m`, clamp(1 - remaining / TRAFFIC.SPAWN_DEPTH, 0, 1));
    }
    if (remaining < -4 && !rb.passed) {
      rb.passed = true;
      if (!rb.hit) {
        g.skills.award('ROADBLOCK RUN', ROADBLOCK.POINTS, 2, 'good');
        if (this.chase) this.chase.escape = Math.min(1, this.chase.escape + POLICE.ESCAPE_ROADBLOCK);
      }
      g.ui.hideBanner();
      this.roadblock = null;
    }
  }

  onSpikes() {
    const g = this.game;
    if (this.roadblock) this.roadblock.hit = true;
    g.player.puncture(ROADBLOCK.SPIKE_TIME, ROADBLOCK.SPIKE_GRIP, ROADBLOCK.SPIKE_SPEED);
    g.ui.feed.push('TIRES SPIKED', 0, PRIORITY.IMPORTANT, 'danger');
    g.audio.scrape();
    g.haptics.pulse('hit');
    g.camera.addTrauma(0.3);
    if (this.chase) this.chase.escape = Math.max(0, this.chase.escape - POLICE.ESCAPE_CRASH / 2);
    g.telemetry.push({ t: g.runTime, what: 'roadblock:spikes' });
  }

  // ---------------------------------------------------------------- HUD / audio feed

  updateRadar(dt) {
    let nearest = null;
    let best = Infinity;
    for (const car of this.units) {
      const dz = car.z - CAMERA.PLAYER_DEPTH;
      const d = Math.abs(dz);
      if (d < best) {
        best = d;
        nearest = car;
      }
    }
    if (nearest && nearest.z - CAMERA.PLAYER_DEPTH < -2) {
      this.radar = this.radar || { dz: 0, side: 0 };
      this.radar.dz = nearest.z - CAMERA.PLAYER_DEPTH;
      this.radar.side = Math.sign(nearest.x - this.game.player.x);
    } else {
      this.radar = null;
    }
    // Siren loudness follows the closest pursuing unit (heard before it is seen).
    // Silent once the race is over (wreck, results): no siren behind the crash.
    const live = this.game.state === 'playing';
    const target = nearest && live ? clamp(1 - best / 60, 0.15, 1) : 0;
    this.sirenLevel = live ? this.sirenLevel + (target - this.sirenLevel) * Math.min(1, dt * 3) : 0;
    this.game.audio.sirenLevel(this.sirenLevel < 0.02 ? 0 : this.sirenLevel);
    this.alert = Math.max(0, this.alert - dt * 1.5);
  }

  // Red/blue light spill at the bottom corners while a unit is right behind you.
  renderGlow(ctx, cam) {
    if (!this.radar || this.radar.dz < -30) return;
    const g = this.game;
    const proximity = clamp(1 - -this.radar.dz / 30, 0, 1);
    const on = (g.time * 4) % 1 < 0.5;
    const r = cam.height * 0.5;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = proximity * 0.5;
    ctx.drawImage(on ? g.bank.glow.red : g.bank.glow.blue, -r * 0.6, cam.height - r * 0.9, r * 2, r * 2);
    ctx.drawImage(on ? g.bank.glow.blue : g.bank.glow.red, cam.width - r * 1.4, cam.height - r * 0.9, r * 2, r * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Debug/QA helpers (dev panel only).
  // Dev panel: end the pursuit with no reward and no penalty (units give up, audio returns).
  debugCancelChase() {
    if (!this.chase) return;
    const g = this.game;
    const c = this.chase;
    this.chase = null;
    for (const car of this.units) {
      car.role = 'retreat';
      car.lights = false;
    }
    this.units.length = 0;
    this.heat = Math.min(this.heat, HEAT.CHASE_AT - 1);
    this.pendingChase = false;
    g.signals.emit('chase:end', { escaped: false, engaged: c.engaged, level: this.level, cancelled: true });
    this.refreshLevel();
    g.director.onChaseEnd(false);
  }

  debugSetHeat(stars) {
    this.setHeat(stars * HEAT.PER_STAR + (stars ? (stars === 5 ? 40 : 5) : 0));
  }
}

export { STARS };
