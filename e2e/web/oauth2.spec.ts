import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

/**
 * OAuth 2.0 in the browser (PIGN-047) against the test server: client credentials on send, and
 * the authorization code + PKCE flow through a popup and `oauth-callback.html`.
 */
test('client credentials on send; authorization code with PKCE in a popup', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-browser-workspace').click();
  await page.getByTestId('create-project-name').fill('OAuth API');
  await page.getByTestId('create-project-submit').click();
  await page.getByTestId('explorer-empty-new-collection').click();
  await page.getByTestId('explorer-rename-input').fill('Users');
  await page.getByTestId('explorer-rename-input').press('Enter');
  await page.getByTestId('explorer-item').filter({ hasText: 'Users' }).click({ button: 'right' });
  await page.getByTestId('menu-new-request').click();
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/oauth/protected`);

  await page.getByTestId('auth-tab').click();
  await page.getByTestId('auth-type').selectOption('oauth2');
  await page.getByTestId('oauth-grant').selectOption('client_credentials');
  await page.getByTestId('oauth-token-url').fill(`${TEST_SERVER_URL}/oauth/token`);
  await page.getByTestId('oauth-client-id').fill('pigeon-client');
  await page.getByTestId('oauth-client-secret').fill('pigeon-secret');
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  await expect(page.getByTestId('response-warnings')).toContainText(
    'A new OAuth 2.0 token was requested.',
  );
  await expect(page.getByTestId('oauth-token-status')).toContainText('Token from');

  // Authorization code + PKCE: a public client, approved in a popup.
  await page.getByTestId('oauth-clear-token').click();
  await page.getByTestId('oauth-grant').selectOption('authorization_code_with_pkce');
  await page.getByTestId('oauth-auth-url').fill(`${TEST_SERVER_URL}/oauth/authorize`);
  await page.getByTestId('oauth-client-secret').fill('');
  const popup = page.waitForEvent('popup');
  await page.getByTestId('oauth-get-token').click();
  await (await popup).waitForEvent('close');
  await expect(page.getByTestId('oauth-token-message')).toHaveText('Token acquired.');
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-body')).toContainText('"authenticated": true');
});
