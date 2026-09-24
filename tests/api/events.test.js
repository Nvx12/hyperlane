import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/server.js';

const batch = events => ({ clientId: 'abcdefghijklmnop', appVersion: '1.0.0', events });
const rows = srv => srv.api.db.prepare('SELECT name, client_id, props FROM events ORDER BY id').all();

test('stores whitelisted events with clean props, drops the rest', async () => {
  const srv = await startTestServer();
  try {
    const r = await srv.call('POST', '/api/v1/events', {
      body: batch([
        { name: 'race_end', props: { car: 'vireo', km: 3.456, wrecked: true } },
        { name: 'not_an_event' },
        { name: 'share', props: { result: '<script>' } }, // disallowed characters
        { name: 'share', props: { nested: { a: 1 } } }, // non-flat
        { name: 'session_start' },
      ]),
    });
    assert.equal(r.status, 204);
    const stored = rows(srv);
    assert.deepEqual(stored.map(e => e.name), ['race_end', 'session_start']);
    assert.deepEqual(JSON.parse(stored[0].props), { car: 'vireo', km: 3.46, wrecked: true });
    const columns = srv.api.db.prepare('PRAGMA table_info(events)').all().map(c => c.name);
    assert.ok(!columns.some(c => /ip|agent|player/.test(c)), 'no IP / user agent / player columns');
  } finally {
    await srv.close();
  }
});

test('accepts sendBeacon text/plain batches', async () => {
  const srv = await startTestServer();
  try {
    const r = await srv.call('POST', '/api/v1/events', { raw: JSON.stringify(batch([{ name: 'race_start' }])), headers: { 'content-type': 'text/plain;charset=UTF-8' } });
    assert.equal(r.status, 204);
    assert.equal(rows(srv).length, 1);
  } finally {
    await srv.close();
  }
});

test('rejects malformed batches and oversize batches', async () => {
  const srv = await startTestServer();
  try {
    assert.equal((await srv.call('POST', '/api/v1/events', { body: { events: [] } })).status, 422);
    assert.equal((await srv.call('POST', '/api/v1/events', { body: { ...batch([]), clientId: 'short' } })).status, 422);
    const many = Array.from({ length: 30 }, () => ({ name: 'race_start' }));
    assert.equal((await srv.call('POST', '/api/v1/events', { body: batch(many) })).status, 422);
  } finally {
    await srv.close();
  }
});

test('operator switch: ANALYTICS_ENABLED=false stores nothing and says so in /status', async () => {
  const srv = await startTestServer({ ANALYTICS_ENABLED: 'false' });
  try {
    const status = await srv.call('GET', '/api/v1/status');
    assert.equal(status.json.features.analytics, false);
    assert.equal((await srv.call('POST', '/api/v1/events', { body: batch([{ name: 'race_start' }]) })).status, 204);
    assert.equal(rows(srv).length, 0);
  } finally {
    await srv.close();
  }
});

test('old events are pruned after the retention period', async () => {
  const srv = await startTestServer();
  try {
    await srv.call('POST', '/api/v1/events', { body: batch([{ name: 'race_start' }]) });
    srv.advance(91 * 86_400_000);
    await srv.call('POST', '/api/v1/events', { body: batch([{ name: 'race_end' }]) });
    assert.deepEqual(rows(srv).map(e => e.name), ['race_end']);
  } finally {
    await srv.close();
  }
});
