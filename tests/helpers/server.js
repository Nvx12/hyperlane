import { createServer } from 'node:http';
import { loadConfig } from '../../server/src/config.js';
import { createApp } from '../../server/src/app.js';
import { createApi } from '../../server/src/api/index.js';

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

// Boots the real app on an ephemeral port with an in-memory database and a controllable clock.
export async function startTestServer(overrides = {}) {
  const clock = { t: Date.UTC(2026, 8, 24, 12, 0, 0) };
  const now = () => clock.t;
  const config = loadConfig({ APP_ENV: 'test', DATABASE_PATH: ':memory:', SESSION_SECRET: 'test-secret-'.padEnd(64, 'x'), ...overrides });
  const api = await createApi({ config, log: silentLog, version: '0.0.0-test', now });
  const server = createServer(createApp({ config, log: silentLog, api, version: '0.0.0-test' }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { body, token, headers = {}, raw } = {}) {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.authorization = `Bearer ${token}`;
    if (raw !== undefined) {
      init.body = raw;
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = init.headers['content-type'] || 'application/json';
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text };
  }

  return {
    base,
    api,
    clock,
    call,
    advance(ms) {
      clock.t += ms;
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
      api.close();
    },
  };
}
