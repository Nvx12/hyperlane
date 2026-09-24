import { defineConfig, devices } from '@playwright/test';

const PORT = 8093;

// E2E smoke tests against the real server (in-memory database, test environment).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 } } },
  ],
  webServer: {
    command: 'node --no-warnings=ExperimentalWarning server/src/index.js',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { APP_ENV: 'test', PORT: String(PORT), HOST: '127.0.0.1', DATABASE_PATH: ':memory:', LOG_LEVEL: 'warn', RATE_LIMIT_SCALE: '20' },
  },
});
