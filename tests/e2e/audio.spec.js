import { test, expect } from '@playwright/test';
import { withDriver } from './helpers.js';

// Police chase music lifecycle, in real time (fades run on the AudioContext clock).
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test.describe('police chase audio', () => {
  test.skip(({ isMobile }) => isMobile, 'runs once, on the desktop project');
  test.beforeEach(async ({ page }) => withDriver(page));

  test('chase music only with police on screen; crash and restart leave nothing behind', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      window.__contexts = 0;
      const AC = window.AudioContext;
      window.AudioContext = class extends AC {
        constructor(...a) {
          super(...a);
          window.__contexts++;
        }
      };
    });
    await page.goto('/?debug');
    await page.waitForFunction(() => window.nightVector && window.nightVector.state === 'menu');
    const audio = () => page.evaluate(() => window.nightVector.audio.debugInfo());

    for (let run = 1; run <= 3; run++) {
      await page.evaluate(() => window.nightVector.startRace());
      await page.waitForFunction(() => window.nightVector.state === 'playing', null, { timeout: 15_000 });
      await page.waitForFunction(() => window.nightVector.audio.chase && window.nightVector.audio.chase.ready, null, { timeout: 10_000 });
      expect((await audio()).state).toMatch(/normal|highIntensity/);

      // Heat calls the police: units are dispatched from behind, but no chase music yet.
      await page.evaluate(() => {
        const g = window.nightVector;
        g.player.invulnerable = 1e9;
        g.runTime = Math.max(g.runTime, 25);
        g.police.gainScale = 0;
        g.police.debugSetHeat(3);
      });
      await page.waitForFunction(() => window.nightVector.police.chase !== null, null, { timeout: 30_000 });
      const before = await page.evaluate(() => ({ engaged: window.nightVector.police.chase.engaged, state: window.nightVector.audio.musicState }));
      if (!before.engaged) expect(before.state).not.toBe('chase');

      // A unit reaches the screen → the chase is on → chase music (one source, one stinger).
      await page.waitForFunction(() => window.nightVector.police.chase && window.nightVector.police.chase.engaged, null, { timeout: 40_000 });
      await expect.poll(async () => (await audio()).state).toBe('chase');
      const inChase = await audio();
      expect(inChase.trackPlaying).toBe(true);
      expect(inChase.trackStarts).toBe(run);
      expect(inChase.stingers).toBe(run);

      // Wrecked during the chase: the track is gone before the results screen, sirens too.
      await page.evaluate(() => {
        const g = window.nightVector;
        g.player.invulnerable = 0;
        g.player.health = 0.01;
        g.resolveCrash(g.traffic.vehicles.find(c => !c.police) || g.traffic.vehicles[0], 1, 1);
      });
      await page.waitForFunction(() => window.nightVector.state === 'gameover', null, { timeout: 15_000 });
      await expect.poll(async () => (await audio()).trackSource).toBe(false);
      const after = await audio();
      expect(after.state).toBe('gameOver');
      expect(after.siren).toBe(false);
    }
    expect(await page.evaluate(() => window.__contexts)).toBe(1);
  });
});
