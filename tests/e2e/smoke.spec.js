import { test, expect } from '@playwright/test';
import { withDriver, watchErrors } from './helpers.js';

test('first launch: create a driver, and the first race starts with the tutorial', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?debug');
  await expect(page.locator('#loading')).toHaveCount(0);
  await expect(page.locator('#screen-welcome')).toHaveClass(/active/);
  await expect(page.locator('#menu-topbar')).not.toHaveClass(/visible/);
  await page.locator('#welcome-form input[name="name"]').fill('<script>');
  await page.locator('#welcome-form button[type="submit"]').click();
  await expect(page.locator('#welcome-msg')).toContainText(/letters, numbers/);
  await page.locator('#welcome-form input[name="name"]').fill('Zoë Racer');
  await page.locator('[data-avatar="star"]').click();
  await page.locator('#welcome-form button[type="submit"]').click();
  await page.waitForFunction(() => window.nightVector.state === 'playing', null, { timeout: 10_000 });
  await expect(page.locator('#coach')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#coach-text')).toContainText(/steer/i);
  await page.locator('.coach-skip').click();
  await expect(page.locator('#coach')).toBeHidden();
  const p = await page.evaluate(() => ({ profile: window.nightVector.save.profile, tutorial: window.nightVector.save.flags.tutorial }));
  expect(p.profile.name).toBe('Zoë Racer');
  expect(p.profile.avatar).toBe('star');
  expect(p.tutorial).toBe(true);
  expect(errors).toEqual([]);
});

test('home: PLAY plus Garage, Missions, Profile, Leaderboard and Settings', async ({ page }) => {
  await withDriver(page);
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#screen-menu')).toHaveClass(/active/);
  await expect(page.locator('.play-btn')).toBeVisible();
  for (const label of ['Garage', 'Missions', 'Profile', 'Leaderboard', 'Settings']) {
    await expect(page.locator('.home-tiles .tile', { hasText: label })).toBeVisible();
  }
  await expect(page.locator('kbd')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('one tap PLAY → race → results with rewards and a next goal → one-tap restart', async ({ page }) => {
  await withDriver(page);
  const errors = watchErrors(page);
  await page.goto('/?debug');
  await page.locator('.play-btn').click();
  await expect(page.locator('#touch-controls')).toHaveClass(/enabled/);
  await page.waitForFunction(() => window.nightVector.state === 'playing');
  await page.waitForTimeout(3000); // acceleration is automatic
  expect(await page.evaluate(() => window.nightVector.score.distance)).toBeGreaterThan(50);

  await page.evaluate(() => window.nightVector.beginCrashSequence(1));
  await expect(page.locator('#screen-results')).toHaveClass(/active/, { timeout: 15_000 });
  await expect(page.locator('#res-credits')).toHaveText(/^\+\d/);
  await expect(page.locator('#res-goal')).toContainText(/Next car/i);
  await expect(page.locator('#res-goal')).toContainText('Kestrel GT');
  await page.locator('#screen-results [data-action="restart"]').click();
  await page.waitForFunction(() => window.nightVector.state === 'countdown');
  expect(errors).toEqual([]);
});

test('in-race bonuses go to the feed (max three lines), never onto the road', async ({ page }) => {
  await withDriver(page);
  await page.goto('/?debug');
  await page.locator('.play-btn').click();
  await page.waitForFunction(() => window.nightVector.state === 'playing');
  const lines = await page.evaluate(() => {
    const g = window.nightVector;
    for (let i = 0; i < 6; i++) g.skills.award('NEAR MISS', 100, 1, 'near');
    g.skills.award('PERFECT OVERTAKE', 300, 2, 'gold');
    g.skills.award('CHICANE', 400, 3, 'violet');
    g.skills.award('INSANE', 500, 3, 'insane');
    return g.ui.feed.visibleLines();
  });
  expect(lines.length).toBeLessThanOrEqual(3);
  const box = await page.locator('#bonus-feed').boundingBox();
  const vp = page.viewportSize();
  expect(box.x + box.width).toBeLessThan(vp.width * 0.5);
  expect(box.y).toBeLessThan(vp.height * 0.45);
});

test('pause button and resume countdown', async ({ page }) => {
  await withDriver(page);
  await page.goto('/?debug');
  await page.locator('.play-btn').click();
  await page.waitForFunction(() => window.nightVector.state === 'playing');
  await page.locator('.hud-pause').click();
  await expect(page.locator('#screen-pause')).toHaveClass(/active/);
  await page.locator('#screen-pause [data-action="resume"]').click();
  await expect(page.locator('#screen-pause')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => window.nightVector.resumeTimer)).toBeGreaterThan(0);
  await page.waitForFunction(() => window.nightVector.resumeTimer === 0, null, { timeout: 5000 });
});

test('garage shows locked cars with their requirements; the legendary car stays secret', async ({ page }) => {
  await withDriver(page);
  await page.goto('/?debug');
  await page.locator('.tile[data-nav="garage"]').click();
  await expect(page.locator('#garage-state')).toHaveText(/Owned/i);
  await page.locator('[data-car-step="1"]').click();
  await expect(page.locator('#garage-name')).toHaveText('Kestrel GT');
  await expect(page.locator('#garage-state')).toHaveText(/Locked/i);
  await expect(page.locator('#garage-action')).toContainText('Driver level 3');
  await expect(page.locator('#garage-action')).toContainText('2,500');
  await page.evaluate(() => window.nightVector.menus.showCar('phantom'));
  await expect(page.locator('#garage-name')).toHaveText('???');
  await expect(page.locator('#garage-action')).toContainText(/Unknown/);
});

test('profile: driver card; go online; leaderboard', async ({ page }) => {
  await withDriver(page, `E2E ${Math.floor(Math.random() * 9000 + 1000)}`);
  await page.goto('/');
  await page.locator('.tile[data-nav="profile"]').click();
  await expect(page.locator('#driver-card .id-name')).toContainText('E2E');
  await expect(page.locator('#identity-card')).toContainText(/Guest profile/i);
  await page.locator('[data-acct="create"]').click();
  await expect(page.locator('#identity-card')).toContainText(/Online account/i, { timeout: 10_000 });
  await page.locator('#screen-profile [data-nav="home"]').click();
  await page.locator('.tile[data-nav="leaderboard"]').click();
  await expect(page.locator('#lb-body')).not.toContainText('Loading');
  await page.locator('[data-lb-period="all"]').click();
  await expect(page.locator('#lb-body')).toBeVisible();
});

test('security headers are present', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});
