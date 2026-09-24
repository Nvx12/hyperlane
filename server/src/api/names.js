// Display-name rules, shared by create and rename. Names are public (leaderboards), so they
// are restricted to a safe character set and screened for impersonation and obvious abuse.

export const NAME_MIN = 3;
export const NAME_MAX = 16;
const ALLOWED = /^[A-Za-z0-9 _-]+$/;

// Staff/system impersonation.
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'staff', 'system', 'support', 'official', 'nightvector', 'night vector', 'anonymous', 'null', 'undefined'];

// Substrings screened after de-leeting. Deliberately short: this is a speed bump, not a
// moderation system (see README "Anti-cheat and moderation limits").
const BLOCKED = ['fuck', 'shit', 'nigg', 'fagg', 'nazi', 'hitler', 'porn', 'whore', 'slut', 'retard', 'kike', 'chink'];
// Word-start only ("Scunthorpe" must pass).
const BLOCKED_PREFIX = ['cunt'];
// Whole words only: as substrings they would reject names like "Grapevine" or "Spicy".
const BLOCKED_WORDS = ['rape', 'spic', 'fag'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' };

function screenForm(name) {
  return name.toLowerCase().replace(/[0-9@$]/g, c => LEET[c] || c).replace(/[^a-z]/g, '');
}

// Returns { ok: true, name } with the normalised name, or { ok: false, message }.
export function validateDisplayName(input) {
  if (typeof input !== 'string') return { ok: false, message: 'Name is required.' };
  const name = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { ok: false, message: `Name must be ${NAME_MIN}–${NAME_MAX} characters.` };
  }
  if (!ALLOWED.test(name)) return { ok: false, message: 'Use letters, numbers, spaces, - and _ only.' };
  if (!/[A-Za-z0-9]/.test(name)) return { ok: false, message: 'Name needs at least one letter or number.' };
  const lower = name.toLowerCase();
  if (RESERVED.includes(lower) || RESERVED.includes(lower.replace(/[\s_-]/g, ''))) {
    return { ok: false, message: 'That name is reserved.' };
  }
  const screen = screenForm(name);
  const words = name.split(/[\s_-]+/).map(screenForm);
  if (BLOCKED.some(b => screen.includes(b))
    || words.some(w => BLOCKED_WORDS.includes(w) || BLOCKED_PREFIX.some(b => w.startsWith(b)))) {
    return { ok: false, message: 'Please choose a different name.' };
  }
  return { ok: true, name };
}
