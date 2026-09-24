# Night Vector — Neon Highway Racer

*Thread the traffic. Own the night.*

An arcade endless-highway racer for the browser. Weave through traffic across five routes, chain risky moves into a combo multiplier, outrun the police, climb the global leaderboards and race your own best-run ghost. It installs as an app (PWA), plays offline, and supports keyboard, touch and game controllers.

- **Client:** vanilla JavaScript (ES modules), HTML5 Canvas and Web Audio. No framework and no bundler. Every graphic, sound and music track is generated procedurally.
- **Server:** one small Node.js process with zero runtime dependencies. It serves the game and a JSON API, stores data in SQLite (`node:sqlite`), and runs in a single Docker container.
- **The game never needs the server.** Without it you still get the full game with local progress; only leaderboards and online profiles need a connection.

## Quick start

Requires **Node.js 22.13+** (24 recommended).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:8080. Add `?debug` for the developer monitor (press **F**) and a `window.nightVector` console handle. Neither is ever available in production.

| Script | What it does |
|---|---|
| `npm run dev` | Server with auto-restart on server changes. The service worker is off in dev unless you add `?sw`, so edits are never hidden behind a cache. |
| `npm start` | Run the server (uses `dist/` in production if it exists, else `client/`). |
| `npm run build` | Release build into `dist/`: version check, copy, reference checks, `build-info.json`, size report. |
| `npm test` | Unit and API tests (`node:test`, in-memory database). |
| `npm run e2e` | Playwright end-to-end tests (desktop + phone profiles). First run: `npx playwright install chromium`. |
| `npm run lint` | ESLint. |
| `npm run stats` | Operator report: players, ranked/rejected races, runs, analytics events. |
| `npm run assets` | Regenerate the icons and the social preview image. |

## Controls

| Action | Keyboard | Touch | Controller |
|---|---|---|---|
| Steer | ← → / A D | ◀ ▶ | Left stick (analog) / D-pad |
| Accelerate | ↑ / W | automatic | RT / R2 |
| Brake | ↓ / S | BRAKE | LT / L2 |
| Boost | Space (hold) | BOOST | A / Cross (or RB) |
| Pause / back | P / Esc | ❚❚ | Start / Options · B / Circle (back in menus) |
| Menus | Tab / Enter | tap | D-pad / stick to move, A to select |
| Mute · Garage · Monitor | M · G · F (`?debug`) | buttons | — |

Without the accelerator the car cruises at 150 km/h.

- **Touch:** controls appear automatically on touch screens (Settings can force them on or off). Holding a phone upright mid-race pauses the game and asks you to rotate it.
- **Controllers:** connecting one shows a toast and switches every on-screen hint to controller buttons. The pad rumbles on hits. If it disconnects mid-race, the game pauses.

## How to score

The loop: **drive fast → take risks → near miss / late dodge → combo → boost → go faster → bigger risks → more score and credits → upgrades and cars → next run.**

- **Combo (x1 → x2 → x3 → x5 → x8 → x10)** multiplies every point, including distance.
  - Risk builds it and keeps it alive: graded near misses, late-dodge perfect overtakes, chicanes, boosted passes and golden-car passes.
  - Plain overtakes add only a trickle and don't stop it decaying.
  - After 5 s without a risky move it drops one tier; a crash resets it.
- **Near misses** are graded by how close you pass: CLOSE +100, VERY CLOSE +250, INSANE +500. Each one also refills boost.
- **Perfect overtake** (+300): a car was directly in your path within 35 m, and you passed it within 1.2 s at speed.
- **Slipstream:** tuck in behind a car to charge boost and gain speed.
- **Police pursuits:** survive 30 s to escape (+2,500).
- **Difficulty** follows racing time: a 30 s warm-up, then moderate → challenging → intense → expert by 6 minutes.

## Progression and features

- **7 cars**, each a sidegrade with its own playstyle (one is secret). Six upgrade categories with diminishing returns, plus cosmetics.
- **Economy:** credits, XP and driver levels. Three scaling missions at a time, a daily challenge that's the same for everyone on a given date, achievements, personal records and statistics.
- **World:** five routes plus a world tour, time of day, weather (rain, fog, storm), announced road events and rare surprises.
- **Online (optional):** anonymous racer profile, validated ranked runs, and leaderboards for top score / longest run / top speed / best combo, each for today, this week and all time.
- **Social:** Share & challenge from the results screen creates a link that shows your score as a challenge to whoever opens it.
- **Ghost:** a translucent replay of your personal best races alongside you (Settings → Best-run ghost).

## Architecture

A small monolith, on purpose:

