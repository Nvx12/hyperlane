import { ENV } from '../env.js';
import { API_VERSION } from '../version.js';

// Thin fetch wrapper for the optional backend. Rules:
//  - never throws: every call resolves to { ok, status, data, error, offline }
//  - every request has a timeout; only idempotent requests are retried, a bounded number of times
//  - never called from the render loop (callers are menus, run end, and batched analytics)
const DEFAULT_TIMEOUT = 6000;
const RETRY_BASE_MS = 500;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class ApiClient {
  constructor(base = `${ENV.apiBase}/v${API_VERSION}`) {
    this.base = base;
    this.reachable = true; // last known server reachability (not just navigator.onLine)
    this.listeners = new Set();
  }

  get online() {
    return navigator.onLine !== false && this.reachable;
  }

  onStatus(fn) {
    this.listeners.add(fn);
  }

  setReachable(value) {
    if (this.reachable === value) return;
    this.reachable = value;
    for (const fn of this.listeners) fn(value);
  }

  // retries: extra attempts after the first, for network errors / 5xx / 429 only.
  async request(method, path, { body, token, timeout = DEFAULT_TIMEOUT, retries = method === 'GET' ? 1 : 0, keepalive = false } = {}) {
    if (navigator.onLine === false) return { ok: false, status: 0, data: null, error: { code: 'offline', message: 'You are offline.' }, offline: true };
    let attempt = 0;
    for (;;) {
      const result = await this.once(method, path, body, token, timeout, keepalive);
      const retryable = result.status === 0 || result.status >= 500 || result.status === 429;
      if (result.ok || !retryable || attempt >= retries) return result;
      const retryAfter = Number(result.retryAfterSec) || 0;
      await sleep(Math.max(retryAfter * 1000, RETRY_BASE_MS * 2 ** attempt));
      attempt++;
    }
  }

  async once(method, path, body, token, timeout, keepalive) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        keepalive,
      });
      this.setReachable(true);
      let data = null;
      if (res.status !== 204) {
        try {
          data = await res.json();
        } catch {
          data = null;
        }
      }
      if (res.ok) return { ok: true, status: res.status, data, error: null, offline: false };
      const error = (data && data.error) || { code: 'http_error', message: `Server error (${res.status}).` };
      return { ok: false, status: res.status, data: null, error, offline: false, retryAfterSec: res.headers.get('Retry-After') };
    } catch (err) {
      // Network failure or timeout: the game carries on in local mode.
      this.setReachable(false);
      const timedOut = err && err.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        data: null,
        error: { code: timedOut ? 'timeout' : 'network', message: timedOut ? 'The server took too long to answer.' : 'Could not reach the server.' },
        offline: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
