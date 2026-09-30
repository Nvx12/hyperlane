import { KEYS, readJson, writeJson, remove } from '../storage.js';
import * as E from '../progression/engine.js';

// Local save → SyncManager → API → database.
//
// The one place that moves progression between this device and the cloud. Gameplay, the garage
// and menus never talk HTTP: they change the local document at once (optimistic, works offline)
// and, for an online account, the change is queued here as an operation. The queue is flushed
// only between races — never from the frame loop — and survives app restarts.
//
// Authority and conflicts (see docs/backend.md):
//   - the server's document is canonical for an online account; the device keeps a cache
//   - the device never uploads its state, only operations; the server re-validates each one
//   - after a flush the device adopts the server's document and re-applies anything queued
//     since, so newer progress from another phone is never overwritten by a stale copy
//   - an operation the server rejects (e.g. credits spent on another phone meanwhile) simply
//     disappears from the local view; the player is told once
// Guests have no queue: their progress lives only on this device until they go online.

const MAX_QUEUE = 60; // = the server's batch limit
const SESSION_WAIT_MS = 4000;
const PULL_INTERVAL_MS = 5 * 60_000;
const COALESCE = new Set(['selectCar', 'setCosmetic']); // only the latest one matters

function newOpId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `op_${[...b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

export class SyncManager {
  constructor({ api, players, store, progression, isBusy }) {
    this.api = api;
    this.players = players;
    this.store = store;
    this.progression = progression;
    this.isBusy = isBusy || (() => false);
    this.queue = this.loadQueue();
    this.flushing = null;
    this.lastPull = 0;
    this.onChange = null; // (reason) => void — progress was replaced by the server's copy
    this.onNotice = null; // (title, text) => void — something the player should know
    this.status = 'idle'; // idle | syncing | offline | error
  }

  // ---------------------------------------------------------------- queue

  loadQueue() {
    const q = readJson(KEYS.syncQueue, []);
    const ops = Array.isArray(q) ? q.filter(op => op && typeof op.opId === 'string' && typeof op.type === 'string') : [];
    // Ranked runs queued by 1.1 (before cloud progression) become race operations.
    const legacy = readJson(KEYS.pendingRuns, []);
    if (Array.isArray(legacy) && legacy.length) {
      for (const e of legacy) if (e && typeof e.sessionId === 'string' && e.run) ops.push({ opId: newOpId(), type: 'race', sessionId: e.sessionId, run: e.run, at: e.at || Date.now() });
      remove(KEYS.pendingRuns);
    }
    return ops.slice(-MAX_QUEUE);
  }

  saveQueue() {
    if (this.queue.length) writeJson(KEYS.syncQueue, this.queue);
    else remove(KEYS.syncQueue);
  }

  get pending() {
    return this.queue.length;
  }

  // Called for every local progression change (Progression.onOperation).
  enqueue(type, payload) {
    if (!this.players.registered) return;
    if (COALESCE.has(type)) this.queue = this.queue.filter(op => !(op.type === type && op.carId === payload.carId && op.slot === payload.slot));
    this.queue.push({ opId: newOpId(), type, ...payload, at: Date.now() });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.saveQueue();
    this.flush();
  }

  // A finished run. `session` is the ranked-session promise from RaceService (or null). Resolves
  // to the online outcome shown on the results screen: local | queued | ranked | rejected.
  async submitRace(run, dateKey, session) {
    if (!this.players.registered) return { status: 'local' };
    let sessionId = null;
    if (session) sessionId = await Promise.race([session, new Promise(r => setTimeout(() => r(null), SESSION_WAIT_MS))]);
    const op = { opId: newOpId(), type: 'race', run, dateKey, at: Date.now() };
    if (sessionId) op.sessionId = sessionId;
    this.queue.push(op);
    this.saveQueue();
    const results = await this.flush();
    const r = results && results.find(x => x.opId === op.opId);
    if (!r) return { status: 'queued' };
    if (r.ok && r.ranked) return { status: 'ranked', personalBest: r.ranked.personalBest, ranks: r.ranked.ranks };
    if (r.ok) return { status: sessionId ? 'queued' : 'local' };
    return { status: 'rejected', message: r.message || 'This run could not be verified, so it was not counted online.' };
  }

  // ---------------------------------------------------------------- server exchange

  // Sends the queue (and a pending guest import first). Single-flight; resolves to the
  // per-operation results, or null when nothing could be sent.
  flush() {
    if (this.flushing) return this.flushing;
    if (!this.players.registered || this.isBusy() || navigator.onLine === false) return Promise.resolve(null);
    if (!this.queue.length && !this.players.needsImport) return Promise.resolve([]);
    this.flushing = this.exchange().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async exchange() {
    this.status = 'syncing';
    if (this.players.needsImport && !(await this.importGuest())) return null;
    if (!this.queue.length) {
      this.status = 'idle';
      return [];
    }
    const sent = this.queue.slice(0, MAX_QUEUE);
    const ops = sent.map(({ at, ...op }) => op);
    const r = await this.api.request('POST', '/sync', { token: this.players.token, body: { ops }, timeout: 12000, retries: 1 });
    if (!r.ok) return this.failed(r);
    const sentIds = new Set(sent.map(op => op.opId));
    this.queue = this.queue.filter(op => !sentIds.has(op.opId));
    this.saveQueue();
    const refused = r.data.results.filter(x => !x.ok && !x.duplicate && x.code !== 'too_short');
    this.adopt(r.data.progress, r.data.revision, 'sync');
    if (refused.some(x => x.code !== 'implausible' && x.code !== 'offline_budget') && this.onNotice) {
      this.onNotice('Cloud sync', 'Some changes from this phone were not accepted (your account changed elsewhere).');
    }
    this.status = 'idle';
    return r.data.results;
  }

  // Guest → online: the local progress is offered once; the server clamps it (GUEST_IMPORT).
  async importGuest() {
    const r = await this.api.request('POST', '/progress/import', { token: this.players.token, body: { progress: this.store.progress }, timeout: 12000 });
    if (r.ok || r.status === 409) {
      this.players.setNeedsImport(false);
      if (r.ok) {
        this.adopt(r.data.progress, r.data.revision, 'import');
        if (r.data.clamped.length && this.onNotice) this.onNotice('Online profile', 'Your progress was moved online with a starting limit on level, credits and cars.');
      }
      return true;
    }
    this.failed(r);
    return false;
  }

  // Pulls the cloud copy (other phones may have progressed). Only when nothing is queued —
  // queued operations must reach the server first.
  async pull(force = false) {
    if (!this.players.registered || this.isBusy() || this.queue.length || this.players.needsImport || navigator.onLine === false) return false;
    if (!force && Date.now() - this.lastPull < PULL_INTERVAL_MS) return false;
    this.lastPull = Date.now();
    const r = await this.api.request('GET', '/progress', { token: this.players.token, timeout: 8000 });
    if (!r.ok) {
      this.failed(r);
      return false;
    }
    if (r.data.revision === this.players.revision) return false;
    this.adopt(r.data.progress, r.data.revision, 'pull');
    return true;
  }

  // Server document becomes the local one; operations queued meanwhile are re-applied on top.
  adopt(doc, revision, reason) {
    if (this.isBusy()) return; // never swap progress under a running race; the next flush will
    this.store.replaceProgress(doc);
    const state = this.store.progress;
    for (const op of this.queue) {
      if (op.type === 'race') E.settleRun(state, op.run, { dateKey: op.dateKey, now: op.at });
      else if (op.type === 'purchaseCar') E.purchaseCar(state, op.carId);
      else if (op.type === 'buyUpgrade') E.buyUpgrade(state, op.carId, op.key);
      else if (op.type === 'selectCar') E.selectCar(state, op.carId);
      else if (op.type === 'buyCosmetic') E.buyCosmetic(state, op.slot, op.id);
      else if (op.type === 'setCosmetic') E.setCosmetic(state, op.carId, op.slot, op.id);
    }
    this.store.save();
    this.players.setRevision(revision);
    if (this.onChange) this.onChange(reason);
  }

  failed(r) {
    if (r.status === 401) {
      // The account no longer exists (deleted elsewhere / server reset): keep playing as a guest.
      this.players.forget();
      this.clear();
      if (this.onNotice) this.onNotice('Online profile', 'Your online profile was not found. You are playing as a guest.');
    }
    this.status = r.offline ? 'offline' : 'error';
    return null;
  }

  clear() {
    this.queue = [];
    this.saveQueue();
  }
}