```
┌──────────── browser ────────────┐        ┌──────────── node server (one process) ─────────────┐
│ index.html + ES modules (Canvas)│  HTTP  │ app.js: security headers → /health → /api/v1 → static│
│  Game loop (no network calls)   │◀──────▶│  static.js  in-memory cache, brotli/gzip, ETags       │
│  net/ApiClient  (timeouts, retry)│        │  api/       players · races · leaderboard · events    │
│  sw.js  offline precache        │        │  SQLite (WAL) on a volume  ·  JSON logs to stdout     │
└─────────────────────────────────┘        └───────────────────────────────────────────────────────┘
```

- **Game loop:** never touches the network.
  - API calls happen only from menus, at race start (a background session request that never blocks the countdown) and at run end.
  - Analytics batches go out on a timer or via `sendBeacon` when the page is hidden.
- **Offline-first:**
  - Progress lives in a versioned LocalStorage save; the server holds only ranked results and anonymous profiles.
  - Runs that finish offline are queued and submitted from the menus later.
- **Shared rules:** the server validates runs with the game's own `balance.js`, so validation bounds never drift from gameplay.

```
client/                 static PWA (served as-is in dev, copied to dist/ by the build)
  index.html  sw.js  manifest.webmanifest  og-image.jpg  icons/  fonts/  css/
  js/
    main.js boot.js       bootstrap + loading screen (boot.js is ES5 to show a message on old browsers)
    Game.js               state machine and loop
    balance.js config.js  gameplay balance · engine constants
    version.js env.js     version numbers · runtime config from <meta> tags
    AppShell.js pwa.js fullscreen.js   install, updates, fullscreen, connectivity, orientation
    InputManager.js GamepadInput.js FocusNav.js   keyboard/touch/controller → one set of actions
    Ghost.js Share.js     personal-best ghost · share text and challenge links
    net/                  ApiClient, PlayerService, RaceService, Analytics
    … Player, TrafficManager, SkillSystem, ScoreSystem, EventDirector, Road, Environment,
      Weather, Camera, Effects, Sprites, AudioManager, Music, SaveManager, Progression, Goals,
      Menus, MenuScreens, UIManager, data/
server/
  src/index.js            startup, graceful shutdown
  src/app.js              request pipeline, robots/sitemap
  src/config.js logger.js http.js security.js static.js precache.js htmlTransform.js
  src/api/                index (router, CORS, auth) · db (migrations) · players · names ·
                          races · raceRules (anti-cheat) · leaderboard · events · rateLimit
  scripts/stats.js        operator report
tools/                    build.mjs · generate-assets.mjs
tests/                    unit/ · api/ · e2e/ · helpers/
Dockerfile  docker-compose.yml  .env.example  .github/workflows/ci.yml
```

## API (`/api/v1`)

