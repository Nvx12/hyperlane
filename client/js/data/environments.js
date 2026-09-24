// Routes. Each defines base surface colors (as lit at night) and which procedural skyline,
// roadside props, barrier style and weather it uses. Time of day supplies sky/light/fog;
// the final road palette = base × light, lightly tinted by the fog color.

export const TIME_OF_DAY = {
  night: {
    label: 'Night',
    sky: ['#04020b', '#12082a', '#35104a', '#5c1a5f'],
    haze: '255, 45, 149', hazeAlpha: 0.4, fog: '52, 16, 70',
    stars: 1, light: 1, lamps: 1, windows: 1,
    sun: { type: 'moon', x: 0.78, y: 0.28, r: 0.042, color: '#ffe6f4', glow: '255, 190, 230' },
  },
  sunset: {
    label: 'Sunset',
    sky: ['#1a0b3b', '#5a1e6b', '#ff5e62', '#ffb56b'],
    haze: '255, 140, 90', hazeAlpha: 0.55, fog: '150, 70, 90',
    stars: 0.12, light: 1.5, lamps: 0.55, windows: 0.55,
    sun: { type: 'sun', x: 0.5, y: 0.88, r: 0.12, color: '#ffd86b', glow: '255, 120, 80', stripes: true },
  },
  dawn: {
    label: 'Dawn',
    sky: ['#0e1a3a', '#3a4a7a', '#c28bb0', '#ffd1b0'],
    haze: '255, 200, 170', hazeAlpha: 0.35, fog: '120, 110, 140',
    stars: 0.3, light: 1.8, lamps: 0.25, windows: 0.3,
    sun: { type: 'sun', x: 0.24, y: 0.92, r: 0.07, color: '#fff0d0', glow: '255, 210, 170' },
  },
};

export const TIME_CYCLE = ['sunset', 'night', 'dawn'];

export const ENVIRONMENTS = [
  {
    id: 'neon', name: 'Neon City', tagline: 'Skyscrapers, billboards and tunnels', level: 1,
    time: 'night', skyline: 'city', wall: 'neon', tunnels: true,
    props: ['lamps', 'billboards'],
    weather: { clear: 0.6, rain: 0.25, fog: 0.1, storm: 0.05 },
    card: 'linear-gradient(160deg, #12082a 0%, #5c1a5f 55%, #ff2d95 100%)',
    base: {
      groundA: '#0a0616', groundB: '#0d0a1d', shoulder: '#100c1f', roadA: '#17142a', roadB: '#1a1730',
      rumbleA: '#ff2d95', rumbleB: '#2a0f33', wallA: '#1a1134', wallB: '#211741', wallTop: '#22e6ff',
      slit: '#ff2d95', lane: '#eef8ff', edge: '#9ff4ff', marker: '#ffd27a', tunnel: '#171226', tunnelLight: '#ffb347',
    },
  },
  {
    id: 'desert', name: 'Desert Highway', tagline: 'Mesas, dust and a long open road', level: 3,
    time: 'sunset', skyline: 'mesa', wall: 'low', tunnels: false,
    props: ['cacti', 'posts'],
    weather: { clear: 0.75, fog: 0.25, rain: 0, storm: 0 },
    fogTint: '205, 150, 95', dust: true,
    card: 'linear-gradient(160deg, #3a1e5a 0%, #ff5e62 60%, #ffb56b 100%)',
    sky: { sunset: ['#2a1245', '#8a2f5a', '#ff7b4a', '#ffc27a'] },
    base: {
      groundA: '#2a170d', groundB: '#311c10', shoulder: '#2a1d14', roadA: '#1d1714', roadB: '#211a16',
      rumbleA: '#ff8a1a', rumbleB: '#3a2416', wallA: '#3b2a1d', wallB: '#433022', wallTop: '#ffb347',
      slit: null, lane: '#fff3dc', edge: '#ffd9a0', marker: '#ff9a3a', tunnel: '#2a1d14', tunnelLight: '#ffb347',
    },
  },
  {
    id: 'coast', name: 'Coastal Road', tagline: 'Ocean causeway, cliffs and palms', level: 5,
    time: 'sunset', skyline: 'coast', wall: 'low', tunnels: false,
    props: ['palms', 'lamps'],
    weather: { clear: 0.7, rain: 0.15, fog: 0.15, storm: 0 },
    card: 'linear-gradient(160deg, #1a0b3b 0%, #ff5e62 45%, #0b4a7a 100%)',
    base: {
      groundA: '#06213d', groundB: '#082847', shoulder: '#1a1a24', roadA: '#1a1a26', roadB: '#1d1d2b',
      rumbleA: '#22e6ff', rumbleB: '#10233a', wallA: '#2a2f3d', wallB: '#323848', wallTop: '#e8f6ff',
      slit: null, lane: '#f4fbff', edge: '#bff4ff', marker: '#ffe08a', tunnel: '#1a1a24', tunnelLight: '#ffd27a',
    },
  },
  {
    id: 'mountain', name: 'Mountain Pass', tagline: 'Pines, guardrails, fog and tunnels', level: 7,
    time: 'dawn', skyline: 'mountains', wall: 'guardrail', tunnels: true,
    props: ['pines', 'posts'],
    weather: { clear: 0.45, fog: 0.4, rain: 0.15, storm: 0 },
    card: 'linear-gradient(160deg, #0e1a3a 0%, #3a4a7a 50%, #c28bb0 100%)',
    base: {
      groundA: '#0a1410', groundB: '#0d1914', shoulder: '#15161c', roadA: '#18181f', roadB: '#1b1b23',
      rumbleA: '#e8e8f0', rumbleB: '#b0122e', wallA: '#5a6070', wallB: '#666d80', wallTop: '#c9d2e6',
      slit: null, lane: '#f4f6ff', edge: '#e0e6ff', marker: '#ffcf5a', tunnel: '#1a1c22', tunnelLight: '#ffe4a0',
    },
  },
  {
    id: 'rain', name: 'Rainy City', tagline: 'Storms, lightning and mirror roads', level: 10,
    time: 'night', skyline: 'city', wall: 'neon', tunnels: true,
    props: ['lamps', 'billboards'],
    weather: { rain: 0.65, storm: 0.35, clear: 0, fog: 0 },
    wetBase: 0.6,
    card: 'linear-gradient(160deg, #0b1020 0%, #25304a 55%, #22e6ff 100%)',
    sky: {
      night: ['#05070d', '#0e1422', '#1c2536', '#2a3448'],
      sunset: ['#0d0f1e', '#2a2440', '#5a3a5a', '#7a5060'],
      dawn: ['#0d1426', '#2a3550', '#56607a', '#7a8398'],
    },
    haze: '90, 170, 255',
    base: {
      groundA: '#070a12', groundB: '#090d17', shoulder: '#0c0f18', roadA: '#121521', roadB: '#141827',
      rumbleA: '#22e6ff', rumbleB: '#0f1f33', wallA: '#131a2c', wallB: '#182036', wallTop: '#ff2d95',
      slit: '#22e6ff', lane: '#e6f2ff', edge: '#9ff4ff', marker: '#9ff4ff', tunnel: '#10131d', tunnelLight: '#9ff4ff',
    },
  },
];
