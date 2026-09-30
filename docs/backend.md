# Backend: accounts, cloud progression and persistence

The race is local. The database stores product data only: accounts, progression, the garage,
achievements, missions, statistics, race results and leaderboards. Nothing in the frame loop —
movement, traffic, collisions, particles, steering, rendering, boost physics — ever touches the
network or the database.

```
Phone                                              Server (one Node process)
─────                                              ────────────────────────
Game loop ──► progression engine (local, instant)
                  │
            Local save (SaveManager, storage.js)
                  │ operations (online accounts only)
            SyncManager ── menus / after a race ──► /api/v1/sync ──► progress.js ──► SQLite
                                                        same progression engine, re-validated
```

## Database decision: SQLite (kept), not PostgreSQL

The project already had a real, file-backed database: SQLite through Node's built-in
`node:sqlite`, with versioned migrations, WAL journaling, a Docker volume, graceful shutdown and
tests that run the same engine in memory. For this game it remains the better fit:

- **Workload.** About one write per race per player plus occasional garage actions. SQLite
  handles thousands of such writes per second on one core; the game is far from that.
- **Correctness.** `node:sqlite` is synchronous: each operation's transaction (read state →
  validate → write) runs without interleaving, so purchases can't race each other.
- **Operations.** One container, one volume, zero runtime dependencies (no driver, no separate
  database service to secure, patch and back up). Backups are a file copy of a WAL checkpoint.
- **Same engine everywhere.** Development, CI, staging and production all run the real engine
  (tests use `:memory:`).

When to move to PostgreSQL: more than one API instance (horizontal scaling or zero-downtime
deploys), managed point-in-time recovery, or analytics queries on production data. The schema is
plain SQL (no SQLite-only features except `WITHOUT ROWID`, which is an optional storage hint), the
data access is concentrated in `players.js`, `progress.js`, `races.js`, `leaderboard.js` and
`events.js`, and migrations are ordered SQL scripts — porting means swapping the driver, turning
`INTEGER` timestamps into `BIGINT`, `AUTOINCREMENT` into identity columns, and running the same
migrations. Rate limits (in memory) would then need a shared store too.

Known risk: `node:sqlite` is still marked experimental in Node 24 (it is stable in behaviour and
passes the full test suite, but its API could change on a Node major upgrade). The Docker image
pins the major version (`node:24-alpine`); upgrade Node deliberately, with the tests.

## Schema (migration 3)

| Table | Purpose | Key / notable constraints |
|---|---|---|
| `players` | Account: stable id, public display name, timestamps, `flagged` | PK `id` (random, never the name) |
| `auth_identities` | Ways to sign in: `device` token, one-time `recovery` code; `email`/`google`/`apple` reserved | FK player, `UNIQUE(provider, subject)`, subject = SHA-256 of the secret |
| `cars` | Canonical car catalog (tier, price, level, requirements, upgrade ceiling), upserted from `progression/config.js` at startup | PK `id`, CHECKs on tier/price |
| `player_progress` | Credits, XP, level, selected car, missions + daily (JSON), feats, revision, import/sync timestamps | PK/FK player, `CHECK credits ≥ 0`, FK `selected_car → cars` |
| `player_stats` | Lifetime totals and personal records | PK/FK player |
| `player_cars` | Owned cars, one column per upgrade line, cosmetics per car | PK (player, car), FK car → `cars`, `CHECK 0..5` per line |
| `player_cosmetics` | Cosmetic items bought (usable on every car) | PK (player, item) |
| `player_achievements` | Unlocked achievements with time | PK (player, achievement) |
| `race_results` | Every settled run (online or offline): summary numbers, status, credits/XP paid | `UNIQUE(player, op_id)`, index (player, created_at) |
| `race_sessions` | Server-stamped race starts for ranked runs | index (player, started_at), (status, started_at) |
| `scores` | Ranked runs (leaderboards) | indexes on score, time, (player, score), (player, time) |
| `sync_ops` | Idempotency log of applied/rejected operations | PK (player, op_id), index on time for pruning |
| `events` | Anonymous analytics counts (unchanged) | index (name, time) |

Deliberate simplifications: achievement and mission *definitions* live in code (they are
content, versioned with the client); the three active missions and the daily challenge are small
JSON documents on `player_progress`, always read and written whole. Upgrades are columns rather
than a table because every car has exactly the same six lines.

Indexes follow the actual queries: authentication by `(provider, subject)`, a player's rows by
primary-key prefix, run history by `(player, created_at)`, leaderboards by score and time
(unchanged), idempotency by `(player, op_id)`.

