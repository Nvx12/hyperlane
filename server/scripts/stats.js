// Operator report from the database: `npm run stats [-- --days 7]`.
// Read-only; safe to run against the live database (SQLite WAL allows concurrent readers).
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

const args = process.argv.slice(2);
const daysArg = args.indexOf('--days');
const days = Math.max(1, Number(daysArg >= 0 ? args[daysArg + 1] : 7) || 7);
const config = loadConfig();

if (config.databasePath === ':memory:' || !existsSync(config.databasePath)) {
  console.error(`No database at ${config.databasePath}`);
  process.exit(1);
}
const db = new DatabaseSync(config.databasePath, { readOnly: true });
const since = Date.now() - days * 86_400_000;
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const fmt = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));

console.log(`\nNight Vector — last ${days} day(s)\n`);

const players = one('SELECT COUNT(*) AS total, SUM(created_at >= ?) AS recent, SUM(last_seen_at >= ?) AS active FROM players', since, since);
console.log(`Players        ${fmt(players.total)} total · ${fmt(players.recent)} new · ${fmt(players.active)} active`);

const sessions = all('SELECT status, COUNT(*) AS n FROM race_sessions WHERE started_at >= ? GROUP BY status', since);
const by = Object.fromEntries(sessions.map(r => [r.status, r.n]));
console.log(`Ranked races   ${fmt(by.accepted || 0)} accepted · ${fmt(by.rejected || 0)} rejected · ${fmt(by.expired || 0)} expired · ${fmt(by.open || 0)} open`);

const reasons = all("SELECT reject_reason AS reason, COUNT(*) AS n FROM race_sessions WHERE status = 'rejected' AND started_at >= ? GROUP BY reason ORDER BY n DESC", since);
if (reasons.length) console.log(`  rejections   ${reasons.map(r => `${r.reason} ${r.n}`).join(' · ')}`);

const runs = one('SELECT COUNT(*) AS n, AVG(score) AS score, AVG(distance_m) AS dist, AVG(duration_ms) AS dur, MAX(score) AS best FROM scores WHERE created_at >= ?', since);
if (runs.n) {
  console.log(`Runs           avg score ${fmt(Math.round(runs.score))} · avg ${(runs.dist / 1000).toFixed(2)} km · avg ${Math.round(runs.dur / 1000)} s · best ${fmt(runs.best)}`);
  const cars = all('SELECT car_id AS car, COUNT(*) AS n FROM scores WHERE created_at >= ? GROUP BY car_id ORDER BY n DESC', since);
  console.log(`  cars         ${cars.map(c => `${c.car} ${c.n}`).join(' · ')}`);
}

const events = all('SELECT name, COUNT(*) AS n, COUNT(DISTINCT client_id) AS clients FROM events WHERE created_at >= ? GROUP BY name ORDER BY n DESC', since);
if (events.length) {
  console.log('\nAnalytics events (count / distinct installs)');
  for (const e of events) console.log(`  ${e.name.padEnd(20)} ${fmt(e.n).padStart(8)} ${fmt(e.clients).padStart(7)}`);
  const daily = all(`SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(DISTINCT client_id) AS n
    FROM events WHERE created_at >= ? GROUP BY day ORDER BY day`, since);
  console.log(`\nDaily active installs  ${daily.map(d => `${d.day.slice(5)}: ${d.n}`).join(' · ')}`);
} else {
  console.log('\nNo analytics events in this period.');
}
console.log('');
db.close();
