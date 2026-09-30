// Seeds a returning player: a driver profile, tutorial done. Only when no save exists yet, so a
// reload inside a test keeps whatever the test changed.
export async function withDriver(page, name = 'E2E Driver') {
  await page.addInitScript(driver => {
    try {
      if (!localStorage.getItem('nightvector.save')) {
        localStorage.setItem('nightvector.save', JSON.stringify({
          saveVersion: 3,
          profile: { id: '00000000-0000-4000-8000-000000000001', name: driver, avatar: 'bolt', createdAt: 1_790_000_000_000 },
          flags: { tutorial: true },
        }));
      }
    } catch { /* ignore */ }
  }, name);
}

// Collects console errors and uncaught exceptions so every test can assert a clean run.
export function watchErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}
