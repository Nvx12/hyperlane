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

// The first race runs the interactive tutorial; most tests want a normal race.
async function skipTutorial(page) {
  await page.addInitScript(() => {
    try {
      const save = JSON.parse(localStorage.getItem('nightvector.save') || 'null');
      if (!save) localStorage.setItem('nightvector.save', JSON.stringify({ saveVersion: 2, flags: { tutorial: true } }));
    } catch { /* ignore */ }
  });
}

test('boots to the phone home screen with no errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveCount(0);
  await expect(page.locator('#screen-menu')).toHaveClass(/active/);
  await expect(page.locator('.play-btn')).toBeVisible();
  for (const label of ['Garage', 'Missions', 'Leaderboard', 'Settings']) {
    await expect(page.locator('.home-tiles .tile', { hasText: label })).toBeVisible();
  }
  // No desktop keyboard instructions anywhere in the UI
  await expect(page.locator('kbd')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('one tap PLAY → race with touch controls → results', async ({ page }) => {
  await skipTutorial(page);
  const errors = watchErrors(page);
  await page.goto('/?debug');
  await expect(page.locator('#screen-menu')).toHaveClass(/active/);
  await page.locator('.play-btn').click();
  await expect(page.locator('#hud')).not.toHaveClass(/hidden/);
  await expect(page.locator('#touch-controls')).toHaveClass(/enabled/);
  await page.waitForFunction(() => window.nightVector.state === 'playing');
  await page.waitForTimeout(3000); // acceleration is automatic
  const distance = await page.evaluate(() => window.nightVector.score.distance);
  expect(distance).toBeGreaterThan(50);

  await page.evaluate(() => window.nightVector.beginCrashSequence(1));
  await expect(page.locator('#screen-results')).toHaveClass(/active/, { timeout: 15_000 });
  await expect(page.locator('#res-score')).not.toHaveText('');
  await page.locator('#screen-results [data-action="restart"]').click();
  await page.waitForFunction(() => window.nightVector.state === 'countdown');
  expect(errors).toEqual([]);
});

test('pause button and resume countdown', async ({ page }) => {
  await skipTutorial(page);
  await page.goto('/?debug');
  await page.locator('.play-btn').click();
  await page.waitForFunction(() => window.nightVector.state === 'playing');
  await page.locator('.hud-pause').click();
  await expect(page.locator('#screen-pause')).toHaveClass(/active/);
  await page.locator('#screen-pause [data-action="resume"]').click();
  await expect(page.locator('#screen-pause')).not.toHaveClass(/active/);
  // The world stays frozen during the 3-2-1, then the race continues
  expect(await page.evaluate(() => window.nightVector.resumeTimer)).toBeGreaterThan(0);
  await page.waitForFunction(() => window.nightVector.resumeTimer === 0, null, { timeout: 5000 });
});

test('first race runs the interactive tutorial', async ({ page }) => {
  await page.goto('/?debug');
  await page.locator('.play-btn').click();
  await page.waitForFunction(() => window.nightVector.state === 'playing', null, { timeout: 10_000 });
  await expect(page.locator('#coach')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#coach-text')).toContainText(/steer/i);
  await page.locator('.coach-skip').click();
  await expect(page.locator('#coach')).toBeHidden();
  expect(await page.evaluate(() => window.nightVector.save.flags.tutorial)).toBe(true);
});

test('online profile and leaderboard', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-nav="profile"]').first().click();
  const name = `E2E ${Math.floor(Math.random() * 9000 + 1000)}`;
  await page.locator('#identity-card input[name="name"]').fill(name);
  await page.locator('#identity-card button[type="submit"]').click();
  await expect(page.locator('#identity-card .id-name')).toHaveText(name);

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
