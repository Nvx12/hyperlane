# HYPERLANE — Night Highway Racer

An arcade endless-highway racer for the browser. Weave through traffic across five routes, chain risky moves into a combo multiplier, outrun the police, and earn credits for new cars and upgrades.

Vanilla JavaScript (ES modules), HTML5 Canvas and Web Audio. There's no framework, no build step, and no image or audio files: every graphic, sound and music track is generated procedurally.

## Run it

ES modules need to be served over HTTP (opening `index.html` directly via `file://` won't work):

```bash
node server.mjs
```

Then open http://localhost:5173. Any static server works too, e.g. `python -m http.server 5173`.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Steer | ← → / A D | ◀ ▶ |
| Accelerate | ↑ / W | automatic |
| Brake | ↓ / S | BRAKE |
| Boost | Space (hold) | BOOST |
| Pause / back | P / Esc | ❚❚ |
| Mute | M | speaker button |
| Garage (from the home screen) | G | – |
| Confirm | Enter | tap |
| Developer monitor | F (only with `?debug` in the URL) | – |

Without the accelerator held, the car cruises at 150 km/h. Touch controls appear automatically on touch screens; you can force them on or off in Settings. For the first few races, the countdown shows the controls and one gameplay tip.

## How to score

The loop: **drive fast → take risks → near miss / late dodge → combo → boost → go faster → bigger risks → more score and credits → upgrades and cars → next run.**

- **Combo (x1 → x2 → x3 → x5 → x8 → x10)** multiplies every point, including distance.
  - Risk builds it and keeps it alive: graded near misses, late-dodge **perfect overtakes**, chicanes, boosted passes and golden-car passes.
  - Plain overtakes add only a trickle, and don't stop it from decaying.
  - After 5 seconds without a risky move, it drops one tier. A crash resets it.
  - In testing, a careful driver peaks around x3; a risky driver reaches x10 and scores about 3× more.
- **Boost** mostly comes from risk: near misses (+10/16/25), high-speed overtakes and slipstreaming. Passive regeneration is only a slow safety net.
- **Difficulty** follows racing time: a 30 s warm-up, moderate by 1 min, challenging by 2 min, intense by 4 min, then expert. After that it stops getting denser; events, weather and police keep the pressure on.
- **Near misses** are graded by how close you pass: CLOSE +100, VERY CLOSE +250, INSANE +500. Each one also refills some boost.
- **Perfect overtake** (+300): the car was directly in your path within 35 m, and you passed it within 1.2 s at speed.
- **Chicanes:** clear all three cars of a staggered traffic pattern without touching any.
- **Slipstream:** tuck in behind a car to gain acceleration, top speed and boost. Your choice is to stay and charge, or pull out and overtake.
- **Police pursuits** start when you're very fast or on a high combo. Survive 30 s to get **ESCAPED**: +2,500 points and +500 credits. If the gap closes, you're **BUSTED**.

## Progression

- **Credits** come from distance, score, near misses, perfect overtakes, your best combo, time held at high speed, police escapes, missions, the daily challenge and achievements. Skill pays more than mileage. Spend credits in the **garage**.
- **7 cars**, each a sidegrade with its own playstyle rather than a step up a ladder:

  | Car | Role | Unlock |
  |---|---|---|
  | Vireo Hatch | Forgiving all-rounder | Start |
  | Kestrel GT | Balanced, no weak spot | Drive 10 km total |
  | Bruiser V8 | Tank: shrugs off hits, turns like a boat | 50 near misses |
  | Stiletto R | Fast and precise, but fragile | Reach 300 km/h |
  | Wisp LT | Weaver: instant grip, low top speed, paper armor | Driver level 6 |
  | Aurora X | 335 km/h, heavy steering, for experts | Score 250,000 in one run |
  | ??? | Secret | — |

- **Upgrades:** Engine, Turbo, Tires, Brakes, Nitro and Armor, 5 levels each. Returns diminish (the first levels are the big jumps), so maxing a car never trivializes the game. Every level changes a real handling value.
- **Results screen:** shows what's within reach next: an affordable upgrade, the closest car unlock, the nearest mission, or your best score to beat.
- **Customization:** paint, underglow, wheels, headlight colour and boost trail. Some options unlock at higher driver levels.
- **XP and levels:** Rookie → Street Racer (5) → Pro (10) → Elite (20) → Legend (30). Levels also unlock routes.
- **Missions:** three active at a time, with targets that scale to your level. Rewards pay out when a run ends.
- **Daily challenge:** three goals generated from the local date, so everyone gets the same challenge on the same day. It's local-only; the `LocalDailyProvider` interface lets a server-backed provider replace it later.
- **Achievements, personal records and a statistics page.**

## World

- **Routes:** Neon City, Desert Highway, Coastal Road, Mountain Pass and Rainy City. Each has its own skyline, roadside props, barriers and weather odds.
- **World tour** (from level 5) switches route every 5 km.
- **Time of day:** sunset → night → dawn, blending gradually during a run.
- **Weather:** clear, rain, fog and storm.
  - Rain wets the road, reduces grip and limits visibility.
  - Storms add lightning and thunder.
- **Road events**, always announced before they arrive: heavy traffic, open highway (distance points ×1.5), tunnel, roadwork (one lane closed), police checkpoint (use the one open lane), and rainstorm.
- **Rare surprises:** there are a few, and they're left for players to find.

## Project structure

```
index.html  css/style.css (HUD, core)  css/menus.css (menus, garage, results, overlays)
server.mjs  zero-dependency static server
js/
  main.js            bootstrap
  config.js          engine / rendering / physics constants
  balance.js         ALL gameplay balance: difficulty, traffic, personalities, combo, scoring,
                     boost, slipstream, damage, events, police, cars, upgrades, credits, XP
  data/              content: environments, cosmetics, missions, achievements, onboarding tips
  Game.js            state machine + loop: input → update → collisions → spawning → scoring → render
  Player.js          handling driven by the car profile (+ grip, slipstream, crash wobble)
  TrafficManager.js  pooled traffic, personalities, fair lane changes, chicanes, barriers
  SkillSystem.js     near misses, overtakes, slipstream, streaks, combo feedback, collision scan
  ScoreSystem.js     score, tiered combo with decay, run stats
  EventDirector.js   road events and police pursuits
  Road.js            segment road, barriers, props, tunnels, fog
  Environment.js     routes, time of day, sky/skyline generation and blending
  Weather.js         rain/fog/storm, lightning, grip
  Camera.js          projection, FOV, follow, roll, shake (scaled by settings)
  Effects.js         particles, speed lines, floating text, screen flashes
  ParticleSystem.js  typed-array particle pool + speed lines
  Sprites.js         procedural car/prop/glow sprites
  AudioManager.js    synthesized engine, turbo, tyres, wind, rain, siren, SFX, volume buses
  Music.js           procedural synthwave sequencer (intensity layers)
  SaveManager.js     versioned LocalStorage save with migration and corruption handling
  Progression.js     cars, profiles, upgrades, unlocks, credits, XP, records, lifetime stats
  Goals.js           missions, daily challenge provider, achievements
  Menus.js / MenuScreens.js   garage and menu screens
  UIManager.js       HUD, banners, toasts, results
  InputManager.js / FloatingText.js / Rng.js / utils.js
```

## Performance

- **Simulation:** fixed-shape game loop driven by `requestAnimationFrame`. Delta time is clamped, and the game auto-pauses when the tab is hidden.
- **Memory:** there are no per-frame allocations in hot paths. Vehicles, pickups, particles, rain and floating text all use fixed pools or typed arrays.
- **Rendering:** each road layer is a single batched path fill. Sprites, skies, skylines and vignettes are pre-rendered; backdrops are kept in a small cache and built ahead of time-of-day transitions, so transitions don't stutter.
- **DOM:** the HUD updates 15 times a second and only writes values that changed. Menus render on open, never per frame.
- **Graphics quality** (Low/Medium/High) only changes cosmetic detail. Gameplay is identical at every level.
- **Auto-scaling:** a sustained frame-rate drop first reduces effects detail, then render resolution, and recovers when frame times improve.
- **Measured** in Chromium at 1280×720, at maximum difficulty with heavy traffic, a storm, a police chase, boost and particles all active at once: 1.0 ms median per frame, 1.9 ms at the 99th percentile, 2.9 ms worst. The heap stayed flat across 28 restart cycles and a 5.5-minute session.
- **Save data** is versioned, type-checked and range-checked on load. Corrupt data is quarantined instead of crashing, and the game still runs if LocalStorage is blocked.

## Limitations

- **Road:** it's flat (no hills), and all traffic drives in your direction.
- **Offline:** the daily challenge and records are local only; there's no online leaderboard.
- **Fonts:** Google Fonts, with system fonts as the offline fallback.
- **Touch controls:** tested in an emulated phone viewport, not on real devices.
