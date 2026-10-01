// Runtime configuration injected into index.html by the server / build (meta tags).
// Unreplaced placeholders mean "defaults": same-origin API, development environment.
const meta = name => {
  const el = typeof document === 'undefined' ? null : document.querySelector(`meta[name="${name}"]`); // null in Node (unit tests)
  const v = el ? el.getAttribute('content') : '';
  return v && !v.startsWith('__') ? v : '';
};

const apiUrl = meta('nv-api-url').replace(/\/+$/, '');
const publicUrl = meta('nv-public-url').replace(/\/+$/, '');
const appEnv = meta('nv-env') || 'development';

export const ENV = Object.freeze({
  apiBase: `${apiUrl}/api`, // '' → same origin
  apiConfigured: Boolean(apiUrl),
  publicUrl, // the game's public web address ('' = unknown): used for share links in the native app
  appEnv,
  isProduction: appEnv === 'production',
});
