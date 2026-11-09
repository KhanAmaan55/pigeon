import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

// The web app calls the test server cross-origin, so these check its CORS behaviour in each
// real browser engine. Request-sending UI tests build on this from PIGN-006.
test.describe('test server from the web app origin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('a preflighted request to a permissive endpoint succeeds', async ({ page }) => {
    const result = await page.evaluate(async (base) => {
      const res = await fetch(`${base}/echo?from=page`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Pigeon': 'e2e' },
        body: '{"ok":true}',
      });
      const body = (await res.json()) as {
        method: string;
        headers: Record<string, string>;
        parsed: unknown;
      };
      return {
        status: res.status,
        method: body.method,
        header: body.headers['x-pigeon'],
        parsed: body.parsed,
      };
    }, TEST_SERVER_URL);
    expect(result).toEqual({
      status: 200,
      method: 'PUT',
      header: 'e2e',
      parsed: { kind: 'json', value: { ok: true } },
    });
  });

  test('custom response headers are exposed', async ({ page }) => {
    const header = await page.evaluate(
      async (base) => (await fetch(`${base}/cors/allow-all`)).headers.get('x-pigeon-test'),
      TEST_SERVER_URL,
    );
    expect(header).toBe('exposed');
  });

  test('CORS-blocked endpoints fail in the browser', async ({ page }) => {
    const outcomes = await page.evaluate(async (base) => {
      const attempt = (url: string, init?: RequestInit) =>
        fetch(url, init).then(
          (res) => `status ${res.status}`,
          (err: unknown) => (err instanceof TypeError ? 'blocked' : String(err)),
        );
      return {
        none: await attempt(`${base}/cors/none`),
        simple: await attempt(`${base}/cors/preflight-required`),
        preflighted: await attempt(`${base}/cors/preflight-required`, {
          headers: { 'X-Pigeon': 'e2e' },
        }),
      };
    }, TEST_SERVER_URL);
    expect(outcomes).toEqual({ none: 'blocked', simple: 'status 200', preflighted: 'blocked' });
  });
});
