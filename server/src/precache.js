import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

// Files the game needs to run offline. Everything else (licenses, the social preview image,
// the service worker itself) is fetched normally.
const INCLUDE = /\.(html|js|css|webmanifest|woff2|png|svg|mp3|m4a|ogg|wav)$/i;
const EXCLUDE = new Set(['sw.js', 'precache-manifest.js']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

// Returns { version, hash, files } — hash covers every precached byte, so any change to any
// shipped file yields a new cache name.
export async function buildPrecache(staticDir, version, transform = null) {
  const files = (await walk(staticDir))
    .map(f => relative(staticDir, f).split(sep).join('/'))
    .filter(f => INCLUDE.test(f) && !EXCLUDE.has(f))
    .sort();
  const hash = createHash('sha256');
  for (const f of files) {
    let data = await readFile(join(staticDir, f));
    if (transform && f.endsWith('.html')) data = Buffer.from(transform(data.toString('utf8')));
    hash.update(f).update(data);
  }
  return { version, hash: hash.digest('hex').slice(0, 12), files };
}

export function precacheScript(manifest) {
  return `self.__NV_PRECACHE = ${JSON.stringify(manifest)};\n`;
}
