/** Where Playwright starts `@pigeon/test-server` (see playwright.config.ts). */
export const TEST_SERVER_PORT = Number(process.env['PIGEON_TEST_SERVER_PORT'] ?? 4010);
export const TEST_SERVER_URL = `http://127.0.0.1:${TEST_SERVER_PORT}`;

/** Where Playwright starts `@pigeon/cors-proxy` (PIGN-052), with a fixed token for the tests. */
export const CORS_PROXY_PORT = Number(process.env['PIGEON_PROXY_PORT'] ?? 4012);
export const CORS_PROXY_URL = `http://127.0.0.1:${CORS_PROXY_PORT}`;
export const CORS_PROXY_TOKEN = 'e2e-proxy-token-not-secret';
