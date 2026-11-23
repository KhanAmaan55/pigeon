import { defineConfig, devices } from '@playwright/test';

import {
  CORS_PROXY_PORT,
  CORS_PROXY_TOKEN,
  CORS_PROXY_URL,
  TEST_SERVER_PORT,
  TEST_SERVER_URL,
} from './e2e/test-server';

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
  webServer: [
    {
      // `pnpm test:e2e` builds first; the preview server only serves apps/web/dist.
      command: 'pnpm --filter @pigeon/web preview',
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !isCI,
    },
    {
      // Requests in E2E tests go here, never to the public internet (docs/testing.md §6).
      command: 'pnpm --filter @pigeon/test-server start',
      url: `${TEST_SERVER_URL}/status/200`,
      env: { PIGEON_TEST_SERVER_PORT: String(TEST_SERVER_PORT) },
      reuseExistingServer: !isCI,
    },
    {
      // The optional self-hosted CORS proxy (PIGN-052); answers 403 without an Origin (ready).
      command: 'pnpm --filter @pigeon/cors-proxy start',
      url: `${CORS_PROXY_URL}/v1/health`,
      env: {
        PIGEON_PROXY_PORT: String(CORS_PROXY_PORT),
        PIGEON_PROXY_TOKEN: CORS_PROXY_TOKEN,
        PIGEON_PROXY_ORIGINS: `http://localhost:${PORT}`,
      },
      reuseExistingServer: !isCI,
    },
  ],
});
