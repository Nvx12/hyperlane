// Optional online identity. Stored separately from the save so "reset progress" doesn't
// orphan a leaderboard profile. Holds only: public id, display name, and the bearer token
// the server issued (never shown to the player, never put in share links or URLs).
const KEY = 'nightvector.identity';

export const NAME_MIN = 3;
export const NAME_MAX = 16;

// Mirrors the server rules for instant feedback; the server remains the authority.
export function checkName(input) {
  const name = String(input || '').trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN || name.length > NAME_MAX) return { ok: false, name, message: `Name must be ${NAME_MIN}–${NAME_MAX} characters.` };
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) return { ok: false, name, message: 'Use letters, numbers, spaces, - and _ only.' };
  if (!/[A-Za-z0-9]/.test(name)) return { ok: false, name, message: 'Name needs at least one letter or number.' };
  return { ok: true, name, message: '' };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v.id === 'string' && typeof v.token === 'string' && typeof v.name === 'string') return v;
  } catch {
    /* storage unavailable or corrupt: act as signed out */
  }
  return null;
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

  persist() {
    try {
      if (this.identity) localStorage.setItem(KEY, JSON.stringify(this.identity));
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode: identity lasts for this session only */
    }
  }

  // All methods resolve to { ok, message }.
  async create(displayName) {
    const check = checkName(displayName);
    if (!check.ok) return check;
    return this.guard(async () => {
      const r = await this.api.request('POST', '/players', { body: { displayName: check.name } });
      if (!r.ok) return { ok: false, message: r.error.message };
      this.identity = { id: r.data.player.id, name: r.data.player.displayName, token: r.data.token };
      this.profile = r.data.player;
      this.persist();
      return { ok: true, message: '' };
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
      return { ok: false, message: 'Your online profile was not found. Create a new one to rejoin the leaderboard.' };
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
