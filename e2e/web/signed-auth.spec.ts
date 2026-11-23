import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

/**
 * Digest and AWS SigV4 in the browser (PIGN-046). Digest needs the 401 challenge, which a page
 * can only read when the server exposes WWW-Authenticate with CORS (the test server does).
 */
test('Digest and AWS Signature work against the test server', async ({ page }) => {
  await page.goto('/');
  const url = page.getByTestId('url-input');
  await url.fill(`${TEST_SERVER_URL}/auth/digest?user=ada&pass=lovelace`);
  await page.getByTestId('auth-tab').click();
  await page.getByTestId('auth-type').selectOption('digest');
  await page.getByTestId('auth-username').fill('ada');
  await page.getByTestId('auth-password').fill('lovelace');
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  await expect(page.getByTestId('response-body')).toContainText('"authenticated": true');

  await url.fill(`${TEST_SERVER_URL}/auth/awsv4?x=1`);
  await page.getByTestId('auth-type').selectOption('awsv4');
  await page.getByTestId('auth-access-key').fill('AKIDPIGEONTEST');
  await page.getByTestId('auth-secret-key').fill('pigeon/test+secret');
  await page.getByTestId('auth-region').fill('eu-test-1');
  await page.getByTestId('auth-service').fill('pigeon');
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-body')).toContainText('"authenticated": true');
});
