// One tip per race start, in teaching order for new players, then shuffled.
export const TIPS = [
  'Pass close to traffic for a NEAR MISS — it builds your COMBO and refills BOOST.',
  'Hold SPACE to boost. Near misses and slipstreams recharge it; waiting barely does.',
  'Swerve around a car in your lane at the last moment for a PERFECT OVERTAKE.',
  'Tuck in right behind a car to SLIPSTREAM — extra speed and fast boost charge.',
  'Your combo drops a tier after 5 seconds of safe driving. Keep taking risks!',
  'A crash resets your combo. Credits from every run buy upgrades in the GARAGE.',
  'Blinking amber lights mean a car is about to change lanes.',
  'Drive fast or build a big combo and the police may come for you. Outrun them for 30 s.',
  'Warnings at the top announce roadwork and checkpoints — pick your lane early.',
];

export function tipFor(raceCount) {
  if (raceCount < TIPS.length) return TIPS[raceCount];
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}

// New players see the full control reference for their first few races.
export const SHOW_CONTROLS_RACES = 4;
