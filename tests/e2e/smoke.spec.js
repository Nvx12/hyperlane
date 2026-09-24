import { test, expect } from '@playwright/test';

// Collects console errors and failed requests so every test can assert a clean run.
function watchErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

test('boots to the main menu with no errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveCount(0);
  await expect(page.locator('#screen-menu')).toHaveClass(/active/);
  for (const label of ['Play', 'Garage', 'Missions', 'Leaderboard', 'Profile', 'Settings']) {
    await expect(page.locator('.main-nav .nav-btn', { hasText: label })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('plays a race and reaches the results screen', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await page.goto('/?debug');
  await expect(page.locator('#screen-menu')).toHaveClass(/active/);
  await page.locator('[data-nav="play"]').click();
  await page.locator('#screen-play [data-action="start"]').click();
  await expect(page.locator('#hud')).not.toHaveClass(/hidden/);
  if (isMobile) await expect(page.locator('#touch-controls')).toHaveClass(/enabled/);

  // Drive for a few seconds of real time, then end the run.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.nightVector.state === 'playing');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  const distance = await page.evaluate(() => window.nightVector.score.distance);
  expect(distance).toBeGreaterThan(50);

  await page.evaluate(() => window.nightVector.beginCrashSequence(1));
  await expect(page.locator('#screen-results')).toHaveClass(/active/, { timeout: 15_000 });
  await expect(page.locator('#res-score')).not.toHaveText('');
  expect(errors).toEqual([]);
});

test('pause and resume with the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard flow');
  await page.goto('/?debug');
  await page.locator('[data-nav="play"]').click();
  await page.locator('#screen-play [data-action="start"]').click();
  await page.waitForFunction(() => window.nightVector.state === 'playing');
  await page.keyboard.press('Escape');
  await expect(page.locator('#screen-pause')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#screen-pause')).not.toHaveClass(/active/);
});

test('online profile and leaderboard', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-nav="profile"]').click();
  const name = `E2E ${Math.floor(Math.random() * 9000 + 1000)}`;
  await page.locator('#identity-card input[name="name"]').fill(name);
  await page.locator('#identity-card button[type="submit"]').click();
  await expect(page.locator('#identity-card .id-name')).toHaveText(name);

  await page.locator('#screen-profile [data-nav="home"]').click();
  await page.locator('[data-nav="leaderboard"]').click();
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
