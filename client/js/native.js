// The native-shell seam (Capacitor). The Android/iOS app injects `window.Capacitor` (its
// native bridge); in a browser it doesn't exist and every function here is a harmless no-op.
// Nothing else in the game talks to Capacitor directly.
//
// Calls go straight through the bridge (`nativePromise` / `nativeCallback`, the same calls
// @capacitor/core makes internally), so the game stays bundler-free and the same files run in
// the browser, the PWA, bundled native builds and live reload.
//
// Rule: only event-driven calls cross the bridge (lifecycle, back button, network, haptics,
// save mirroring). Never per-frame data — the game loop stays entirely in JavaScript.

const cap = () => globalThis.Capacitor;

export function isNative() {
  const c = cap();
  try {
    return Boolean(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
  } catch {
    return false;
  }
}

export const platform = () => (isNative() ? cap().getPlatform() : 'web');

// A plugin is usable when the native app ships it (its header is registered by the bridge).
export function hasPlugin(name) {
  if (!isNative()) return false;
  const headers = cap().PluginHeaders;
  return Array.isArray(headers) && headers.some(h => h.name === name);
}

// Calls a native plugin method. Resolves to the result, or null when unavailable/failed:
// native features are enhancements and must never break the game.
export function call(plugin, method, options = {}) {
  if (!hasPlugin(plugin)) return Promise.resolve(null);
  try {
    return Promise.resolve(cap().nativePromise(plugin, method, options)).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

// Subscribes to a native plugin event once (listeners are added at startup, never per run).
export function listen(plugin, eventName, fn) {
  if (!hasPlugin(plugin)) return false;
  try {
    cap().nativeCallback(plugin, 'addListener', { eventName }, data => {
      try {
        fn(data || {});
      } catch {
        /* a listener error must not reach the bridge */
      }
    });
    return true;
  } catch {
    return false;
  }
}
