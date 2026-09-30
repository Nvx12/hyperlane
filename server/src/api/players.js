import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../http.js';
import { validateDisplayName } from './names.js';
import { RULES } from './rateLimit.js';

// Online accounts. No email, no password, no personal data: an account is a stable id, a public
// display name, and one or more credentials in auth_identities —
//   'device'   — a random bearer token the phone holds (returned once, stored only as SHA-256)
//   'recovery' — a one-time transfer code to sign in on another phone
// email / google / apple would be further providers on the same table (see docs/backend.md).
// Tokens and codes are high-entropy random values, so a fast hash is appropriate (nothing to
// brute-force, unlike passwords).

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SEEN_WRITE_INTERVAL = 60 * 60_000; // throttle last_seen_at writes
// Recovery codes: 20 characters from a 32-letter alphabet without look-alikes (100 bits),
// shown as XXXXX-XXXXX-XXXXX-XXXXX.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{20}$/;

export const hashToken = token => createHash('sha256').update(token).digest('hex');
export const newId = prefix => `${prefix}_${randomBytes(12).toString('base64url')}`;
const newToken = () => randomBytes(32).toString('base64url');

export function newRecoveryCode() {
  const bytes = randomBytes(20);
  let code = '';
  for (let i = 0; i < 20; i++) code += CODE_ALPHABET[bytes[i] % 32];
  return code;
}
export const normalizeCode = input => (typeof input === 'string' ? input.toUpperCase().replace(/[\s-]/g, '') : '');
export const formatCode = code => code.match(/.{5}/g).join('-');

export function createPlayerStore(db, now) {
  const q = {
    insert: db.prepare('INSERT INTO players (id, display_name, created_at, last_seen_at, name_changed_at) VALUES (?, ?, ?, ?, ?)'),
    addIdentity: db.prepare('INSERT INTO auth_identities (player_id, provider, subject, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)'),
    byIdentity: db.prepare(`SELECT p.*, a.id AS identity_id FROM auth_identities a JOIN players p ON p.id = a.player_id
      WHERE a.provider = ? AND a.subject = ?`),
    touch: db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?'),
    useIdentity: db.prepare('UPDATE auth_identities SET last_used_at = ? WHERE id = ?'),
    dropIdentity: db.prepare('DELETE FROM auth_identities WHERE id = ?'),
    dropProvider: db.prepare('DELETE FROM auth_identities WHERE player_id = ? AND provider = ?'),
    rename: db.prepare('UPDATE players SET display_name = ?, name_changed_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM players WHERE id = ?'),
    bests: db.prepare(`SELECT MAX(score) AS score, MAX(distance_m) AS distance, MAX(top_speed_kmh) AS speed,
      MAX(best_combo) AS combo, COUNT(*) AS runs FROM scores WHERE player_id = ?`),
  };

  function tx(fn) {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    // New account + its first device credential, atomically. onCreated(id) runs in the same
    // transaction (the progression rows are created there).
    create(displayName, onCreated) {
      const id = newId('p');
      const token = newToken();
      const t = now();
      tx(() => {
        q.insert.run(id, displayName, t, t, t);
        q.addIdentity.run(id, 'device', hashToken(token), t, t);
        if (onCreated) onCreated(id);
      });
      return { id, token };
    },

    // Resolves the Authorization header to a player row, or null.
    authenticate(header) {
      if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
      const token = header.slice(7).trim();
      if (!TOKEN_RE.test(token)) return null;
      const player = q.byIdentity.get('device', hashToken(token));
      if (!player) return null;
      const t = now();
      if (t - player.last_seen_at > SEEN_WRITE_INTERVAL) {
        q.touch.run(t, player.id);
        q.useIdentity.run(t, player.identity_id);
      }
      return player;
    },

    // A new one-time transfer code; replaces any previous one. Returned once, stored hashed.
    issueRecoveryCode(playerId) {
      const code = newRecoveryCode();
      tx(() => {
        q.dropProvider.run(playerId, 'recovery');
        q.addIdentity.run(playerId, 'recovery', hashToken(code), now(), null);
      });
      return formatCode(code);
    },

    // Spends a transfer code: returns { player, token } for a fresh device credential, or null.
    redeemRecoveryCode(input) {
      const code = normalizeCode(input);
      if (!CODE_RE.test(code)) return null;
      const row = q.byIdentity.get('recovery', hashToken(code));
      if (!row) return null;
      const token = newToken();
      const t = now();
      tx(() => {
        q.dropIdentity.run(row.identity_id); // one-time
        q.addIdentity.run(row.id, 'device', hashToken(token), t, t);
        q.touch.run(t, row.id);
      });
      return { player: row, token };
    },

    rename(id, name) {
      q.rename.run(name, now(), id);
    },

    remove(id) {
      q.remove.run(id);
    },

    profile(player) {
      const b = q.bests.get(player.id);
      return {
        id: player.id,
        displayName: player.display_name,
        createdAt: new Date(player.created_at).toISOString(),
        races: player.races,
        best: b.runs ? { score: b.score, distance: b.distance, speed: b.speed, combo: b.combo } : null,
      };
    },
  };
}

