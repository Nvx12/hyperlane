// Optional online account. Stored separately from the save (see storage.js KEYS.account):
// public id, display name, the bearer token the server issued (never shown, never put in share
// links or URLs), and sync bookkeeping. No email, no password, no personal data.
import { validateDisplayName } from '../names.js';
import { KEYS, readJson, writeJson, remove } from '../storage.js';

// Same rules as the server (shared module); the server remains the authority.
export const checkName = input => validateDisplayName(String(input || ''));

function load() {
  const v = readJson(KEYS.account);
  if (v && typeof v.id === 'string' && typeof v.token === 'string' && typeof v.name === 'string') {
    // Accounts from 1.1 predate cloud progression: offer their local progress once.
    if (typeof v.needsImport !== 'boolean') v.needsImport = true;
    return v;
  }
  return null; // missing, corrupt or storage unavailable: act as signed out
}

export class PlayerService {
  constructor(api) {
    this.api = api;
    this.identity = load();
    this.profile = null; // last server profile (bests), fetched on demand
    this.busy = false;
  }

  get registered() {
    return Boolean(this.identity);
  }

  get name() {
    return this.identity ? this.identity.name : '';
  }

  get token() {
    return this.identity ? this.identity.token : null;
  }

  get needsImport() {
    return Boolean(this.identity && this.identity.needsImport);
  }

  get revision() {
    return this.identity ? this.identity.revision || 0 : 0;
  }

  // Private mode / blocked storage: the account lasts for this session only.
  persist() {
    if (this.identity) writeJson(KEYS.account, this.identity);
    else remove(KEYS.account);
  }

  setNeedsImport(value) {
    if (!this.identity) return;
    this.identity.needsImport = value;
    this.persist();
  }

  setRevision(revision) {
    if (!this.identity) return;
    this.identity.revision = revision;
    this.persist();
  }

  // All methods resolve to { ok, message, ... }.

  // Guest → online account. The guest's progress is imported by the sync layer right after.
  async create(displayName) {
    const check = checkName(displayName);
    if (!check.ok) return check;
    return this.guard(async () => {
      const r = await this.api.request('POST', '/players', { body: { displayName: check.name } });
      if (!r.ok) return { ok: false, offline: r.offline, message: r.error.message };
      this.identity = { id: r.data.player.id, name: r.data.player.displayName, token: r.data.token, needsImport: true, revision: r.data.revision };
      this.profile = r.data.player;
      this.persist();
      return { ok: true, message: '' };
    });
  }

  // Sign in on this phone with a transfer code from another one. Resolves with the account's
  // cloud progress, which replaces this phone's (the caller confirms that with the player).
  async recover(code) {
    return this.guard(async () => {
      const r = await this.api.request('POST', '/auth/recover', { body: { code: String(code || '') } });
      if (!r.ok) return { ok: false, offline: r.offline, message: r.status === 401 ? 'That code is not valid or was already used.' : r.error.message };
      this.identity = { id: r.data.player.id, name: r.data.player.displayName, token: r.data.token, needsImport: false, revision: r.data.revision };
      this.profile = r.data.player;
      this.persist();
      return { ok: true, message: '', progress: r.data.progress, revision: r.data.revision };
    });
  }

  // A one-time code to continue this account on another phone.
  async transferCode() {
    if (!this.identity) return { ok: false, message: '' };
    return this.guard(async () => {
      const r = await this.api.request('POST', '/auth/recovery-code', { token: this.token });
      if (!r.ok) return this.failed(r);
      return { ok: true, message: '', code: r.data.code };
    });
  }

  async rename(displayName) {
    const check = checkName(displayName);
    if (!check.ok || !this.identity) return check;
    return this.guard(async () => {
      const r = await this.api.request('PATCH', '/players/me', { body: { displayName: check.name }, token: this.token });
      if (!r.ok) return this.failed(r);
      this.identity.name = r.data.player.displayName;
      this.profile = r.data.player;
      this.persist();
      return { ok: true, message: '' };
    });
  }

  async refresh() {
    if (!this.identity) return { ok: false, message: '' };
    const r = await this.api.request('GET', '/players/me', { token: this.token });
    if (!r.ok) return this.failed(r);
    this.profile = r.data.player;
    if (this.identity.name !== r.data.player.displayName) {
      this.identity.name = r.data.player.displayName;
      this.persist();
    }
    return { ok: true, message: '' };
  }

  async remove() {
    if (!this.identity) return { ok: true, message: '' };
    return this.guard(async () => {
      const r = await this.api.request('DELETE', '/players/me', { token: this.token });
      if (!r.ok && r.status !== 401) return this.failed(r);
      this.forget();
      return { ok: true, message: '' };
    });
  }

  forget() {
    this.identity = null;
    this.profile = null;
    this.persist();
  }

  // The server no longer knows this token (profile deleted or database reset).
  failed(r) {
    if (r.status === 401) {
      this.forget();
      return { ok: false, message: 'Your online profile was not found. You are playing as a guest.' };
    }
    return { ok: false, offline: r.offline, message: r.error.message };
  }

  async guard(fn) {
    if (this.busy) return { ok: false, message: 'Please wait…' };
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
}
