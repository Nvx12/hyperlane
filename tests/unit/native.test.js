import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isNative, platform, hasPlugin, call, listen } from '../../client/js/native.js';
import { writeText, readText, remove, restoreFromNative, KEYS } from '../../client/js/storage.js';

// A minimal stand-in for the bridge the Android/iOS shell injects as window.Capacitor.
function mockBridge(plugins = ['App', 'Preferences']) {
  const calls = [];
  const listeners = {};
  const prefs = {};
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    PluginHeaders: plugins.map(name => ({ name, methods: [] })),
    nativePromise: (plugin, method, options) => {
      calls.push([plugin, method, options]);
      if (plugin === 'Preferences' && method === 'set') prefs[options.key] = options.value;
      if (plugin === 'Preferences' && method === 'remove') delete prefs[options.key];
      if (plugin === 'Preferences' && method === 'get') return Promise.resolve({ value: prefs[options.key] ?? null });
      return Promise.resolve({ ok: true });
    },
    nativeCallback: (plugin, method, options, cb) => {
      listeners[`${plugin}.${options.eventName}`] = cb;
      return 'id';
    },
  };
  return { calls, listeners, prefs };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() };
}

beforeEach(() => {
  delete globalThis.Capacitor;
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
});
afterEach(() => {
  delete globalThis.Capacitor;
});

test('in a browser every native call is a harmless no-op', async () => {
  assert.equal(isNative(), false);
  assert.equal(platform(), 'web');
  assert.equal(hasPlugin('App'), false);
  assert.equal(await call('Haptics', 'impact', { style: 'LIGHT' }), null);
  assert.equal(listen('App', 'pause', () => {}), false);
});

test('in the app, calls and listeners go through the bridge; missing plugins resolve to null', async () => {
  const bridge = mockBridge(['App']);
  assert.equal(isNative(), true);
  assert.equal(platform(), 'android');
  assert.deepEqual(await call('App', 'minimizeApp'), { ok: true });
  assert.equal(await call('Haptics', 'impact', {}), null, 'plugin not shipped');
  let fired = null;
  assert.equal(listen('App', 'pause', d => (fired = d)), true);
  bridge.listeners['App.pause']({ a: 1 });
  assert.deepEqual(fired, { a: 1 });
  // A throwing listener never reaches the bridge.
  listen('App', 'resume', () => {
    throw new Error('boom');
  });
  assert.doesNotThrow(() => bridge.listeners['App.resume']({}));
});

test('storage: native writes are mirrored to Preferences and restored if WebView storage is wiped', async () => {
  const bridge = mockBridge();
  writeText(KEYS.save, '{"v":3}');
  writeText(KEYS.ghost, '[1,2,3]');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(bridge.prefs[KEYS.save], '{"v":3}');
  remove(KEYS.ghost);
  assert.equal(bridge.prefs[KEYS.ghost], undefined);
  globalThis.localStorage.clear(); // evicted by the OS
  writeText(KEYS.account, 'newer-local'); // present locally: must not be overwritten
  bridge.prefs[KEYS.account] = 'older-mirror';
  const restored = await restoreFromNative();
  assert.equal(restored, 1);
  assert.equal(readText(KEYS.save), '{"v":3}');
  assert.equal(readText(KEYS.account), 'newer-local');
});

test('storage on the web never touches the bridge', async () => {
  writeText(KEYS.save, 'x');
  assert.equal(readText(KEYS.save), 'x');
  assert.equal(await restoreFromNative(), 0);
});

test('native production builds refuse local or plain-http servers before writing anything', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  for (const [env, why] of [
    [{ NV_API_URL: 'http://192.168.1.20:8080' }, 'https'],
    [{ NV_API_URL: 'https://localhost' }, 'local address'],
    [{ NV_APP_ENV: 'staging', NV_API_URL: 'https://api.example.org/v1' }, 'origin only'],
    [{ NV_APP_ENV: 'qa' }, 'NV_APP_ENV'],
  ]) {
    const r = spawnSync(process.execPath, ['tools/build.mjs', '--target=native'], { cwd: root, env: { ...process.env, NV_APP_ENV: 'production', ...env }, encoding: 'utf8' });
    assert.equal(r.status, 1, JSON.stringify(env));
    assert.match(r.stderr, new RegExp(why), JSON.stringify(env));
  }
});
