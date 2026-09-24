/* Night Vector service worker.
   precache-manifest.js defines self.__NV_PRECACHE = { version, hash, files }. It is generated
   (dev server on the fly, production build as a file), so any content change produces a new
   cache name and a new worker. The new worker waits until the player accepts the update. */
importScripts('precache-manifest.js');

const PRECACHE = self.__NV_PRECACHE;
const CACHE = 'nv-' + PRECACHE.version + '-' + PRECACHE.hash;
const SHELL = 'index.html';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // cache: 'reload' bypasses the HTTP cache so we never precache a stale file.
      return cache.addAll(PRECACHE.files.map(function (f) { return new Request(f, { cache: 'reload' }); }));
    })
  );
  // No skipWaiting() here: an update activates only when the page asks (see js/pwa.js),
  // so a running race is never swapped out from under the player.
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf('nv-') === 0 && key !== CACHE) return caches.delete(key);
        return undefined;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Online-only endpoints are never cached: the game shows OFFLINE instead of stale data.
  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/health') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(SHELL).then(function (hit) {
          return hit || fetch(req);
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(req);
      });
    })
  );
});
