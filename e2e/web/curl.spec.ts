import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

/**
 * cURL import and code snippets (PIGN-050): a cURL command pasted outside a text field opens the
 * import preview and becomes a request in the selected collection; the Code tab and the
 * explorer's "Copy as cURL" mask credentials.
 */
test('paste cURL to import a request, then copy it back as cURL', async ({ page }) => {
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, '__copied', { value: copied });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void copied.push(text) },
    });
  });
  await page.goto('/');
  await page.getByTestId('new-browser-workspace').click();
  await page.getByTestId('create-project-name').fill('Curl API');
  await page.getByTestId('create-project-submit').click();
  await page.getByTestId('explorer-empty-new-collection').click();
  await page.getByTestId('explorer-rename-input').fill('Users');
  await page.getByTestId('explorer-rename-input').press('Enter');

  const curl = [
    `curl '${TEST_SERVER_URL}/echo?page=2' \\`,
    `  -H 'content-type: application/json' \\`,
    `  -u 'ada:secret-pw' \\`,
    `  --data-raw '{"name":"Ada"}'`,
  ].join('\n');
  // A paste outside any text field (what Cmd/Ctrl+V on the explorer does).
  await page.getByTestId('explorer-item').filter({ hasText: 'Users' }).click();
  await page.evaluate((text) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    document.activeElement!.dispatchEvent(event);
  }, curl);

  const dialog = page.getByTestId('import-dialog');
  await expect(dialog.getByTestId('import-format')).toHaveText('Detected: cURL command');
  await expect(dialog.getByTestId('import-request')).toHaveText(
    `POST${TEST_SERVER_URL}/echo?page=2`,
  );
  await expect(dialog.getByTestId('import-name')).toHaveValue(/^POST .*\/echo$/);
  await dialog.getByTestId('import-name').fill('Create user');
  await dialog.getByTestId('import-write').click();
  await expect(page.getByTestId('toast')).toContainText('Imported 1 request; wrote');

  // The request opened in a tab, inside the selected collection.
  await expect(page.getByTestId('explorer-item').filter({ hasText: 'Create user' })).toBeVisible();
  await expect(page.getByTestId('url-input')).toHaveValue(`${TEST_SERVER_URL}/echo?page=2`);
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  await expect(page.getByTestId('response-body')).toContainText(
    '"authorization": "Basic YWRhOnNlY3JldC1wdw=="',
  );

  await page.getByTestId('code-tab').click();
  await expect(page.getByTestId('code-snippet')).toContainText('Authorization: Basic ••••••');
  await expect(page.getByTestId('code-snippet')).not.toContainText('YWRhOnNlY3JldC1wdw');

  await page
    .getByTestId('explorer-item')
    .filter({ hasText: 'Create user' })
    .click({ button: 'right' });
  await page.getByTestId('menu-copy-curl').click();
  await expect(page.getByTestId('toast')).toContainText('Copied as cURL.');
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied.at(-1)).toContain(`curl '${TEST_SERVER_URL}/echo?page=2'`);
  expect(copied.at(-1)).toContain("--header 'Authorization: Basic ••••••'");
  expect(copied.at(-1)).toContain(`--data-raw '{"name":"Ada"}'`);
});
