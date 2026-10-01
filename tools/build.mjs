// Release builds. The client is plain ES modules with no bundler, so a build is a verified copy:
//   1. versions agree (package.json ↔ client/js/version.js)
//   2. client/ is copied to the output (dotfiles skipped)
//   3. every local file referenced by index.html, the manifest and CSS exists
//   4. build-info.json records version + commit; a size report is printed
//
// Targets:
//   web    `npm run build` → dist/ — served by the Node server, which applies the runtime
//          config (PUBLIC_URL, API_URL, APP_ENV) to the HTML at serve time: one build, any env.
//   native `npm run build:app` → dist-app/ — the Capacitor webDir. Nothing serves the HTML in
//          the app, so the config is baked in at build time from public build variables:
//            NV_APP_ENV     development | staging | production (default production)
//            NV_API_URL     backend origin, e.g. https://api.example.com ('' = offline only)
//            NV_PUBLIC_URL  public web address of the game, for share links ('' = text only)
//          Staging/production refuse http:// and local addresses. No service worker: the app
//          package already contains every file, and a second cache would serve stale code.
//          Everything baked into the app is public — never put secrets in these variables.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'client');
const argTarget = process.argv.find(a => a.startsWith('--target='));
const TARGET = argTarget ? argTarget.slice('--target='.length) : 'web';
if (!['web', 'native'].includes(TARGET)) {
  console.error(`Unknown build target "${TARGET}" (web | native)`);
  process.exit(1);
}
const NATIVE = TARGET === 'native';
const OUT = join(ROOT, NATIVE ? 'dist-app' : 'dist');
const errors = [];

// Native build configuration (public values only — they ship inside the app).
const nativeEnv = {
  appEnv: process.env.NV_APP_ENV || 'production',
  apiUrl: (process.env.NV_API_URL || '').replace(/\/+$/, ''),
  publicUrl: (process.env.NV_PUBLIC_URL || '').replace(/\/+$/, ''),
};
if (NATIVE) {
  const { appEnv } = nativeEnv;
  if (!['development', 'staging', 'production'].includes(appEnv)) errors.push(`NV_APP_ENV must be development, staging or production (got "${appEnv}")`);
  for (const [name, value] of [['NV_API_URL', nativeEnv.apiUrl], ['NV_PUBLIC_URL', nativeEnv.publicUrl]]) {
    if (!value) continue;
    let url;
    try {
      url = new URL(value);
    } catch {
      errors.push(`${name} is not a valid URL: ${value}`);
      continue;
    }
    if (url.pathname !== '/' || url.search || url.hash) errors.push(`${name} must be an origin only (no path/query): ${value}`);
    if (appEnv !== 'development') {
      // On a phone, localhost is the phone itself; release builds must reach a real HTTPS server.
      if (url.protocol !== 'https:') errors.push(`${name} must use https:// for ${appEnv} builds: ${value}`);
      if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/.test(url.hostname)) {
        errors.push(`${name} points at a local address in a ${appEnv} build: ${value}`);
      }
    }
  }
  if (errors.length) {
    // Fail before writing anything: a misconfigured app build must never reach dist-app/.
    console.error(`\nNative build refused:\n  - ${errors.join('\n  - ')}\n`);
    process.exit(1);
  }
}

// 1. versions
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const { GAME_VERSION } = await import(new URL('../client/js/version.js', import.meta.url));
if (pkg.version !== GAME_VERSION) errors.push(`version mismatch: package.json ${pkg.version} vs client/js/version.js ${GAME_VERSION}`);

// 2. copy
rmSync(OUT, { recursive: true, force: true });
cpSync(SRC, OUT, { recursive: true, filter: src => !relative(SRC, src).split(sep).some(p => p.startsWith('.')) });

// 3. references
const exists = rel => existsSync(join(OUT, rel.split('?')[0]));
const html = readFileSync(join(OUT, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^(https?:|data:|#|mailto:|__PUBLIC_URL__)/.test(ref) || ref === './') continue;
  if (!exists(ref)) errors.push(`index.html references missing file: ${ref}`);
}
const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.webmanifest'), 'utf8'));
for (const icon of [...manifest.icons, ...(manifest.screenshots || [])]) {
  if (!exists(icon.src)) errors.push(`manifest references missing file: ${icon.src}`);
}
for (const css of ['css/fonts.css', 'css/style.css', 'css/menus.css']) {
  const text = readFileSync(join(OUT, css), 'utf8');
  for (const m of text.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
    if (m[1].startsWith('data:') || m[1].startsWith('#')) continue; // inline data / SVG fragment
    if (!existsSync(join(OUT, dirname(css), m[1]))) errors.push(`${css} references missing file: ${m[1]}`);
  }
}
for (const required of ['sw.js', 'js/main.js', 'js/boot.js', 'og-image.jpg']) if (!exists(required)) errors.push(`missing ${required}`);
if (NATIVE) {
  // Config baked into the HTML (escaped like the server does), and no service worker.
  const { transformHtml } = await import(new URL('../server/src/htmlTransform.js', import.meta.url));
  writeFileSync(join(OUT, 'index.html'), transformHtml(html, nativeEnv));
  rmSync(join(OUT, 'sw.js'), { force: true });
  if (/__(API_URL|APP_ENV|PUBLIC_URL)__/.test(readFileSync(join(OUT, 'index.html'), 'utf8'))) errors.push('unreplaced config placeholder in index.html');
}
if (/\bdebugger\b/.test(readdirSync(join(OUT, 'js'), { recursive: true }).filter(f => f.endsWith('.js')).map(f => readFileSync(join(OUT, 'js', f), 'utf8')).join('\n'))) {
  errors.push('a `debugger` statement is present in client code');
}

if (errors.length) {
  console.error(`\nBuild failed:\n  - ${errors.join('\n  - ')}\n`);
  process.exit(1);
}

// 4. build info + size report
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout (e.g. Docker build context) */
}
const info = { version: pkg.version, commit, builtAt: new Date().toISOString(), target: TARGET };
if (NATIVE) Object.assign(info, { appEnv: nativeEnv.appEnv, apiUrl: nativeEnv.apiUrl || null, publicUrl: nativeEnv.publicUrl || null });
writeFileSync(join(OUT, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);

const walk = dir => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const files = walk(OUT);
let raw = 0;
let gz = 0;
const byType = {};
for (const f of files) {
  const data = readFileSync(f);
  const ext = f.split('.').pop();
  const g = /^(js|css|html|webmanifest|svg|json|txt)$/.test(ext) ? gzipSync(data, { level: 9 }).length : data.length;
  raw += data.length;
  gz += g;
  byType[ext] = (byType[ext] || 0) + g;
}
const kb = n => `${(n / 1024).toFixed(1)} KB`;
console.log(`\nNight Vector ${pkg.version} (${commit}) → ${NATIVE ? 'dist-app/' : 'dist/'}${NATIVE ? ` · native · ${nativeEnv.appEnv} · API ${nativeEnv.apiUrl || 'none (offline only)'}` : ''}`);
console.log(`  ${files.length} files · ${kb(raw)} raw · ${kb(gz)} over the wire (gzip; brotli is smaller)`);
console.log(`  ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${kb(n)}`).join(' · ')}\n`);
