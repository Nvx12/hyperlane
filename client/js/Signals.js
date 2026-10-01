// A minimal synchronous event bus. Gameplay systems announce what happened ('chase:engaged',
// 'chase:end', 'heat:level'); listeners (audio, later native hooks) react, so systems never reach
// into each other. Listeners are added once at startup — nothing is added per run.
export class Signals {
  constructor() {
    this.map = new Map();
  }

  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const list = this.map.get(name);
    if (list) this.map.set(name, list.filter(f => f !== fn));
  }

  emit(name, detail) {
    const list = this.map.get(name);
    if (list) for (const fn of list) fn(detail);
  }

  count() {
    let n = 0;
    for (const list of this.map.values()) n += list.length;
    return n;
  }
}
