// Driver avatars: a glyph on a neon disc. Text glyphs (not emoji) so they render the same on
// every phone. The id is what the save stores.
export const AVATARS = [
  { id: 'bolt', glyph: '⚡︎', color: '#22e6ff' },
  { id: 'diamond', glyph: '◆', color: '#ff2d95' },
  { id: 'star', glyph: '★', color: '#ffc247' },
  { id: 'triangle', glyph: '▲', color: '#3dffa2' },
  { id: 'circle', glyph: '●', color: '#c86bff' },
  { id: 'cross', glyph: '✚', color: '#ff5a3c' },
  { id: 'moon', glyph: '◐', color: '#9fb4ff' },
  { id: 'spark', glyph: '✦', color: '#ffffff' },
];

export const AVATAR_IDS = AVATARS.map(a => a.id);
export const getAvatar = id => AVATARS.find(a => a.id === id) || AVATARS[0];
