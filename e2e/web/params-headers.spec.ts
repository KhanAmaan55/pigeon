import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const queryRows = (page: Page) => page.getByTestId('query-table').getByTestId('kv-row');

/** The `/echo` response body as JSON, once the request finished. */
async function echoed(page: Page): Promise<{
  url: string;
  path: string;
  query: Record<string, string | string[]>;
  rawHeaders: Array<[string, string]>;
}> {
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  return JSON.parse((await page.getByTestId('response-body').textContent()) ?? '');
}

test('query params and the URL stay in sync both ways', async ({ page }) => {
  const url = page.getByTestId('url-input');
  await url.fill(`${TEST_SERVER_URL}/echo?a=1&b=2`);

  await expect(queryRows(page)).toHaveCount(2);
  await expect(queryRows(page).nth(0).getByLabel('Key')).toHaveValue('a');
  await expect(queryRows(page).nth(1).getByLabel('Value')).toHaveValue('2');
  await expect(page.getByTestId('params-tab-count')).toHaveText('2');

  await queryRows(page).nth(1).getByLabel('Value').fill('two');
  await expect(url).toHaveValue(`${TEST_SERVER_URL}/echo?a=1&b=two`);

  await queryRows(page).nth(0).getByLabel('Enable row 1').uncheck();
  await expect(url).toHaveValue(`${TEST_SERVER_URL}/echo?b=two`);
  await expect(queryRows(page)).toHaveCount(2);

  await page.getByTestId('send-button').click();
  expect((await echoed(page)).query).toEqual({ b: 'two' });
});

test('a path variable value is sent in place of :name', async ({ page }) => {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/echo/users/:id?expand=:id`);
  const row = page.getByTestId('path-variables-table').getByTestId('kv-row');
  await expect(row.getByLabel('Key')).toHaveValue('id');
  await row.getByLabel('Value').fill('42');
  await page.getByTestId('send-button').click();

  const echo = await echoed(page);
  expect(echo.path).toBe('/echo/users/42');
  expect(echo.query).toEqual({ expand: ':id' });
});

test('spaces and unicode are percent-encoded on send, not in the editor', async ({ page }) => {
  const url = page.getByTestId('url-input');
  await url.fill(`${TEST_SERVER_URL}/echo/a b?q=hello world&name=Zoë&kept=%2F`);
  await expect(queryRows(page).nth(1).getByLabel('Value')).toHaveValue('Zoë');
  await page.getByTestId('send-button').click();

  const echo = await echoed(page);
  expect(echo.url).toBe('/echo/a%20b?q=hello%20world&name=Zo%C3%AB&kept=%2F');
  expect(echo.query).toEqual({ q: 'hello world', name: 'Zoë', kept: '/' });
  await expect(url).toHaveValue(`${TEST_SERVER_URL}/echo/a b?q=hello world&name=Zoë&kept=%2F`);
});

test('disabled headers are not sent; duplicates are', async ({ page }) => {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/echo`);
  await page.getByTestId('headers-tab').click();
  await page.getByRole('button', { name: 'Bulk edit' }).click();
  await page.getByTestId('kv-bulk-input').fill('X-Dup: one\nX-Dup: two\n//X-Off: no');
  await expect(page.getByTestId('headers-tab-count')).toHaveText('2');
  await page.getByTestId('send-button').click();

  const headers = (await echoed(page)).rawHeaders.map(([name, value]) => [
    name.toLowerCase(),
    value,
  ]);
  expect(headers.some(([name]) => name === 'x-off')).toBe(false);
  // fetch's Headers joins repeated names into one line; the desktop app sends two lines.
  expect(headers.filter(([name]) => name === 'x-dup')).toEqual([['x-dup', 'one, two']]);
});

test('a Cookie header shows the forbidden-header warning and is reported as dropped', async ({
  page,
}) => {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/echo`);
  await page.getByTestId('headers-tab').click();
  const draft = page.getByTestId('headers-table').getByTestId('kv-draft-row');
  await draft.getByLabel('Key').fill('Cookie');
  const row = page.getByTestId('headers-table').getByTestId('kv-row');
  await row.getByLabel('Value').fill('session=abc');
  await expect(row.getByTestId('forbidden-header-warning')).toBeVisible();

  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-warnings')).toContainText('Header "Cookie" was not sent');
  // Only the user's header was dropped: no warning for a default User-Agent.
  await expect(page.getByTestId('response-warnings').getByRole('listitem')).toHaveCount(1);
  const headers = (await echoed(page)).rawHeaders.map(([name]) => name.toLowerCase());
  expect(headers).not.toContain('cookie');
});
