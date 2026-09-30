# Progression model (v1.2)

One set of rules — `client/js/progression/engine.js` — decides XP, levels, credits, unlocks,
purchases, upgrades, cosmetics, missions, the daily challenge and achievements. The game runs it
locally; the server runs the very same code for online accounts. Every number lives in
`client/js/progression/config.js`. There is no second unlock system anywhere.

## Philosophy

Rewarding, not rushed and not grindy:

- **First session** — learn the controls (tutorial), earn the first credits, buy a first upgrade.
- **Early game** — improve the starter, complete missions, reach the first levels, buy the first
  sport car.
- **Mid game** — the second sport car and the performance car; harder missions; specialising.
- **Late game** — the supercar needs level *and* skill (a 150k run, a x8 combo) *and* credits.
- **End game** — the hypercar (level 26, a 200k run, the x10 "Combo King" achievement, 85k
  credits), rare cosmetics, the secret legendary car, leaderboards.

Skill matters more than mileage: distance pays little; near misses, perfect overtakes, chicanes,
combos and police escapes pay the rest. Per-run soft caps (rising with level) stop one freak run
from skipping the ladder.

## XP and levels

`XP to go from level L to L+1 = 350 × L` (linear), so the total to reach a level grows
quadratically — steady, never exponential. In the simulation: level 2 after one run, level 10
after ~31 casual runs, level 20 after ~156. Max level 40.

XP per run = 30 + 11/km + 0.8 per 1,000 score + 8 per near miss + 6 per perfect overtake +
8 per chicane + 40 per police escape + 5…100 for the best combo tier, soft-capped at
`700 + 45·level` (35% beyond, never more than twice the cap). Missions, the daily challenge and
achievements add their own XP.

Levels gate: cars, upgrade steps (step 3 needs level 5, step 4 level 9, step 5 level 14),
cosmetics, routes and the world tour — never basic gameplay.

## Credits (the only currency)

Earned: distance (8/km), score (1.2 per 1,000), overtakes (0.25, perfect 6), near misses (8,
insane +10), best combo tier (15…200), chicanes (10), police escapes (100), legend passes (100),
credit chips (50), a new best score (100), missions, the daily challenge, achievements.
Per-run soft cap `900 + 60·level`.

Spent on: cars, performance upgrades, cosmetics. No gems, energy or second currency.

## Cars

| Car | Tier | Price | Level | Special requirement | Upgrade ceiling |
|---|---|---|---|---|---|
| Vireo Hatch | 1 Street | starter | — | — | 3 per line |
| Kestrel GT | 2 Sport | 2,500 | 3 | — | 4 |
| Bruiser V8 | 2 Sport | 7,500 | 7 | 8 missions completed | 4 |
| Wisp LT | 3 Performance | 16,000 | 11 | 120 perfect overtakes (lifetime) | 5 |
| Stiletto R | 4 Supercar | 42,000 | 17 | 150,000 in one run + a x8 combo | 5 |
| Aurora X | 5 Hypercar | 85,000 | 26 | 200,000 in one run + "Combo King" (x10) | 5 |
| Phantom Zero | Legendary | 120,000 | 30 | secret feat (shown as ???) | 5 |

Requirements met → the car becomes *available to buy*; then it must be bought. Locked cars stay
visible in the garage with every requirement and its progress; the legendary car stays "???"
until its secret feat happens.

Upgrades: six lines (engine, turbo, tires, brakes, nitro, armor) with diminishing percentage
steps. Price of step *n* = [400, 900, 1,700, 3,000, 4,800][n] × tier multiplier (1, 1.6, 2.4,
3.4, 4.6). The tier ceiling keeps every car's identity: a fully upgraded starter tops out around
240 km/h, below a stock supercar.

## Missions, daily challenge, achievements

Three missions at a time, rolled from the profile's own seed (client and server roll the same
ones). Cumulative missions take about five typical runs; single-run missions are a stretch
(roughly one run in five). Reward: `100 + 25·level` credits and `60 + 15·level` XP.
Daily challenge: three goals, the same for everyone that day, `500 + 50·level` credits and
`250 + 25·level` XP, once per day. Achievements pay once (100 – 3,000 credits, half as XP).

## Simulated progression

Not guesses: `tools/balance/sample-runs.mjs` recorded 1,260 real runs — bots driving the actual
game (traffic, difficulty, collisions, the touch steering path) for three player types (reaction
time, mistakes, appetite for risk), in every car, stock and fully upgraded.
`tools/balance/simulate.mjs` replays those runs through the real progression engine for 300
brand-new players per type, who buy the next car as soon as it is available and otherwise the
cheapest upgrade, drive their best car, and play 10 / 16 / 24 runs a day. Median run (p10–p90),
hours of play (runs + ~25 s of menus each), and day:

```
300 simulated players per type · 1260 recorded runs · runs per day: casual 10, skilled 16, expert 24

milestone                           casual                        skilled                       expert                        
First upgrade                       run 1 (1–3) 0.0h d1           run 1 (1–3) 0.1h d1           run 2 (1–4) 0.1h d1           
Level 5                             run 6 (4–9) 0.3h d1           run 6 (4–8) 0.2h d1           run 5 (3–7) 0.2h d1           
First new car (Kestrel GT, Sport)   run 4 (2–6) 0.2h d1           run 3 (1–4) 0.1h d1           run 3 (1–4) 0.1h d1           
Level 10                            run 31 (26–36) 1.1h d4        run 28 (25–32) 1.0h d2        run 25 (22–28) 1.0h d2        
2nd sport car (Bruiser V8)          run 23 (18–29) 0.8h d3        run 20 (17–24) 0.7h d2        run 18 (15–21) 0.7h d1        
Performance car (Wisp LT)           run 58 (52–66) 2.0h d6        run 53 (50–59) 1.9h d4        run 49 (44–53) 1.8h d3        
Supercar (Stiletto R)               run 177 (165–190) 5.6h d18    run 137 (129–148) 4.7h d9     run 126 (117–137) 4.6h d6     
Level 20                            run 156 (147–169) 5.0h d16    run 123 (115–132) 4.2h d8     run 114 (105–123) 4.1h d5     
Hypercar (Aurora X)                 run 431 (409–449) 12.2h d44   run 420 (404–439) 11.9h d27   run 341 (323–362) 11.0h d15   
Level 30                            run 385 (368–402) 11.0h d39   run 364 (351–378) 10.4h d23   run 304 (290–320) 9.8h d13    
Legendary (Phantom Zero)            run 667 (645–690) 18.0h d67   run 671 (646–702) 17.8h d42   run 595 (568–617) 17.0h d25
```

Reading it: the first upgrade comes in the first run or two and the first new car in 3–4 runs;
the second sport car and the performance car are early/mid goals (1–2 hours); the supercar is a
real achievement (5–6 hours); the hypercar is a long-term goal (11–12 hours: two to six weeks of
normal play) and the legendary car longer still. Skill shortens the ladder (experts reach the
supercar ~30% sooner and the hypercar ~20% sooner than casual players) but no single run can
skip it (per-run caps, level gates, dual requirements).

Limits of the model: bots are not people. They crash sooner in the fastest cars, so the bot
"skilled" player barely out-earns the "casual" one in a supercar, which compresses the skill gap
late in the ladder; real skilled players should pull further ahead there. Cosmetic spending is
not simulated (it slows car purchases slightly). Re-run the simulation after any change to
`progression/config.js`; `tests/unit/balance.test.js` guards the headline targets.
