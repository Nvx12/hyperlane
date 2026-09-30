import { OBJECTIVES, MISSION_TEMPLATES, MISSION_REWARD, DAILY_GOALS, DAILY_REWARD } from './data/missions.js';
import { ACHIEVEMENTS } from './data/achievements.js';
import { CARS } from './balance.js';
import { createRng, hashString, dateKey } from './Rng.js';

const EMPTY_RUN = Object.freeze({
  nearMisses: 0, overtakes: 0, perfectOvertakes: 0, chicanes: 0, insaneMisses: 0, boostTime: 0, policeEscapes: 0,
  distance: 0, bestCleanDistance: 0, topSpeed: 0, highSpeedTime: 0, bestMultiplier: 1, score: 0, legendPasses: 0,
});

export const objectiveText = (type, target) => OBJECTIVES[type].text(target);

// Daily challenge source. Local and deterministic: the same date always yields the same
// challenge. A backend provider only needs to implement getChallenge(dateKey) with the same
// return shape (and could verify completions server-side).
export class LocalDailyProvider {
  constructor() {
    this.source = 'local';
    this.cache = new Map();
  }

  getChallenge(key) {
    let challenge = this.cache.get(key);
    if (challenge) return challenge;
    const rng = createRng(hashString(`nightvector-daily-${key}`));
    const pool = DAILY_GOALS.slice();
    const goals = [];
    while (goals.length < 3 && pool.length) {
      const def = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
      const target = def.values ? rng.pick(def.values) : rng.int(def.range[0], def.range[1]);
      goals.push({ type: def.type, target, text: objectiveText(def.type, target) });
    }
    challenge = { key, source: this.source, goals, reward: DAILY_REWARD };
    this.cache.set(key, challenge);
    return challenge;
  }
}

// Missions, the daily challenge and achievements. Live checks only notify; rewards and stored
// progress are applied once, when a run is settled.
export class Goals {
  constructor(store, progression, provider = new LocalDailyProvider()) {
    this.store = store;
    this.progression = progression;
    this.provider = provider;
    this.notified = new Set();
  }

  get save() {
    return this.store.data;
  }

  resetRun() {
    this.notified.clear();
  }

  // ---------------------------------------------------------------- missions

  ensureMissions() {
    const m = this.save.missions;
    const level = this.save.level;
    m.active = m.active.filter(x => x && OBJECTIVES[x.type]);
    while (m.active.length < MISSION_REWARD.ACTIVE) {
      const used = new Set(m.active.map(x => x.type));
      const options = MISSION_TEMPLATES.filter(t => !used.has(t.type) && (t.minLevel || 1) <= level);
      const t = options[Math.floor(Math.random() * options.length)];
      m.seq++;
      m.active.push({
        id: m.seq,
        type: t.type,
        target: t.target(level),
        progress: 0,
        credits: MISSION_REWARD.CREDITS(level),
        xp: MISSION_REWARD.XP(level),
      });
    }
    return m.active;
  }

  missionValue(m, run) {
    const obj = OBJECTIVES[m.type];
    const v = obj.stat(run || EMPTY_RUN);
    return obj.single ? Math.max(m.progress, v) : m.progress + v;
  }

  // ---------------------------------------------------------------- daily

  daily() {
    const key = dateKey();
    const d = this.save.daily;
    if (d.date !== key) {
      d.date = key;
      d.progress = {};
      d.claimed = false;
    }
    return this.provider.getChallenge(key);
  }

  dailyValue(goal, run) {
    const obj = OBJECTIVES[goal.type];
    const stored = this.save.daily.progress[goal.type] || 0;
    const v = obj.stat(run || EMPTY_RUN);
    return obj.single ? Math.max(stored, v) : stored + v;
  }

  // ---------------------------------------------------------------- achievements

  achievementContext(run) {
    const s = this.save;
    const st = s.stats;
    const r = s.records;
    const x = run || EMPTY_RUN;
    let maxed = 0;
    for (const id of Object.keys(s.cars)) {
      const up = s.cars[id].upgrades || {};
      for (const k in up) if (up[k] >= 5) maxed = 1;
    }
    return {
      life: {
        races: st.races,
        nearMisses: st.nearMisses + x.nearMisses,
        insaneMisses: st.insaneMisses + x.insaneMisses,
        distance: st.distance + x.distance,
        boostTime: st.boostTime + x.boostTime,
        policeEscapes: st.policeEscapes + x.policeEscapes,
        perfectOvertakes: st.perfectOvertakes + x.perfectOvertakes,
        chicanes: st.chicanes + x.chicanes,
        legendPasses: st.legendPasses + x.legendPasses,
        creditsEarned: st.creditsEarned,
        dailiesCompleted: st.dailiesCompleted,
      },
      best: {
        topSpeed: Math.max(r.topSpeed, x.topSpeed),
        distance: Math.max(r.distance, x.distance),
        cleanDistance: Math.max(r.cleanDistance, x.bestCleanDistance),
        combo: Math.max(r.combo, x.bestMultiplier),
      },
      maxedUpgrades: maxed,
      standardCars: CARS.filter(c => !c.secret && s.unlockedCars.includes(c.id)).length,
      phantom: s.unlockedCars.includes('phantom') ? 1 : 0,
    };
  }

