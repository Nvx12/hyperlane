import { ENVIRONMENTS } from './data/environments.js';
import { validateDisplayName as checkName } from './names.js';
import { GAME_NAME } from './version.js';

// Sharing and challenge links. A challenge link carries only what's needed to show
// "NAME scored N on ROUTE — beat it": public display name, score, distance, route. Never the
// player id or token. Links aren't signed: a tampered link can only make a friendly target
// harder or easier for whoever opens it, so every field is strictly validated on read.
const ENV_IDS = new Set(ENVIRONMENTS.map(e => e.id));
const MAX_PARAM = 240;

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

export function encodeChallenge({ name, score, distance, env }) {
  const payload = { v: 1, s: Math.floor(score), d: Math.floor(distance), e: env };
  const n = checkName(name);
  if (n.ok) payload.n = n.name;
  return toBase64Url(JSON.stringify(payload));
}

// Returns a validated challenge or null. Never throws.
export function decodeChallenge(param) {
  if (typeof param !== 'string' || !param || param.length > MAX_PARAM || !/^[A-Za-z0-9_-]+$/.test(param)) return null;
  try {
    const p = JSON.parse(fromBase64Url(param));
    if (!p || p.v !== 1) return null;
    if (!Number.isInteger(p.s) || p.s < 1 || p.s > 1e9) return null;
    if (!Number.isInteger(p.d) || p.d < 0 || p.d > 2e6) return null;
    if (!ENV_IDS.has(p.e)) return null;
    const n = p.n === undefined ? null : checkName(p.n);
    if (n && !n.ok) return null;
    return { name: n ? n.name : 'A rival', score: p.s, distance: p.d, env: p.e };
  } catch {
    return null;
  }
}

// Reads ?c= from the address bar once, then removes it so a reload doesn't re-trigger it.
export function takeChallengeFromUrl() {
  const url = new URL(location.href);
  const param = url.searchParams.get('c');
  if (param === null) return null;
  url.searchParams.delete('c');
  try {
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
  return decodeChallenge(param);
}

export function challengeUrl(challenge) {
  const base = new URL(location.pathname, location.origin);
  base.searchParams.set('c', encodeChallenge(challenge));
  return base.toString();
}

// Web Share when available (mobile), else clipboard. Resolves to { result, text, url } where
// result is 'shared' | 'copied' | 'cancelled' | 'failed'. Must be called from a user gesture.
export async function shareRun(run) {
  const { text, url } = shareText(run);
  return { result: await deliver(text, url), text, url };
}

async function deliver(text, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title: GAME_NAME, text, url });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

function shareText({ name, score, distance, topSpeed, combo, env }) {
  const route = (ENVIRONMENTS.find(e => e.id === env) || ENVIRONMENTS[0]).name;
  const fmt = n => Math.floor(n).toLocaleString('en-US');
  const text = `I scored ${fmt(score)} in ${GAME_NAME} on ${route} — ${(distance / 1000).toFixed(1)} km, ${fmt(topSpeed)} km/h, combo x${combo}. Can you beat it?`;
  return { text, url: challengeUrl({ name, score, distance, env }) };
}
