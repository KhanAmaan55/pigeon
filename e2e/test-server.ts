/** Where Playwright starts `@pigeon/test-server` (see playwright.config.ts). */
export const TEST_SERVER_PORT = Number(process.env['PIGEON_TEST_SERVER_PORT'] ?? 4010);
export const TEST_SERVER_URL = `http://127.0.0.1:${TEST_SERVER_PORT}`;
