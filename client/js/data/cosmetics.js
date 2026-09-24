// Cosmetic options. Purely visual — nothing here touches handling. `level` gates an option
// behind driver level so customization doubles as a progression reward.

export const COSMETICS = {
  paint: [
    { id: 'factory', label: 'Factory', color: null },
    { id: 'magenta', label: 'Magenta', color: '#e0197d' },
    { id: 'cyan', label: 'Cyan', color: '#1fb7d6' },
    { id: 'sunburst', label: 'Sunburst', color: '#ff8a1a' },
    { id: 'lime', label: 'Lime', color: '#7ad13a', level: 3 },
    { id: 'pearl', label: 'Pearl', color: '#e9ecf5', level: 4 },
    { id: 'crimson', label: 'Crimson', color: '#b0122e', level: 6 },
    { id: 'midnight', label: 'Midnight', color: '#1a1f3d', level: 9 },
    { id: 'gold', label: 'Gold', color: '#d9a520', level: 15 },
  ],
  underglow: [
    { id: 'none', label: 'Off', rgb: null },
    { id: 'cyan', label: 'Cyan', rgb: '34, 230, 255' },
    { id: 'pink', label: 'Pink', rgb: '255, 45, 149' },
    { id: 'green', label: 'Toxic', rgb: '61, 255, 162', level: 3 },
    { id: 'amber', label: 'Amber', rgb: '255, 176, 32', level: 5 },
    { id: 'violet', label: 'Violet', rgb: '200, 107, 255', level: 8 },
    { id: 'white', label: 'Ice', rgb: '230, 245, 255', level: 12 },
  ],
  rim: [
    { id: 'dark', label: 'Stealth', color: null },
    { id: 'chrome', label: 'Chrome', color: '#c9d2e6' },
    { id: 'bronze', label: 'Bronze', color: '#b07a3a', level: 4 },
    { id: 'gold', label: 'Gold', color: '#ffcf5a', level: 7 },
    { id: 'neon', label: 'Neon', color: '#22e6ff', level: 10 },
  ],
  headlight: [
    { id: 'white', label: 'Halogen', rgb: '215, 235, 255' },
    { id: 'xenon', label: 'Xenon', rgb: '165, 195, 255' },
    { id: 'amber', label: 'Amber', rgb: '255, 200, 120', level: 4 },
    { id: 'violet', label: 'Violet', rgb: '205, 150, 255', level: 9 },
  ],
  trail: [
    { id: 'none', label: 'Off', particle: null },
    { id: 'plasma', label: 'Plasma', particle: 'BOOST', level: 2 },
    { id: 'ember', label: 'Ember', particle: 'SPARK', level: 6 },
    { id: 'ghost', label: 'Ghost', particle: 'WIND', level: 11 },
  ],
};

export const COSMETIC_SLOTS = [
  ['paint', 'Paint'],
  ['underglow', 'Underglow'],
  ['rim', 'Wheels'],
  ['headlight', 'Headlights'],
  ['trail', 'Boost trail'],
];

export function defaultCustom() {
  return { paint: 'factory', underglow: 'cyan', rim: 'dark', headlight: 'white', trail: 'none' };
}

const find = (slot, id) => COSMETICS[slot].find(o => o.id === id) || COSMETICS[slot][0];

// Resolves stored cosmetic ids into render values for a car.
export function resolveCustom(car, custom) {
  const paint = find('paint', custom.paint).color || car.paint;
  return {
    paint,
    rim: find('rim', custom.rim).color,
    underglowRgb: find('underglow', custom.underglow).rgb,
    headlightRgb: find('headlight', custom.headlight).rgb,
    trail: find('trail', custom.trail).particle,
  };
}