All responses are JSON. Errors always have the shape `{ "error": { "code", "message" } }`, never a stack trace. Authentication is `Authorization: Bearer <token>`, using the token returned once at profile creation.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/status` | – | Version, server time, feature flags |
| POST | `/players` | – | Create profile `{displayName}` → `{player, token}` |
| GET | `/players/me` | ✓ | Profile and online bests |
| PATCH | `/players/me` | ✓ | Rename `{displayName}` |
| DELETE | `/players/me` | ✓ | Delete profile and all its runs (right to erasure) |
| POST | `/races` | ✓ | Start a session `{carId, envId, clientVersion}` → `{sessionId}` |
| POST | `/races/:id/finish` | ✓ | Submit a run → `{accepted, personalBest, ranks}` or `{accepted:false, message}` |
| GET | `/leaderboard?category=&period=` | optional | Top 100. `category`: score, distance, speed or combo. `period`: day, week or all. With a token: `me` flags and your own rank. |
| GET | `/leaderboard/me` | ✓ | Your rank on every board |
| POST | `/events` | – | Analytics batch (see Privacy) |

These endpoints sit outside `/api/v1`:

| Path | Purpose |
|---|---|
| `/health` | Always 200 while the process is serving; reports `database: ok \| unavailable` |
| `/robots.txt`, `/sitemap.xml` | Search engines. Production only; other environments send `noindex`. |

## Database (SQLite)

Versioned migrations in `server/src/api/db.js`, recorded in `schema_migrations`. The database runs in WAL mode with foreign keys on.

| Table | Columns (key ones) | Notes |
|---|---|---|
| `players` | `id`, `display_name`, `token_hash` (unique), `created_at`, `last_seen_at`, `name_changed_at`, `races`, `flagged` | Only the SHA-256 of the token is stored. `flagged=1` hides a player from boards. |
| `race_sessions` | `id`, `player_id`, `car_id`, `env_id`, `client_version`, `started_at`, `finished_at`, `status` (open/accepted/rejected/expired), `reject_reason`, `result_hash` | The server stamps the start time. |
| `scores` | `session_id` (unique), `player_id`, `score`, `distance_m`, `top_speed_kmh`, `best_combo`, `duration_ms`, `car_id`, `created_at` | Accepted runs only. Deleted with their player. |
| `events` | `name`, `client_id`, `props` (JSON), `app_version`, `created_at` | Analytics. No IP, user agent or player id. 90-day retention. |

## Security

- **Headers:**
  - Strict CSP: `script-src 'self'`, no inline script, no eval, no third-party origins. The one `ld+json` block is inert data.
  - Also sent: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP, and HSTS in production over HTTPS.
- **Input handling:**
  - JSON only, with body size caps (4 KB, or 16 KB for analytics) and a content-type check.
  - Every field is validated for type and range; all SQL uses prepared statements.
  - Display names: 3–16 characters from `[A-Za-z0-9 _-]`, with reserved-name and profanity screening.
  - Leaderboards never expose player ids.
- **Static files:** path traversal and dotfiles are blocked; server source and data are never served.
- **Rate limiting:** in-memory token buckets.
  - A global per-IP limit, plus stricter limits on profile creation, renames, race start/finish, leaderboard reads and analytics.
  - Memory is bounded. `TRUST_PROXY` controls whether `X-Forwarded-For` is honoured.
- **CORS:** off unless `CORS_ORIGINS` lists allowed origins (only needed for a separate API domain).
- **Logs:** JSON lines in production. They never include tokens, request bodies, query strings or names, and 5xx errors are logged without stack traces in production.
- **Abuse tests:** `tests/api/security.test.js` covers traversal, SQL injection, markup in names, prototype pollution, forged tokens, floods, deeply nested JSON and information leaks.

### Anti-cheat: what it does and doesn't do

The browser is untrusted. The server never takes a client number at face value; each submitted run is checked against its session:

- **Wall clock:** race time can't exceed the real time that passed since the server opened the session. This defeats speed hacks and "fast-forwarded" runs.
- **Top speed:** at most that car's absolute ceiling (full upgrades, difficulty bonus, slipstream and boost), from the shared balance data.
- **Distance:** at most top speed × time. It must also be consistent with the reported top speed.
- **Actions:** near-miss and overtake counts are bounded by how much traffic the road can spawn over that distance. Perfect overtakes can't outnumber overtakes.
- **Score:** at most the theoretical maximum for that distance and those actions.
- **Combo:** must be a real tier (x1/2/3/5/8/10), and there must have been enough actions to reach it.
- **Sessions:** single use, one live session per player, 3-hour expiry. Re-sending the same result is idempotent; a different one is rejected as a replay.
- **Rejections:** the client only hears "could not be verified". The specific reason goes to the server log and to `npm run stats`.

**Limits.** A modified client that plays in real time with plausible numbers can still post a score. For example, an invulnerable car driving for 9 minutes produces believable figures. Stopping that needs server-side simulation or replay verification, which would be a much bigger system. Mitigations available today:

- Flag the player in the database (`UPDATE players SET flagged = 1 …`) to hide them from every board.
- Watch the rejection counters and top runs in `npm run stats`.

## Privacy

- **No accounts, emails or passwords.** An online profile is just a racer name plus a random token stored on the device. **Profile → Delete online profile** erases it and all its runs from the server.
- **Leaderboards** show only the racer name, the value, the car and the date.
- **Challenge links** contain only the racer name, score, distance and route. They are not signed: a tampered link can only change a target for whoever opens it, and ranked scores come only from verified runs.
- **Analytics:**
  - What's sent: whitelisted events (e.g. `race_end` with rounded km and score-in-thousands, `car_unlocked`, `upgrade_bought`) tied to a random per-install id that is not linked to the profile.
  - What's never sent or stored: IP addresses, user agents, names or free text.
  - Timing: batched every 30 s, never per frame.
  - Turning it off: Settings → Privacy, automatically with Do Not Track / Global Privacy Control, or `ANALYTICS_ENABLED=false` on the server (clients then stop sending).
- **Fonts** are self-hosted, so there are no third-party requests at all.

## PWA and offline

- **Install:** the manifest has icons (including maskable) and runs fullscreen in landscape. An in-game **Install** button appears when the browser offers it; the iOS hint is Share → Add to Home Screen.
- **Service worker:**
  - Precaches everything the game needs; the cache name comes from a content hash that the server computes.
  - Cache-first for assets; navigations are answered from the cached shell. `/api` and `/health` are never cached.
- **Updates never interrupt a race.** A new version downloads in the background. The "New version available" banner appears only in menus or on the results screen, and the reload happens only when the player accepts.
- **Offline:** the full game works, including saves, missions, the daily challenge, the ghost and challenges. The topbar shows **OFFLINE** (no network) or **LOCAL ONLY** (server unreachable).

## Configuration

Copy `.env.example` to `.env` for local overrides. Real environment variables always win.

| Variable | Default | Purpose |
|---|---|---|
| `APP_ENV` | `development` | development / staging / production / test (falls back to `NODE_ENV`) |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Listen address |
| `PUBLIC_URL` | – | Public origin for canonical, Open Graph, sitemap and JSON-LD. Set it in production. |
| `API_URL` | – | Only if the API is on another origin (also add it to `CORS_ORIGINS`) |
| `CORS_ORIGINS` | – | Comma-separated allowed origins |
| `DATABASE_PATH` | `data/nightvector.db` | SQLite file (`:memory:` for tests) |
| `TRUST_PROXY` | `false` | Honour `X-Forwarded-For` (only behind a proxy you control) |
| `ANALYTICS_ENABLED` | `true` | Server-side analytics switch |
| `RATE_LIMIT_SCALE` | `1` | Multiply all rate limits (load tests, E2E) |
| `STATIC_DIR` | auto | Override the static directory |
| `LOG_LEVEL` | `info` in prod, `debug` in dev | debug / info / warn / error |

No secrets are required: player tokens are random and stored hashed, and sessions are database records.

## Deployment

```bash
docker compose up -d --build
```

The image:

- **Base:** `node:24-alpine`; the build stage produces `dist/`.
- **Runtime:** runs as the non-root `node` user with no npm dependencies. The data volume is at `/data`, and the container can run with a read-only root filesystem (compose does this).
- **Health:** a `HEALTHCHECK` polls `/health`.
- **Shutdown:** on SIGTERM the server stops accepting connections, finishes in-flight requests, closes the database, and exits within 10 s.

Put a TLS-terminating reverse proxy in front (Caddy, nginx or a platform load balancer), set `PUBLIC_URL=https://…` and `TRUST_PROXY=true`, and back up the `/data` volume. SQLite in WAL mode can be backed up live with `sqlite3 nightvector.db ".backup backup.db"`.

