import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Schema migrations, applied in order and recorded in schema_migrations. Never edit a
// shipped migration — append a new one.
export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE players (
        id              TEXT PRIMARY KEY,
        display_name    TEXT NOT NULL,
        token_hash      TEXT NOT NULL UNIQUE,
        created_at      INTEGER NOT NULL,
        last_seen_at    INTEGER NOT NULL,
        name_changed_at INTEGER NOT NULL,
        races           INTEGER NOT NULL DEFAULT 0,
        flagged         INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE race_sessions (
        id             TEXT PRIMARY KEY,
        player_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        car_id         TEXT NOT NULL,
        env_id         TEXT NOT NULL,
        client_version TEXT NOT NULL,
        started_at     INTEGER NOT NULL,
        finished_at    INTEGER,
        status         TEXT NOT NULL DEFAULT 'open', -- open | accepted | rejected | expired
        reject_reason  TEXT
      );
      CREATE INDEX race_sessions_player ON race_sessions(player_id, started_at);
      CREATE INDEX race_sessions_open ON race_sessions(status, started_at);

      CREATE TABLE scores (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id    TEXT NOT NULL UNIQUE REFERENCES race_sessions(id) ON DELETE CASCADE,
        player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        score         INTEGER NOT NULL,
        distance_m    INTEGER NOT NULL,
        top_speed_kmh INTEGER NOT NULL,
        best_combo    INTEGER NOT NULL,
        duration_ms   INTEGER NOT NULL,
        car_id        TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX scores_time ON scores(created_at);
      CREATE INDEX scores_player ON scores(player_id, score);
      CREATE INDEX scores_score ON scores(score);

      CREATE TABLE events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        client_id   TEXT NOT NULL,   -- random per-install id, not linked to the player profile
        props       TEXT,
        app_version TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX events_name_time ON events(name, created_at);
    `,
  },
  {
    version: 2,
    name: 'idempotent race finish',
    sql: `
      ALTER TABLE race_sessions ADD COLUMN result_hash TEXT;
      CREATE INDEX scores_player_time ON scores(player_id, created_at);
    `,
  },
  {
    version: 3,
    name: 'accounts, cloud progression, garage, race results',
    // Rebuilding `players` must not cascade-delete its children, so foreign keys are off for
    // this migration (SQLite's documented table-rebuild procedure) and checked afterwards.
    foreignKeysOff: true,
    sql: `
      -- Ways to sign in to a profile. 'device' is the bearer token a phone holds, 'recovery' a
      -- one-time transfer code; email / google / apple are reserved for later. Secrets are
      -- stored only as SHA-256 hashes (subject).
      CREATE TABLE auth_identities (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        provider     TEXT NOT NULL CHECK (provider IN ('device', 'recovery', 'email', 'google', 'apple')),
        subject      TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER,
        UNIQUE (provider, subject)
      );
      CREATE INDEX auth_identities_player ON auth_identities(player_id, provider);
      INSERT INTO auth_identities (player_id, provider, subject, created_at)
        SELECT id, 'device', token_hash, created_at FROM players;

      -- players loses token_hash (now in auth_identities). The id is the stable identity;
      -- display_name can change freely.
      CREATE TABLE players_new (
        id              TEXT PRIMARY KEY,
        display_name    TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        last_seen_at    INTEGER NOT NULL,
        name_changed_at INTEGER NOT NULL,
        races           INTEGER NOT NULL DEFAULT 0,
        flagged         INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO players_new (id, display_name, created_at, last_seen_at, name_changed_at, races, flagged)
        SELECT id, display_name, created_at, last_seen_at, name_changed_at, races, flagged FROM players;
      DROP TABLE players;
      ALTER TABLE players_new RENAME TO players;

      -- Canonical car catalog (upserted from progression/config.js at startup), so balancing
      -- data lives server-side and player_cars can reference it.
      CREATE TABLE cars (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        tier            INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
        price           INTEGER NOT NULL CHECK (price >= 0),
        level_required  INTEGER NOT NULL CHECK (level_required >= 1),
        requirements    TEXT NOT NULL,  -- JSON array, see CAR_PROGRESSION
        upgrade_ceiling INTEGER NOT NULL CHECK (upgrade_ceiling BETWEEN 0 AND 5),
        legendary       INTEGER NOT NULL DEFAULT 0,
        sort_order      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );

      -- One row per online player: the authoritative economy. Missions and the daily
      -- challenge are small, always read and written whole, so they are JSON documents.
      CREATE TABLE player_progress (
        player_id    TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        credits      INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
        xp           INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
        level        INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
        selected_car TEXT NOT NULL DEFAULT 'vireo' REFERENCES cars(id),
        missions     TEXT NOT NULL,
        daily        TEXT NOT NULL,
        feats        TEXT NOT NULL DEFAULT '{}',
        seen_unlocks TEXT NOT NULL DEFAULT '[]',
        revision     INTEGER NOT NULL DEFAULT 0,   -- bumped by every applied change
        imported_at  INTEGER,                      -- guest progress imported (once)
        last_sync_at INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );

      -- Lifetime statistics and personal records (one row per player).
      CREATE TABLE player_stats (
        player_id           TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        races               INTEGER NOT NULL DEFAULT 0,
        distance_m          REAL NOT NULL DEFAULT 0,
        play_time_s         REAL NOT NULL DEFAULT 0,
        overtakes           INTEGER NOT NULL DEFAULT 0,
        near_misses         INTEGER NOT NULL DEFAULT 0,
        insane_misses       INTEGER NOT NULL DEFAULT 0,
        perfect_overtakes   INTEGER NOT NULL DEFAULT 0,
        crashes             INTEGER NOT NULL DEFAULT 0,
        boost_time_s        REAL NOT NULL DEFAULT 0,
        police_escapes      INTEGER NOT NULL DEFAULT 0,
        pickups             INTEGER NOT NULL DEFAULT 0,
        chicanes            INTEGER NOT NULL DEFAULT 0,
        legend_passes       INTEGER NOT NULL DEFAULT 0,
        missions_completed  INTEGER NOT NULL DEFAULT 0,
        dailies_completed   INTEGER NOT NULL DEFAULT 0,
        credits_earned      INTEGER NOT NULL DEFAULT 0,
        car_distance        TEXT NOT NULL DEFAULT '{}',
        best_score          INTEGER NOT NULL DEFAULT 0,
        best_distance_m     REAL NOT NULL DEFAULT 0,
        best_top_speed      REAL NOT NULL DEFAULT 0,
        best_combo          INTEGER NOT NULL DEFAULT 1,
        best_near_misses    INTEGER NOT NULL DEFAULT 0,
        best_overtakes      INTEGER NOT NULL DEFAULT 0,
        best_chase          INTEGER NOT NULL DEFAULT 0,
        best_clean_distance REAL NOT NULL DEFAULT 0
      );

      -- Owned cars with their upgrade levels (one column per upgrade line) and cosmetics.
      CREATE TABLE player_cars (
        player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        car_id      TEXT NOT NULL REFERENCES cars(id),
        engine      INTEGER NOT NULL DEFAULT 0 CHECK (engine BETWEEN 0 AND 5),
        turbo       INTEGER NOT NULL DEFAULT 0 CHECK (turbo BETWEEN 0 AND 5),
        tires       INTEGER NOT NULL DEFAULT 0 CHECK (tires BETWEEN 0 AND 5),
        brakes      INTEGER NOT NULL DEFAULT 0 CHECK (brakes BETWEEN 0 AND 5),
        nitro       INTEGER NOT NULL DEFAULT 0 CHECK (nitro BETWEEN 0 AND 5),
        armor       INTEGER NOT NULL DEFAULT 0 CHECK (armor BETWEEN 0 AND 5),
        custom      TEXT NOT NULL DEFAULT '{}',
        acquired_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, car_id)
      ) WITHOUT ROWID;

      CREATE TABLE player_cosmetics (
        player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        item        TEXT NOT NULL,  -- 'slot:id'
        acquired_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, item)
      ) WITHOUT ROWID;

      CREATE TABLE player_achievements (
        player_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        achievement_id TEXT NOT NULL,
        unlocked_at    INTEGER NOT NULL,
        PRIMARY KEY (player_id, achievement_id)
      ) WITHOUT ROWID;

      -- Every settled run (online sessions and offline runs synced later), with what it paid.
      -- Summaries only — never frame data. Ranked runs also get a row in \`scores\`.
      CREATE TABLE race_results (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id         TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        op_id             TEXT NOT NULL,
        session_id        TEXT REFERENCES race_sessions(id) ON DELETE SET NULL,
        source            TEXT NOT NULL CHECK (source IN ('online', 'offline')),
        car_id            TEXT NOT NULL,
        env_id            TEXT NOT NULL,
        score             INTEGER NOT NULL,
        distance_m        REAL NOT NULL,
        duration_ms       INTEGER NOT NULL,
        top_speed_kmh     REAL NOT NULL,
        best_combo        INTEGER NOT NULL,
        near_misses       INTEGER NOT NULL,
        overtakes         INTEGER NOT NULL,
        perfect_overtakes INTEGER NOT NULL,
        details           TEXT NOT NULL,  -- JSON: the remaining counters
        status            TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
        reject_reason     TEXT,
        credits_awarded   INTEGER NOT NULL DEFAULT 0,
        xp_awarded        INTEGER NOT NULL DEFAULT 0,
        created_at        INTEGER NOT NULL,
        UNIQUE (player_id, op_id)
      );
      CREATE INDEX race_results_player_time ON race_results(player_id, created_at);

      -- Idempotency log: a retried operation (same op_id) returns its first outcome and is
      -- never applied twice. Old rows can be pruned by time.
      CREATE TABLE sync_ops (
        player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        op_id      TEXT NOT NULL,
        type       TEXT NOT NULL,
        status     TEXT NOT NULL CHECK (status IN ('applied', 'rejected')),
        code       TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, op_id)
      ) WITHOUT ROWID;
      CREATE INDEX sync_ops_time ON sync_ops(created_at);
    `,
  },
  {
    version: 4,
    name: 'pursuit records: highest heat escaped, rivals beaten',
    sql: `
      ALTER TABLE player_stats ADD COLUMN rivals_beaten INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE player_stats ADD COLUMN best_heat INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;');
  }
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    // PRAGMA foreign_keys can't change inside a transaction, so toggle it around it.
    if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      if (m.foreignKeysOff) {
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`foreign key check failed (${broken.length} rows)`);
      }
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${err.message}`, { cause: err });
    } finally {
      if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = ON;');
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
