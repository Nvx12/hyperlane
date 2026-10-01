// Generates the SOURCE images for the native app icon and splash screen from the logo
// (tools/brand.mjs), with headless Chromium:
//   resources/icon-only.png        1024×1024  full icon (iOS, legacy Android)
//   resources/icon-foreground.png  1024×1024  adaptive-icon foreground (art inside the safe zone)
//   resources/icon-background.png  1024×1024  adaptive-icon background (night sky)
//   resources/splash.png           2732×2732  splash: logo + wordmark centred on the game's background
//   resources/splash-dark.png      2732×2732  same (the game is always dark)
// Then every Android/iOS size is produced by Capacitor's official tool (capacitor-assets), and
// the Android adaptive icon is set to use the foreground as drawn (no extra inset: the art is
// already inside the mask safe zone). Run:  npm run assets:native
// To use final artwork instead: replace these five PNGs (same names and sizes) and run
//   node tools/generate-native-assets.mjs --keep-sources
import { createServer } from 'node:http';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { loadConfig } from '../server/src/config.js';
import { createLogger } from '../server/src/logger.js';
import { createApp } from '../server/src/app.js';
import { iconSvg } from './brand.mjs';

const config = loadConfig({ APP_ENV: 'development', STATIC_DIR: 'client', PORT: '0' });
const OUT = resolve(config.root, 'resources');
const BG = '#06030d';
const RES = resolve(config.root, 'android', 'app', 'src', 'main', 'res');
const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<!-- Night Vector adaptive icon: the foreground is rendered with the logo inside the mask safe
     zone (tools/generate-native-assets.mjs), so no extra inset is applied here. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;

// capacitor-assets → every icon/splash size for Android and iOS, then the Android touch-ups.
async function generatePlatformAssets() {
  const args = ['capacitor-assets', 'generate', '--android', '--ios', '--assetPath', 'resources',
    '--iconBackgroundColor', BG, '--iconBackgroundColorDark', BG, '--splashBackgroundColor', BG, '--splashBackgroundColorDark', BG];
  const r = spawnSync('npx', args, { cwd: config.root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('capacitor-assets failed');
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) await writeFile(resolve(RES, 'mipmap-anydpi-v26', name), ADAPTIVE);
  // Capacitor's default launcher artwork must never ship.
  await rm(resolve(RES, 'drawable-v24'), { recursive: true, force: true });
  await rm(resolve(RES, 'drawable', 'ic_launcher_background.xml'), { force: true });
  console.log('android + ios icons and splash screens generated');
}

const page = (svg, bg = 'transparent') => `<!doctype html><html><head><style>html,body{margin:0;background:${bg}}svg{display:block;width:100vw;height:100vh}</style></head><body>${svg}</body></html>`;

async function main() {
  await mkdir(OUT, { recursive: true });
  if (process.argv.includes('--keep-sources')) {
    await generatePlatformAssets();
    return;
  }
  // Served from the game's origin so the splash wordmark uses the game's own fonts.
  const server = createServer(createApp({ config, log: createLogger({ level: 'warn' }), version: 'assets' }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const shots = [
      ['icon-only.png', iconSvg({ rounded: false }), BG],
      // Adaptive icons are masked to a circle/squircle showing ~61% of the canvas: art at 0.6.
      ['icon-foreground.png', iconSvg({ rounded: false, scale: 0.6 }), BG],
      ['icon-background.png', iconSvg({ rounded: false, scale: 0.0001 }), BG],
    ];
    for (const [name, svg, bg] of shots) {
      const p = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
      await p.setContent(page(svg, bg));
      await p.screenshot({ path: resolve(OUT, name), omitBackground: bg === 'transparent' });
      await p.close();
    }

    // Splash: square so it can be cropped to any screen (portrait or landscape) — keep the
    // content in the central ~1200 px.
    const html = `<!doctype html><html><head><link rel="stylesheet" href="css/fonts.css"><style>
      html,body{margin:0;width:2732px;height:2732px;background:${BG};overflow:hidden}
      .c{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;font-family:Orbitron,sans-serif}
      .mark{width:420px;height:420px;margin:0 auto 54px}.mark svg{width:100%;height:100%}
      .top{font-weight:700;font-size:64px;letter-spacing:.72em;padding-left:.72em;color:#22e6ff;text-shadow:0 0 24px rgba(34,230,255,.7)}
      .main{display:inline-block;margin-top:6px;font-weight:900;font-style:italic;font-size:190px;line-height:1;transform:skewX(-9deg);background:linear-gradient(180deg,#fff 8%,#ffb3dc 42%,#ff2d95 60%,#7a1cff 100%);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 0 30px rgba(255,45,149,.6))}
      </style></head><body><div class="c"><div class="mark">${iconSvg()}</div><div class="top">NIGHT</div><div class="main">VECTOR</div></div></body></html>`;
    const p = await browser.newPage({ viewport: { width: 2732, height: 2732 } });
    await p.route(`${base}/__splash.html`, route => route.fulfill({ contentType: 'text/html', body: html }));
    await p.goto(`${base}/__splash.html`);
    await p.evaluate(() => document.fonts.ready);
    for (const name of ['splash.png', 'splash-dark.png']) await p.screenshot({ path: resolve(OUT, name) });
    await p.close();
    console.log('native asset sources written: resources/*.png');
  } finally {
    await browser.close();
    server.close();
  }
  await generatePlatformAssets();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
