// Release build: `npm run build` → dist/
// The client is plain ES modules with no bundler, so the build is a verified copy:
//   1. versions agree (package.json ↔ client/js/version.js)
//   2. client/ is copied to dist/ (dotfiles skipped)
//   3. every local file referenced by index.html, the manifest and CSS exists
//   4. build-info.json records version + commit; a size report is printed
// Runtime config (PUBLIC_URL, API_URL, APP_ENV) is applied to the HTML by the server at
// serve time, so one build runs in any environment.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'client');
const OUT = join(ROOT, 'dist');
const errors = [];

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
writeFileSync(join(OUT, 'build-info.json'), `${JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString() }, null, 2)}\n`);

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
console.log(`\nNight Vector ${pkg.version} (${commit}) → dist/`);
console.log(`  ${files.length} files · ${kb(raw)} raw · ${kb(gz)} over the wire (gzip; brotli is smaller)`);
console.log(`  ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${kb(n)}`).join(' · ')}\n`);