## API (`/api/v1`)

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /players` | — | Create an account (display name) → device token + cloud progress |
| `GET/PATCH/DELETE /players/me` | token | Profile, rename, delete (cascades everything) |
| `POST /auth/recovery-code` | token | One-time transfer code for another phone |
| `POST /auth/recover` | — | Redeem a transfer code → new device token + cloud progress |
| `GET /progress` | token | Canonical progression document + revision |
| `POST /progress/import` | token | One-time guest import (clamped) |
| `POST /sync` | token | Apply up to 60 operations in order → per-op results + document |
| `GET /cars` | — | Public car catalog (secret car stays `???`) |
| `GET /garage` | token | This player's garage: owned / available / locked with requirement progress |
| `POST /garage/purchase` · `/upgrade` · `/select` · `/cosmetic` | token | Single garage operations (same rules as `/sync`) |
| `GET /missions` · `GET /achievements` | token | Server view of missions, daily challenge and achievements |
| `POST /races` | token | Start a ranked session (car must be owned) |
| `POST /races/:id/finish` | token | Finish a session (the same race operation as `/sync`) |
| `GET /leaderboard` | optional | Unchanged |

Mapping to the brief: *profile* = `/players`, *progression* = `/progress`, *race start/finish* =
`/races`, *garage/missions/achievements/leaderboard* as listed.

## Authority, sync and conflicts

- **Guest profile** (default): everything lives in the local save. No account, no network.
- **Online account**: the server's document is canonical. The phone keeps a cache for instant UI
  and offline play.

The phone never uploads its state. Every change is an **operation** with a client-generated
`opId` (purchase, upgrade, select, cosmetic, race). The phone applies it locally at once, queues
it (`SyncManager`, persisted), and flushes the queue between races. The server re-applies each
operation in order with the same engine, inside its own transaction, against its own copy:

- **atomic** — credits and ownership change together or not at all;
- **idempotent** — a retried `opId` returns its first outcome, never applies twice;
- **ordered** — an operation that no longer fits (credits spent on another phone meanwhile) is
  rejected; later ones still apply;
- after a flush the phone **adopts the server document** and re-applies any operations queued
  in the meantime. Newer progress from another phone is therefore never overwritten by a stale
  copy, and a rejected purchase simply disappears (the player gets one notice).

Races: online races carry a server session (start time stamped by the server). Offline races
have none; their total race time must fit in the real time since the account last synced (plus
5 minutes), which stops "I raced for 10 hours in the last 2 minutes".

Guest → online: the first sync after "Go online" imports the local progress once, clamped
(`GUEST_IMPORT`: level ≤ 12, credits ≤ 20,000, upgrades ≤ 3; every owned car must meet its
requirements under the clamped state). After that the account only grows through validated
operations. Accounts from 1.1 get the same one-time import.

Another phone: *Transfer to another phone* issues a one-time code (100 bits, stored hashed). The
new phone redeems it for its own device token and adopts the cloud progress. Email / Google /
Apple sign-in would add providers to `auth_identities` without schema changes elsewhere.

## Offline and network failures

- No server / offline: the game is fully playable; progress is saved locally; the network chip
  says OFFLINE or LOCAL ONLY; nothing blocks or pops errors mid-race.
- Every request has a timeout; only idempotent ones are retried, a bounded number of times.
- A run finishing offline is queued with its opId and sent on the next flush (menus, "online"
  event, next run end). The queue survives restarts (60 operations max).
- Sync never runs during a race (`isBusy`), and never swaps the local document under a race.

## What the server validates

- Accounts: display names (shared validator with the client), rate limits per IP/account.
- Purchases: car exists, requirements met *on the server's copy*, not already owned, enough
  credits — then subtract and add ownership in one transaction. Prices come from config, never
  from the request.
- Upgrades: owned car, line exists, under the car's tier ceiling, driver level gate, credits.
- Cosmetics: exists, level gate, not owned, credits; equip needs ownership.
- Races: shape (types/ranges of every counter), session ownership/expiry/single use, wall-clock
  duration, speed / distance / score / combo / near-miss / overtake / chicane / pickup / police /
  timer ceilings derived from the game's own balance data and the car's upgrade ceiling; offline
  runs bounded by the player's fastest *owned* car and the offline time budget. Rewards are
  computed server-side (with per-run caps); the client's credit numbers are never used.
- Import: clamped, once, only before any cloud progress exists.

What it cannot do: stop a modified client that plays in real time and reports believable numbers
(see README "Anti-cheat"). Rejected runs are logged with the failed check; the client only gets
a generic message.
