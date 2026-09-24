// Runtime configuration injected into index.html by the server / build (meta tags).
// Unreplaced placeholders mean "defaults": same-origin API, development environment.
const meta = name => {
  const el = document.querySelector(`meta[name="${name}"]`);
  const v = el ? el.getAttribute('content') : '';
  return v && !v.startsWith('__') ? v : '';
};

const apiUrl = meta('nv-api-url').replace(/\/+$/, '');
const appEnv = meta('nv-env') || 'development';

export const ENV = Object.freeze({
  apiBase: `${apiUrl}/api`, // '' → same origin
  appEnv,
  isProduction: appEnv === 'production',
});
