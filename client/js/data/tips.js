// One short tip per race start (after the first-race tutorial), in teaching order, then shuffled.
// Short on purpose: it's read during a 3-second countdown on a phone.
export const TIPS = [
  'Near misses build your COMBO and refill BOOST.',
  'Hold BOOST for speed — near misses recharge it.',
  'Dodge a car in your lane at the last moment: PERFECT OVERTAKE.',
  'Tuck in behind a car to SLIPSTREAM and charge boost fast.',
  'Safe driving lets your combo decay. Keep taking risks!',
  'A crash resets your combo. Credits buy upgrades in the GARAGE.',
  'Blinking amber lights: that car is changing lanes.',
  'Go fast and the police may chase you. Survive 30 s to escape.',
  'Roadwork and checkpoints are announced up top — pick your lane early.',
  'Quick taps steer gently; hold for a full swerve.',
];

export function tipFor(raceCount) {
  if (raceCount < TIPS.length) return TIPS[raceCount];
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}
