// Generates the PWA icons and the social preview image from HTML/SVG using headless Chromium.
// Run after changing the logo or visuals:  npm run assets
// Output: client/icons/*.png, client/icons/favicon.svg, client/og-image.jpg
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { loadConfig } from '../server/src/config.js';
import { createLogger } from '../server/src/logger.js';
import { createApp } from '../server/src/app.js';
import { iconSvg } from './brand.mjs';

const config = loadConfig({ APP_ENV: 'development', STATIC_DIR: 'client', PORT: '0' });
const ICONS = resolve(config.root, 'client', 'icons');

const page = svg => `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style></head><body>${svg}</body></html>`;

async function main() {
  await mkdir(ICONS, { recursive: true });
  const server = createServer(createApp({ config, log: createLogger({ level: 'warn' }), version: 'assets' }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await writeFile(resolve(ICONS, 'favicon.svg'), iconSvg());
    const icons = [
      ['icon-192.png', 192, {}],
      ['icon-512.png', 512, {}],
      ['apple-touch-icon.png', 180, { rounded: false }],
      ['maskable-512.png', 512, { padded: true, rounded: false }],
    ];
    for (const [name, size, opts] of icons) {
      const p = await browser.newPage({ viewport: { width: size, height: size } });
      await p.setContent(page(iconSvg(opts)));
      await p.screenshot({ path: resolve(ICONS, name), omitBackground: true });
      await p.close();
    }

    // Social preview: a real race frame from the game, with the logo on top.
    const game = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await game.goto(`${base}/?debug`);
    await game.waitForFunction(() => window.nightVector && window.nightVector.state === 'menu');
    const frame = await game.evaluate(async () => {
      const g = window.nightVector;
      g.selectedEnv = 'neon';
      g.startRace();
      g.countdown = 0.01;
      g.hideIntro();
      g.weather.type = 'clear';
      g.weather.rain = 0;
      g.weather.fog = 0;
      for (let i = 0; i < 420; i++) {
        g.player.invulnerable = 1;
        g.player.x = 3.4; // keep the car clear of the logo on the left
        g.input.keys.throttle = true;
        g.input.keys.boost = i > 300;
        g.update(1 / 60);
      }
      g.player.invulnerable = 0; // don't catch the car mid "hit blink"
      g.render();
      document.getElementById('hud').style.display = 'none';
      return g.canvas.toDataURL('image/jpeg', 0.9);
    });
    await game.close();

    const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    // Served from the game's origin (via request interception) so the self-hosted fonts load.
    const ogHtml = `<!doctype html><html><head>
      <link rel="stylesheet" href="css/fonts.css"><style>
      body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:Orbitron,sans-serif;background:#06030d url(${frame}) center/cover}
      .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,3,13,.92) 0%,rgba(6,3,13,.55) 45%,rgba(6,3,13,0) 75%)}
      .wrap{position:absolute;left:72px;top:150px}
      .top{font-weight:700;font-size:40px;letter-spacing:.72em;color:#22e6ff;text-shadow:0 0 18px rgba(34,230,255,.7)}
      .main{display:inline-block;font-weight:900;font-style:italic;font-size:120px;line-height:1;transform:skewX(-9deg);background:linear-gradient(180deg,#fff 8%,#ffb3dc 42%,#ff2d95 60%,#7a1cff 100%);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 0 24px rgba(255,45,149,.6))}
      .tag{margin-top:26px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:34px;letter-spacing:.08em;color:#eef1ff}
      .cta{margin-top:18px;display:inline-block;padding:10px 22px;font-size:20px;font-weight:700;letter-spacing:.2em;color:#fff;background:linear-gradient(90deg,#ff2d95,#9b3dff);clip-path:polygon(12px 0,100% 0,calc(100% - 12px) 100%,0 100%)}
      </style></head><body><div class="shade"></div><div class="wrap"><div class="top">NIGHT</div><div class="main">VECTOR</div>
      <div class="tag">Thread the traffic. Own the night.</div><div class="cta">PLAY FREE IN YOUR BROWSER</div></div></body></html>`;
    await og.route(`${base}/__og.html`, route => route.fulfill({ contentType: 'text/html', body: ogHtml }));
    await og.goto(`${base}/__og.html`);
    await og.evaluate(() => document.fonts.ready);
    await og.screenshot({ path: resolve(config.root, 'client', 'og-image.jpg'), type: 'jpeg', quality: 86 });
    await og.close();
    console.log('assets written: client/icons/*, client/og-image.jpg');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
