// Achievements. `value(ctx)` returns current progress, where ctx.life holds lifetime totals
// including the run in progress and ctx.best holds personal bests including this run.
// Hidden achievements show "???" until unlocked.

export const ACHIEVEMENTS = [
  { id: 'first_ride', name: 'First Ride', desc: 'Complete your first race', icon: '🏁', reward: 100, target: 1, value: c => c.life.races },
  { id: 'speed_demon', name: 'Speed Demon', desc: 'Reach 250 km/h', icon: '⚡', reward: 150, target: 250, value: c => c.best.topSpeed },
  { id: 'light_speed', name: 'Light Speed', desc: 'Reach 350 km/h', icon: '☄', reward: 400, target: 350, value: c => c.best.topSpeed },
  { id: 'too_close', name: 'Too Close', desc: 'Perform 100 near misses', icon: '✦', reward: 300, target: 100, value: c => c.life.nearMisses },
  { id: 'insanity', name: 'Insanity', desc: 'Pull off 25 INSANE near misses', icon: '✺', reward: 400, target: 25, value: c => c.life.insaneMisses },
  { id: 'road_king', name: 'Road King', desc: 'Travel 100 km in total', icon: '♛', reward: 500, target: 100, value: c => c.life.distance / 1000 },
  { id: 'marathon', name: 'Marathon', desc: 'Drive 20 km in a single run', icon: '∞', reward: 400, target: 20, value: c => c.best.distance / 1000 },
  { id: 'untouchable', name: 'Untouchable', desc: 'Drive 10 km without a collision', icon: '◇', reward: 500, target: 10, value: c => c.best.cleanDistance / 1000 },
  { id: 'boost_addict', name: 'Boost Addict', desc: 'Use boost for 5 minutes in total', icon: '➤', reward: 300, target: 300, value: c => c.life.boostTime },
  { id: 'clean_getaway', name: 'Clean Getaway', desc: 'Escape your first police pursuit', icon: '◉', reward: 200, target: 1, value: c => c.life.policeEscapes },
  { id: 'escape_artist', name: 'Escape Artist', desc: 'Escape 10 police pursuits', icon: '⛓', reward: 600, target: 10, value: c => c.life.policeEscapes },
  { id: 'combo_king', name: 'Combo King', desc: 'Reach a x10 combo', icon: '✕', reward: 500, target: 10, value: c => c.best.combo },
  { id: 'perfectionist', name: 'Perfectionist', desc: 'Land 50 perfect overtakes', icon: '◎', reward: 400, target: 50, value: c => c.life.perfectOvertakes },
  { id: 'chicane_master', name: 'Chicane Master', desc: 'Clear 25 chicanes', icon: '≋', reward: 400, target: 25, value: c => c.life.chicanes },
  { id: 'gearhead', name: 'Gearhead', desc: 'Max out any upgrade', icon: '⚙', reward: 300, target: 1, value: c => c.maxedUpgrades },
  { id: 'collector', name: 'Collector', desc: 'Unlock every standard car', icon: '▣', reward: 1000, target: 6, value: c => c.standardCars },
  { id: 'high_roller', name: 'High Roller', desc: 'Earn 25,000 credits in total', icon: '◈', reward: 500, target: 25000, value: c => c.life.creditsEarned },
  { id: 'globetrotter', name: 'Globetrotter', desc: 'Complete 10 daily challenges', icon: '◷', reward: 800, target: 10, value: c => c.life.dailiesCompleted },
  { id: 'legend_spotter', name: 'Legend Spotter', desc: 'Pass the golden legend', icon: '★', reward: 300, target: 1, value: c => c.life.legendPasses, hidden: true },
  { id: 'ghost', name: 'Ghost in the Machine', desc: 'Unlock the Phantom Zero', icon: '👁', reward: 1000, target: 1, value: c => c.phantom, hidden: true },
];
