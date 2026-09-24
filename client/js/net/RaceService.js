import { GAME_VERSION } from '../version.js';

// Ranked runs. A session is requested in the background when a race starts (never blocking
// the countdown) and the result is submitted when the run is settled. If the network drops at
// the end of a run, the submission is queued and retried from the menus — the server treats a
// repeated submission of the same run as the same answer.
const QUEUE_KEY = 'nightvector.pendingRuns';
const QUEUE_MAX = 5;
const QUEUE_TTL_MS = 2.5 * 60 * 60_000; // server sessions expire after 3 h

function loadQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(q) ? q.filter(e => e && typeof e.sessionId === 'string' && e.run && Date.now() - e.at < QUEUE_TTL_MS) : [];
  } catch {
    return [];
  }
}

export class RaceService {
  constructor(api, players) {
    this.api = api;
    this.players = players;
    this.session = null; // Promise<string | null>
    this.queue = loadQueue();
    this.flushing = false;
  }

  saveQueue() {
    try {
      if (this.queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
      else localStorage.removeItem(QUEUE_KEY);
    } catch {
      /* storage unavailable: pending runs are kept for this session only */
    }
  }

  begin(carId, envId) {
    this.session = null;
    if (!this.players.registered || navigator.onLine === false) return;
    this.session = this.api
      .request('POST', '/races', { token: this.players.token, body: { carId, envId, clientVersion: GAME_VERSION }, timeout: 5000 })
      .then(r => {
        if (r.status === 401) this.players.forget();
        return r.ok ? r.data.sessionId : null;
      });
  }

  // Resolves to one of:
  //   { status: 'local' }                      — not signed in / no session (offline at start)
  //   { status: 'ranked', personalBest, ranks }
  //   { status: 'rejected', message }
  //   { status: 'queued' }                     — network failed; will retry later
  async submit(run) {
    const pending = this.session;
    this.session = null;
    const sessionId = pending ? await pending : null;
    if (!sessionId) return { status: 'local' };
    return this.send(sessionId, run, true);
  }

  async send(sessionId, run, enqueueOnFailure) {
    const r = await this.api.request('POST', `/races/${encodeURIComponent(sessionId)}/finish`, {
      token: this.players.token, body: run, retries: 2, timeout: 8000,
    });
    if (r.ok) {
      return r.data.accepted
        ? { status: 'ranked', personalBest: r.data.personalBest, ranks: r.data.ranks }
        : { status: 'rejected', message: r.data.message };
    }
    if (r.offline || r.status >= 500) {
      if (enqueueOnFailure) {
        this.queue.push({ sessionId, run, at: Date.now() });
        if (this.queue.length > QUEUE_MAX) this.queue.shift();
        this.saveQueue();
      }
      return { status: 'queued' };
    }
    if (r.status === 401) this.players.forget();
    return { status: 'rejected', message: r.error.message };
  }

  // Called from menus. Resolves to the number of runs that got ranked.
  async flush() {
    if (this.flushing || !this.queue.length || !this.players.registered || navigator.onLine === false) return 0;
    this.flushing = true;
    let ranked = 0;
    try {
      for (const entry of [...this.queue]) {
        const res = await this.send(entry.sessionId, entry.run, false);
        if (res.status === 'queued') break; // still unreachable: try again later
        this.queue = this.queue.filter(e => e !== entry);
        if (res.status === 'ranked') ranked++;
      }
      this.saveQueue();
    } finally {
      this.flushing = false;
    }
    return ranked;
  }
}
