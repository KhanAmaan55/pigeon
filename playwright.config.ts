import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const isCI = Boolean(process.env['CI']);

/** Web E2E against the production build served by `vite preview` (docs/testing.md §4). */
export default defineConfig({
  testDir: './e2e/web',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // `pnpm test:e2e` builds first; the preview server only serves apps/web/dist.
    command: 'pnpm --filter @pigeon/web preview',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
  },
});
