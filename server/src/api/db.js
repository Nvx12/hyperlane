import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Schema migrations, applied in order and recorded in schema_migrations. Never edit a
// shipped migration — append a new one.
const MIGRATIONS = [
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
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${err.message}`, { cause: err });
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
