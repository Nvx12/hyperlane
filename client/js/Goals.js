import { OBJECTIVES } from './data/missions.js';
import { dateKey } from './Rng.js';
import {
  ensureMissions, missionValue, syncDaily, dailyValue, dailyReward, achievementList, liveCompletions, objectiveText,
} from './progression/engine.js';

export { objectiveText };

// Missions, daily challenge and achievements as the UI and the race see them. The rules
// (and all rewards) live in progression/engine.js; this adds per-run live notifications and
// display helpers. Progress is stored and paid out only when a run is settled.
export class Goals {
  constructor(progression) {
    this.progression = progression;
    this.notified = new Set();
  }

  get state() {
    return this.progression.state;
  }

  resetRun() {
    this.notified.clear();
  }

  missions() {
    return ensureMissions(this.state);
  }

  missionValue(m, run) {
    return missionValue(m, run);
  }

  // Today's challenge with its reward at the player's level.
  daily() {
    const challenge = syncDaily(this.state, dateKey());
    return { ...challenge, reward: dailyReward(this.state.level) };
  }

  dailyValue(goal, run) {
    return dailyValue(this.state, goal, run);
  }

  achievementList() {
    return achievementList(this.state);
  }

  // Newly completed goals during a run, for compact feed lines. Each fires once per run.
  checkLive(run) {
    return liveCompletions(this.state, run, dateKey(), this.notified);
  }

  trackerItems(run) {
    return this.state.missions.active.map(m => {
      const obj = OBJECTIVES[m.type];
      const v = Math.min(m.target, missionValue(m, run));
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