export function playerRoutes({ players, limiter, progress }) {
  const nameFrom = body => {
    const v = validateDisplayName(body && body.displayName);
    if (!v.ok) throw new HttpError(422, 'invalid_name', v.message);
    return v.name;
  };
  const limit = (rule, key, message) => {
    const r = limiter.take(rule, key);
    if (!r.ok) throw new HttpError(429, 'rate_limited', message, { retryAfter: r.retryAfter });
  };

  return [
    {
      method: 'POST',
      path: '/players',
      async handler(ctx) {
        // Validate first so a typo in the name doesn't burn the player's allowance.
        const name = nameFrom(await ctx.body());
        limit(RULES.createPlayer, ctx.ip, 'Too many new profiles from this network. Try again later.');
        const { id, token } = players.create(name, pid => progress.initialize(pid));
        ctx.log.info('player created', { player: id });
        const player = players.authenticate(`Bearer ${token}`);
        return { status: 201, body: { player: players.profile(player), token, ...progress.snapshot(id) } };
      },
    },
    {
      method: 'GET',
      path: '/players/me',
      auth: true,
      handler: ctx => ({ body: { player: players.profile(ctx.player) } }),
    },
    {
      method: 'PATCH',
      path: '/players/me',
      auth: true,
      async handler(ctx) {
        const name = nameFrom(await ctx.body());
        limit(RULES.rename, ctx.player.id, 'Too many name changes. Try again later.');
        players.rename(ctx.player.id, name);
        return { body: { player: players.profile({ ...ctx.player, display_name: name }) } };
      },
    },
    {
      // Right to erasure: removes the account and everything tied to it (cascades).
      method: 'DELETE',
      path: '/players/me',
      auth: true,
      handler(ctx) {
        players.remove(ctx.player.id);
        ctx.log.info('player deleted', { player: ctx.player.id });
        return { status: 204 };
      },
    },
    {
      // A one-time code to continue this account on another phone.
      method: 'POST',
      path: '/auth/recovery-code',
      auth: true,
      handler(ctx) {
        limit(RULES.recoveryCode, ctx.player.id, 'Too many transfer codes. Try again later.');
        return { status: 201, body: { code: players.issueRecoveryCode(ctx.player.id) } };
      },
    },
    {
      // Sign in on a new phone with a transfer code. Strictly rate limited per network.
      method: 'POST',
      path: '/auth/recover',
      async handler(ctx) {
        const body = await ctx.body();
        limit(RULES.recover, ctx.ip, 'Too many attempts. Try again later.');
        const r = players.redeemRecoveryCode(body && body.code);
        if (!r) throw new HttpError(401, 'invalid_code', 'That code is not valid or was already used.');
        ctx.log.info('account recovered', { player: r.player.id });
        const player = players.authenticate(`Bearer ${r.token}`);
        return { body: { player: players.profile(player), token: r.token, ...progress.snapshot(player.id) } };
      },
    },
  ];
}