  achievementList() {
    const ctx = this.achievementContext(null);
    return ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked: Boolean(this.save.achievements[a.id]),
      progress: Math.min(1, a.value(ctx) / a.target),
    }));
  }

  // ---------------------------------------------------------------- live + settle

  // Newly completed goals during a run, for non-blocking toasts. Each fires once per run.
  checkLive(run) {
    const out = [];
    for (const m of this.save.missions.active) {
      const key = `m${m.id}`;
      if (!this.notified.has(key) && this.missionValue(m, run) >= m.target) {
        this.notified.add(key);
        out.push(['mission', 'Mission complete', objectiveText(m.type, m.target)]);
      }
    }
    const daily = this.daily();
    if (!this.save.daily.claimed && !this.notified.has('daily') && daily.goals.every(g => this.dailyValue(g, run) >= g.target)) {
      this.notified.add('daily');
      out.push(['unlock', 'Daily challenge complete', `+${daily.reward.credits} credits at the finish`]);
    }
    const ctx = this.achievementContext(run);
    for (const a of ACHIEVEMENTS) {
      if (this.save.achievements[a.id] || this.notified.has(a.id)) continue;
      if (a.value(ctx) >= a.target) {
        this.notified.add(a.id);
        out.push(['achievement', 'Achievement unlocked', a.name]);
      }
    }
    return out;
  }

  // Applies a finished run (lifetime stats must already include it). Returns rewards and events.
  settle(run) {
    const s = this.save;
    const credits = [];
    const events = [];
    let xp = 0;

    let missionCredits = 0;
    const remaining = [];
    for (const m of s.missions.active) {
      const done = this.missionValue(m, run) >= m.target;
      if (!OBJECTIVES[m.type].single) m.progress = Math.min(m.target, m.progress + OBJECTIVES[m.type].stat(run));
      if (done) {
        missionCredits += m.credits;
        xp += m.xp;
        s.stats.missionsCompleted++;
        events.push(['mission', `MISSION COMPLETE · ${objectiveText(m.type, m.target)}`]);
      } else {
        remaining.push(m);
      }
    }
    s.missions.active = remaining;
    this.ensureMissions();
    if (missionCredits) credits.push(['Missions', missionCredits]);

    const daily = this.daily();
    for (const g of daily.goals) s.daily.progress[g.type] = this.dailyValue(g, run);
    if (!s.daily.claimed && daily.goals.every(g => (s.daily.progress[g.type] || 0) >= g.target)) {
      s.daily.claimed = true;
      s.stats.dailiesCompleted++;
      credits.push(['Daily challenge', daily.reward.credits]);
      xp += daily.reward.xp;
      events.push(['unlock', 'DAILY CHALLENGE COMPLETE']);
    }

    let achCredits = 0;
    const ctx = this.achievementContext(null);
    for (const a of ACHIEVEMENTS) {
      if (s.achievements[a.id] || a.value(ctx) < a.target) continue;
      s.achievements[a.id] = Date.now();
      achCredits += a.reward;
      xp += Math.round(a.reward / 2);
      events.push(['achievement', `ACHIEVEMENT · ${a.name}`]);
    }
    if (achCredits) credits.push(['Achievements', achCredits]);
    return { credits, xp, events };
  }

  trackerItems(run) {
    return this.save.missions.active.map(m => {
      const obj = OBJECTIVES[m.type];
      const v = Math.min(m.target, this.missionValue(m, run));
      const shown = obj.unit === 'km' ? v.toFixed(1) : Math.floor(v);
      return { text: objectiveText(m.type, m.target), short: obj.short, progress: `${shown}/${m.target}`, ratio: v / m.target, done: v >= m.target };
    });
  }

  // The single in-race mission indicator: the unfinished mission closest to done. Completions
  // are announced in the bonus feed; once everything is done the chip shows a tick.
  chipItem(run) {
    let best = null;
    for (const item of this.trackerItems(run)) {
      if (!best || (best.done && !item.done) || (item.done === best.done && item.ratio > best.ratio)) best = item;
    }
    return best;
  }
}
