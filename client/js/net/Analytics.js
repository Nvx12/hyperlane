import { GAME_VERSION } from '../version.js';

// Batched, privacy-conscious analytics. track() only pushes to an in-memory array (safe to call
// from game code); network happens on a 30 s timer, when the batch fills, or via sendBeacon
// when the page is hidden. Nothing is sent when:
//   - the player turned "Anonymous usage stats" off in Settings,
//   - the browser sends Do Not Track or Global Privacy Control,
//   - the server reports analytics disabled.
// Events carry coarse numbers only — never names, ids, tokens or free text.
const CID_KEY = 'nightvector.cid';
const FLUSH_MS = 30_000;
const BATCH_MAX = 20;
const QUEUE_MAX = 100;

function clientId() {
  try {
    let id = localStorage.getItem(CID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,32}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem(CID_KEY, id);
    }
    return id;
  } catch {
    return null; // storage blocked: don't track at all
  }
}

export const browserOptedOut = () => navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;

export class Analytics {
  constructor(api, getSettings) {
    this.api = api;
    this.getSettings = getSettings; // save data can be replaced (reset), so read it live
    this.queue = [];
    this.cid = null;
    this.timer = null;
    this.serverEnabled = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
    window.addEventListener('pagehide', () => this.flush(true));
  }

  get enabled() {
    return this.getSettings().analytics !== false && !browserOptedOut() && this.serverEnabled;
  }

  setServerEnabled(value) {
    this.serverEnabled = value !== false;
    if (!this.serverEnabled) this.queue.length = 0;
  }

  track(name, props) {
    if (!this.enabled) return;
    if (this.queue.length >= QUEUE_MAX) this.queue.shift();
    this.queue.push(props ? { name, props } : { name });
    if (this.queue.length >= BATCH_MAX) this.flush(false);
    else if (!this.timer) this.timer = setTimeout(() => this.flush(false), FLUSH_MS);
  }

  // Opting out also discards anything not yet sent.
  optOutChanged() {
    if (!this.enabled) this.queue.length = 0;
  }

  flush(unloading) {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.queue.length || !this.enabled || navigator.onLine === false) return;
    if (!this.cid) this.cid = clientId();
    if (!this.cid) {
      this.queue.length = 0;
      return;
    }
    const batch = this.queue.splice(0, BATCH_MAX);
    const body = { clientId: this.cid, appVersion: GAME_VERSION, events: batch };
    if (unloading && navigator.sendBeacon) {
      // text/plain keeps it a "simple" request (no CORS preflight) — the server accepts it.
      navigator.sendBeacon(`${this.api.base}/events`, JSON.stringify(body));
      return;
    }
    // Fire and forget: analytics never retries, never blocks, never surfaces errors.
    // (No keepalive here: unloads go through sendBeacon above; keepalive fetches show up as
    // "aborted" in DevTools once Chromium hands them to the browser process.)
    this.api.request('POST', '/events', { body, retries: 0, timeout: 5000 });
    if (this.queue.length) this.timer = setTimeout(() => this.flush(false), FLUSH_MS);
  }
}
