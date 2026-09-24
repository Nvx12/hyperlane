import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../http.js';
import { validateDisplayName } from './names.js';
import { RULES } from './rateLimit.js';

// Anonymous player identity: no email, no password, no personal data. Creating a profile
// returns a random bearer token once; only its SHA-256 is stored, so a database leak does
// not let anyone post scores as another player. Tokens are 256-bit random, so a fast hash
// is appropriate (nothing to brute-force, unlike passwords).

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SEEN_WRITE_INTERVAL = 60 * 60_000; // throttle last_seen_at writes

export const hashToken = token => createHash('sha256').update(token).digest('hex');
export const newId = prefix => `${prefix}_${randomBytes(12).toString('base64url')}`;

export function createPlayerStore(db, now) {
  const q = {
    insert: db.prepare('INSERT INTO players (id, display_name, token_hash, created_at, last_seen_at, name_changed_at) VALUES (?, ?, ?, ?, ?, ?)'),
    byToken: db.prepare('SELECT * FROM players WHERE token_hash = ?'),
    touch: db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?'),
    rename: db.prepare('UPDATE players SET display_name = ?, name_changed_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM players WHERE id = ?'),
    bests: db.prepare(`SELECT MAX(score) AS score, MAX(distance_m) AS distance, MAX(top_speed_kmh) AS speed,
      MAX(best_combo) AS combo, COUNT(*) AS runs FROM scores WHERE player_id = ?`),
  };

  return {
    create(displayName) {
      const id = newId('p');
      const token = randomBytes(32).toString('base64url');
      const t = now();
      q.insert.run(id, displayName, hashToken(token), t, t, t);
      return { id, token };
    },

    // Resolves the Authorization header to a player row, or null.
    authenticate(header) {
      if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
      const token = header.slice(7).trim();
      if (!TOKEN_RE.test(token)) return null;
      const player = q.byToken.get(hashToken(token));
      if (!player) return null;
      const t = now();
      if (t - player.last_seen_at > SEEN_WRITE_INTERVAL) q.touch.run(t, player.id);
      return player;
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

export function playerRoutes({ players, limiter }) {
  const nameFrom = body => {
    const v = validateDisplayName(body && body.displayName);
    if (!v.ok) throw new HttpError(422, 'invalid_name', v.message);
    return v.name;
  };

  return [
    {
      method: 'POST',
      path: '/players',
      async handler(ctx) {
        // Validate first so a typo in the name doesn't burn the player's allowance.
        const name = nameFrom(await ctx.body());
        const limit = limiter.take(RULES.createPlayer, ctx.ip);
        if (!limit.ok) throw new HttpError(429, 'rate_limited', 'Too many new profiles from this network. Try again later.', { retryAfter: limit.retryAfter });
        const { id, token } = players.create(name);
        ctx.log.info('player created', { player: id });
        const player = players.authenticate(`Bearer ${token}`);
        return { status: 201, body: { player: players.profile(player), token } };
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
        const limit = limiter.take(RULES.rename, ctx.player.id);
        if (!limit.ok) throw new HttpError(429, 'rate_limited', 'Too many name changes. Try again later.', { retryAfter: limit.retryAfter });
        players.rename(ctx.player.id, name);
        return { body: { player: players.profile({ ...ctx.player, display_name: name }) } };
      },
    },
    {
      // Right to erasure: removes the profile and every score/session tied to it.
      method: 'DELETE',
      path: '/players/me',
      auth: true,
      handler(ctx) {
        players.remove(ctx.player.id);
        ctx.log.info('player deleted', { player: ctx.player.id });
        return { status: 204 };
      },
    },
  ];
}
