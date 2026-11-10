import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('GET /json/user shows status, time, size and the JSON body', async ({ page }) => {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/json/user`);
  await page.getByTestId('send-button').click();

  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  await expect(page.getByTestId('response-time')).toHaveText(/^\d+ ms$|^\d+\.\d+ s$/);
  await expect(page.getByTestId('response-size')).toHaveText(/^\d+(\.\d)? (B|KB)$/);
  await expect(page.getByTestId('response-body')).toContainText('"name": "Ada Lovelace"');
  await expect(page.getByTestId('response-transport')).toHaveText('Browser');
});

test('POST /echo with a raw text body shows the echoed body', async ({ page }) => {
  await page.getByTestId('method-select').selectOption('POST');
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/echo`);
  await page.getByTestId('body-tab').click();
  await page.getByTestId('body-input').fill('hello from pigeon');
  await page.getByTestId('body-input').press('ControlOrMeta+Enter');

  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  const body = page.getByTestId('response-body');
  await expect(body).toContainText('"method": "POST"');
  await expect(body).toContainText('"text": "hello from pigeon"');
});

test('an invalid URL shows a validation error', async ({ page }) => {
  await page.getByTestId('url-input').fill('http://');
  await page.getByTestId('url-input').press('Enter');

  const error = page.getByTestId('response-error');
  await expect(error).toHaveAttribute('data-kind', 'invalid-url');
  await expect(page.getByTestId('response-status')).toHaveCount(0);
});

test('a server without CORS headers shows a cors-suspected error card', async ({ page }) => {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/cors/none`);
  await page.getByTestId('send-button').click();

  const error = page.getByTestId('response-error');
  await expect(error).toHaveAttribute('data-kind', 'cors-suspected');
  await expect(error).toContainText('CORS');
});
