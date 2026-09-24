import { test, expect } from '@playwright/test';

test.describe('release checks', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop-only checks');

  test('works offline after the first visit (service worker)', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.locator('#screen-menu')).toHaveClass(/active/);
    // Synchronous predicate on purpose: an async one returns a (truthy) Promise immediately.
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20_000 });
    // Server unreachable: every request that actually hits the network fails. (Chromium's
    // setOffline emulation blocks the navigation before the service worker can answer it.)
    await context.route('**/*', route => route.abort('internetdisconnected'));
    await page.reload();
    await expect(page.locator('#loading')).toHaveCount(0);
    await expect(page.locator('#screen-menu')).toHaveClass(/active/);
    await expect(page.locator('#net-status')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#net-status')).toHaveText(/offline|local only/i);
    // The game itself runs without the server.
    await page.locator('[data-nav="play"]').click();
    await page.locator('#screen-play [data-action="start"]').click();
    await expect(page.locator('#hud')).not.toHaveClass(/hidden/);
    await context.unroute('**/*');
  });

  test('challenge links show a challenge and are removed from the URL', async ({ page }) => {
    const c = Buffer.from(JSON.stringify({ v: 1, s: 12345, d: 3000, e: 'neon', n: 'Rival One' })).toString('base64url');
    await page.goto(`/?c=${c}`);
    await expect(page.locator('#home-challenge')).toBeVisible();
    await expect(page.locator('#home-challenge')).toContainText('Rival One');
    await expect(page.locator('#home-challenge')).toContainText('12,345');
    expect(page.url()).not.toContain('c=');
    await page.locator('[data-challenge="accept"]').click();
    await expect(page.locator('#intro-tip')).toContainText("beat Rival One's 12,345");
  });

  test('hostile challenge links are ignored', async ({ page }) => {
    const c = Buffer.from(JSON.stringify({ v: 1, s: 5, d: 1, e: 'neon', n: '<img src=x onerror=alert(1)>' })).toString('base64url');
    let dialog = false;
    page.on('dialog', d => {
      dialog = true;
      d.dismiss();
    });
    await page.goto(`/?c=${c}`);
    await expect(page.locator('#screen-menu')).toHaveClass(/active/);
    await expect(page.locator('#home-challenge')).toBeHidden();
    expect(dialog).toBe(false);
  });

  test('controller: navigate menus and drive with a gamepad', async ({ page }) => {
    await page.addInitScript(() => {
      const pad = {
        index: 0, id: 'E2E Pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      };
      window.__pad = pad;
      navigator.getGamepads = () => [pad];
    });
    await page.goto('/?debug');
    await expect(page.locator('#screen-menu')).toHaveClass(/active/);
    await page.evaluate(() => {
      const ev = new Event('gamepadconnected');
      Object.defineProperty(ev, 'gamepad', { value: window.__pad });
      window.dispatchEvent(ev);
    });
    await expect(page.locator('body')).toHaveClass(/pad-active/);
    await expect(page.locator('#toasts')).toContainText(/controller connected/i);

    const press = async i => {
      await page.evaluate(b => { window.__pad.buttons[b].pressed = true; window.__pad.buttons[b].value = 1; }, i);
      await page.waitForTimeout(120);
      await page.evaluate(b => { window.__pad.buttons[b].pressed = false; window.__pad.buttons[b].value = 0; }, i);
      await page.waitForTimeout(120);
    };
    await press(13); // D-pad down → focus moves
    const focused = await page.evaluate(() => document.activeElement.dataset.nav);
    expect(focused).toBeTruthy();

    await page.evaluate(() => window.nightVector.startRace());
    await page.waitForFunction(() => window.nightVector.state === 'playing', null, { timeout: 10_000 });
    await page.evaluate(() => { window.__pad.axes[0] = 1; window.__pad.buttons[7].value = 1; });
    await page.waitForTimeout(600);
    const steer = await page.evaluate(() => window.nightVector.input.steer);
    expect(steer).toBeGreaterThan(0.9);
    await press(9); // Start → pause
    await expect(page.locator('#screen-pause')).toHaveClass(/active/);
  });

  test('performance budget: simulation + render stays well under a frame', async ({ page }) => {
    await page.goto('/?debug');
    await page.evaluate(() => window.nightVector.startRace());
    await page.waitForFunction(() => window.nightVector.state === 'playing', null, { timeout: 10_000 });
    const ms = await page.evaluate(() => {
      const g = window.nightVector;
      g.player.invulnerable = 1e9;
      for (let i = 0; i < 120; i++) { g.update(1 / 60); g.render(); } // warm up JIT and sprite caches
      const t0 = performance.now();
      for (let i = 0; i < 600; i++) { g.state = 'playing'; g.update(1 / 60); g.render(); }
      return (performance.now() - t0) / 600;
    });
    console.log(`frame cost ${ms.toFixed(2)} ms`);
    // 16.7 ms is the whole 60 fps budget; CI machines are slow and headless rendering is software.
    expect(ms).toBeLessThan(12);
  });
});
