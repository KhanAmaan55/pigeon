import { defineConfig, devices } from '@playwright/test';

import base from './playwright.config';

/**
 * Performance budgets in a real browser (ui-ux.md §7, PIGN-042): `pnpm test:perf`. Chromium only,
 * one worker, so timings don't compete. Separate from `pnpm test:e2e`: budgets gate releases, not
 * pull requests (testing.md §3.7).
 */
export default defineConfig({
  ...base,
  testDir: './e2e/perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