**Scaling:** one instance comfortably serves a small-to-medium player base, since the game is static and the API is tiny. Running several instances would need the database and rate limiter moved to shared services; that is intentionally out of scope.

## Testing and CI

| Suite | Command | Covers |
|---|---|---|
| Unit | `npm test` | Scoring and combo tiers/decay, upgrades and costs, XP, records, unlocks, run rewards, save load/migration/corruption/sanitizing, missions, daily challenge, achievements, anti-cheat rules, challenge links, ghost |
| API | `npm test` | Profiles, names, auth, body limits, rate limits, CORS, sessions, idempotency, replay, expiry, validation, leaderboards, erasure, analytics, security abuse cases, robots/sitemap |
| E2E | `npm run e2e` | Boot without console errors, full race to results, pause, online profile and leaderboard, security headers, offline play via the service worker, challenge links (valid and hostile), controller navigation and driving, frame-time budget. Desktop and phone profiles. |

**CI** (`.github/workflows/ci.yml`) runs lint → unit/API → build → E2E. It then builds the Docker image, waits for the container to become healthy, and checks that `docker stop` exits cleanly.

## Performance

- **No per-frame allocations** in hot paths: traffic, pickups, particles, rain and floating text all use pools or typed arrays.
- **Batched rendering:** each road layer is one batched path fill; sprites and backdrops are pre-rendered and cached.
- **HUD:** updates 15 times a second and only writes values that changed.
- **Auto-scaling:** sustained frame drops reduce effects detail first, then render resolution. Phones are capped at 1.25× pixel density.
- **Measured:**
  - About 3.5 ms per update+render in desktop Chromium, and 5.7 ms in headless software rendering. The E2E budget is 12 ms.
  - The JS heap stayed flat at 9.5 MB across 33 consecutive races.
  - Release payload is 438 KB gzipped (brotli is smaller).

## Known limitations

- The road is flat (no hills), and all traffic drives in your direction.
- Anti-cheat can't detect a modified client that plays in real time with believable numbers (see above).
- Display-name screening is a short word list, not full moderation; the `flagged` column is the manual tool.
- The server is single-instance: rate limits live in memory, and SQLite runs on one volume.
- Touch and controller support were tested in emulation (Chromium device emulation and a simulated standard gamepad), not on physical devices.
- The Docker image and SIGTERM shutdown are verified in CI, not on the development machine.

## Licenses

- Fonts: Orbitron and Rajdhani, SIL Open Font License 1.1 (`client/fonts/OFL-*.txt`).
- Everything else is original to this project.
