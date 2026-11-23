import { expect, test } from '@playwright/test';

import { CORS_PROXY_TOKEN, CORS_PROXY_URL, TEST_SERVER_URL } from '../test-server';

/**
 * Self-hosted CORS proxy (PIGN-052): a request to an API without CORS fails in the browser, the
 * error card points to the proxy, and with proxy mode on the same request succeeds with every
 * header visible. A wrong token is refused.
 */
test('a CORS-less API works through the local proxy', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__pigeonTest !== undefined);
  await page.getByTestId('new-browser-workspace').click();
  await page.getByTestId('create-project-name').fill('Proxy API');
  await page.getByTestId('create-project-submit').click();
  await page.getByTestId('explorer-empty-new-collection').click();
  await page.getByTestId('explorer-rename-input').fill('Legacy');
  await page.getByTestId('explorer-rename-input').press('Enter');
  await page.getByTestId('explorer-item').filter({ hasText: 'Legacy' }).click({ button: 'right' });
  await page.getByTestId('menu-new-request').click();
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/cors/none`);
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-error')).toHaveAttribute('data-kind', 'cors-suspected');
  await expect(page.getByTestId('response-error-proxy')).toContainText('Use a local proxy');
  await expect(page.getByTestId('status-browser-mode')).toBeVisible();

  await page.getByTestId('response-error-proxy-settings').click();
  const settings = page.getByTestId('cors-proxy-settings');
  await settings.getByTestId('cors-proxy-url').fill(CORS_PROXY_URL);
  await settings.getByTestId('cors-proxy-token').fill('wrong-token');
  await settings.getByTestId('cors-proxy-test').click();
  await expect(settings.getByTestId('cors-proxy-status')).toHaveText(
    'The proxy rejected the token.',
  );
  await settings.getByTestId('cors-proxy-token').fill(CORS_PROXY_TOKEN);
  await settings.getByTestId('cors-proxy-test').click();
  await expect(settings.getByTestId('cors-proxy-status')).toHaveText('The proxy answers.');
  await settings.getByTestId('cors-proxy-enabled').check();
  await expect(settings.getByTestId('cors-proxy-mode')).toHaveText('Proxy mode is on.');
  await expect(page.getByTestId('capability-transport')).toHaveText('proxy');
  await expect(page.getByTestId('capability-bypassesCors')).toHaveText('true');
  await expect(page.getByTestId('status-proxy-mode')).toBeVisible();
  await expect(page.getByTestId('status-browser-mode')).toHaveCount(0);

  await page.getByTestId('activity-collections').click();
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  await expect(page.getByTestId('response-transport')).toHaveText('Proxy');
  await page.getByTestId('response-headers-tab').click();
  await expect(page.getByTestId('response-headers-restricted')).toHaveCount(0);
  await expect(
    page.getByTestId('response-header-row').filter({ hasText: 'content-length' }),
  ).toHaveCount(1);
  await expect(
    page.getByTestId('response-header-row').filter({ hasText: 'connection' }),
  ).toHaveCount(1);

  // The setting is per project and survives a reload.
  await page.reload();
  await page.waitForFunction(() => window.__pigeonTest !== undefined);
  await expect(page.getByTestId('project-tab')).toContainText('Proxy API');
  await expect(page.getByTestId('status-proxy-mode')).toBeVisible();
});
