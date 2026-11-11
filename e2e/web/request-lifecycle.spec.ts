import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

/** PIGN-011: cancel, timeouts, CORS errors and unsupported settings in Pigeon web. */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a slow request can be cancelled with the Cancel button', async ({ page }) => {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/delay/5000`);
  await page.getByTestId('send-button').click();

  const cancel = page.getByTestId('cancel-button');
  await expect(cancel).toBeVisible();
  const started = Date.now();
  await cancel.click();

  await expect(page.getByTestId('response-cancelled')).toHaveText('Cancelled');
  expect(Date.now() - started).toBeLessThan(3000);
  await expect(page.getByTestId('response-error')).toHaveCount(0);
  await expect(page.getByTestId('send-button')).toBeVisible();
});

test('Esc cancels the request in flight', async ({ page }) => {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/delay/5000`);
  await page.getByTestId('url-input').press('Enter');
  await expect(page.getByTestId('cancel-button')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('response-cancelled')).toBeVisible();
  await expect(page.getByTestId('response-error')).toHaveCount(0);
});

test('a 1000 ms timeout on /delay/3000 shows a timeout error', async ({ page }) => {
  await page.getByTestId('settings-tab').click();
  await page.getByTestId('setting-timeout').fill('1000');
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/delay/3000`);
  const started = Date.now();
  await page.getByTestId('send-button').click();

  const error = page.getByTestId('response-error');
  await expect(error).toHaveAttribute('data-kind', 'timeout');
  await expect(error).toContainText('timed out after 1 s');
  expect(Date.now() - started).toBeLessThan(2900);
});

test('/cors/none shows the CORS card with its hint and raw detail', async ({ page }) => {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/cors/none`);
  await page.getByTestId('send-button').click();

  const error = page.getByTestId('response-error');
  await expect(error).toHaveAttribute('data-kind', 'cors-suspected');
  await expect(error.getByTestId('response-error-title')).toContainText('CORS');
  await expect(error.getByTestId('response-error-hint')).toContainText('desktop app');
  await expect(error.getByTestId('response-error-hint')).toContainText('enable CORS');
  // The raw browser message is folded away.
  await expect(error.getByTestId('response-error-detail')).not.toHaveAttribute('open');
});

test('the Settings tab disables redirect and TLS controls with an explanation', async ({
  page,
}) => {
  await page.getByTestId('settings-tab').click();

  for (const id of ['setting-follow-redirects', 'setting-max-redirects', 'setting-strict-ssl']) {
    await expect(page.getByTestId(id)).toBeDisabled();
  }
  await expect(page.getByTestId('setting-timeout')).toBeEnabled();

  await page.getByTestId('setting-follow-redirects-row').hover();
  await expect(page.getByTestId('setting-unsupported-tooltip').first()).toContainText(
    'Browsers always follow redirects',
  );
});
