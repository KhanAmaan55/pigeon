import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

/**
 * Local request history (PIGN-051): sends are recorded (credentials masked), survive a reload,
 * open read-only and re-open as a new request; history can be cleared.
 */
test('records sends, keeps them across a reload, reopens and clears them', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__pigeonTest !== undefined);
  await page.getByTestId('new-browser-workspace').click();
  await page.getByTestId('create-project-name').fill('History API');
  await page.getByTestId('create-project-submit').click();
  await page.getByTestId('explorer-empty-new-collection').click();
  await page.getByTestId('explorer-rename-input').fill('Users');
  await page.getByTestId('explorer-rename-input').press('Enter');
  await page.getByTestId('explorer-item').filter({ hasText: 'Users' }).click({ button: 'right' });
  await page.getByTestId('menu-new-request').click();
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/echo?page=1`);
  await page.getByTestId('auth-tab').click();
  await page.getByTestId('auth-type').selectOption('bearer');
  await page.getByTestId('auth-token').fill('history-literal-token');
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/status/404`);
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-status')).toContainText('404');

  await page.getByTestId('activity-history').click();
  const items = page.getByTestId('history-item');
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId('history-day')).toHaveText(['Today']);
  await expect(items.first()).toContainText('/status/404');
  await page.getByTestId('history-status').selectOption('2xx');
  await expect(items).toHaveCount(1);
  await page.getByTestId('history-status').selectOption('');
  await page.getByTestId('history-filter').fill('page=1');
  await expect(items).toHaveCount(1);
  await page.getByTestId('history-filter').fill('');

  // Kept outside the project, across a reload.
  await page.reload();
  await page.waitForFunction(() => window.__pigeonTest !== undefined);
  await expect(page.getByTestId('project-tab')).toContainText('History API');
  await page.getByTestId('activity-history').click();
  await expect(items).toHaveCount(2);

  await items.filter({ hasText: 'page=1' }).click();
  const entry = page.getByTestId('history-entry');
  await expect(entry.getByTestId('history-entry-url')).toHaveText(`${TEST_SERVER_URL}/echo?page=1`);
  await expect(entry.getByTestId('history-entry-status')).toContainText('200 OK');
  await expect(entry.getByTestId('history-entry-request-headers')).toContainText('Bearer ••••••');
  await expect(entry).not.toContainText('history-literal-token');
  await expect(entry.getByTestId('history-entry-response-body')).toContainText('"page": "1"');
  await entry.getByTestId('history-open-new').click();
  await expect(page.getByTestId('toast')).toContainText(
    'Opened the history entry as a new request',
  );
  await expect(page.getByTestId('url-input')).toHaveValue(`${TEST_SERVER_URL}/echo?page=1`);
  await expect(page.getByTestId('request-tab-name').last()).toContainText('(from history)');

  await page.getByTestId('activity-history').click();
  await page.getByTestId('history-clear').click();
  await page.getByTestId('history-clear-confirm').click();
  await expect(page.getByTestId('history-empty')).toBeVisible();
});
