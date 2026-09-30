// Driver-name rules, shared by the game (instant feedback, local profiles, challenge links) and
// the server (the authority for online names). Names are public on leaderboards, so:
//   - NFKC-normalised, trimmed, inner whitespace collapsed; length counted in characters
//     (code points), not UTF-16 units
//   - letters and digits of any script, spaces, - and _ — no symbols, no markup characters
//   - no control, format (bidi overrides, zero-width), private-use or unassigned characters
//   - limited combining marks (no "zalgo" text)
//   - screened for impersonation and obvious abuse (a speed bump, not full moderation — see
//     README "Anti-cheat and moderation limits"; non-Latin scripts get only the basic checks)

export const NAME_MIN = 3;
export const NAME_MAX = 16;
const MAX_MARKS = 3;
const ALLOWED = /^[\p{L}\p{M}\p{N} _-]+$/u;
const NEEDS = /[\p{L}\p{N}]/u;
const FORBIDDEN = /\p{C}/u; // control, format, surrogate, private use, unassigned

// Staff/system impersonation.
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'staff', 'system', 'support', 'official', 'nightvector', 'night vector', 'anonymous', 'null', 'undefined'];

// Substrings screened after de-leeting. Deliberately short (see above).
const BLOCKED = ['fuck', 'shit', 'nigg', 'fagg', 'nazi', 'hitler', 'porn', 'whore', 'slut', 'retard', 'kike', 'chink'];
// Word-start only ("Scunthorpe" must pass).
const BLOCKED_PREFIX = ['cunt'];
// Whole words only: as substrings they would reject names like "Grapevine" or "Spicy".
const BLOCKED_WORDS = ['rape', 'spic', 'fag'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' };

// Lowercase, accents stripped, leetspeak undone, Latin letters only.
function screenForm(name) {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[0-9@$]/g, c => LEET[c] || c).replace(/[^a-z]/g, '');
}

// Returns { ok: true, name } with the normalised name, or { ok: false, name, message }.
export function validateDisplayName(input) {
  if (typeof input !== 'string') return { ok: false, name: '', message: 'Name is required.' };
  const name = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length < NAME_MIN || length > NAME_MAX) {
    return { ok: false, name, message: `Name must be ${NAME_MIN}–${NAME_MAX} characters.` };
  }
  if (FORBIDDEN.test(name) || !ALLOWED.test(name)) return { ok: false, name, message: 'Use letters, numbers, spaces, - and _ only.' };
  if (!NEEDS.test(name)) return { ok: false, name, message: 'Name needs at least one letter or number.' };
  if ((name.match(/\p{M}/gu) || []).length > MAX_MARKS) return { ok: false, name, message: 'Too many accents in that name.' };
  const lower = name.toLowerCase();
  if (RESERVED.includes(lower) || RESERVED.includes(lower.replace(/[\s_-]/g, '')) || RESERVED.includes(screenForm(name))) {
    return { ok: false, name, message: 'That name is reserved.' };
  }
  const screen = screenForm(name);
  const words = name.split(/[\s_-]+/).map(screenForm);
  if (BLOCKED.some(b => screen.includes(b))
    || words.some(w => BLOCKED_WORDS.includes(w) || BLOCKED_PREFIX.some(b => w.startsWith(b)))) {
    return { ok: false, name, message: 'Please choose a different name.' };
  }
  return { ok: true, name, message: '' };
}
