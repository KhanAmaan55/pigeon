import { expect, test } from '@playwright/test';

import { TEST_SERVER_PORT } from '../test-server';

/**
 * Browser cookies (PIGN-045): the web app can't manage cookies, but a request can let the browser
 * send and store its own (`credentials: 'include'`) for a same-site origin.
 */
const SAME_SITE = `http://localhost:${TEST_SERVER_PORT}`;

test('"Send browser cookies" lets the browser store and send its cookies', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-browser-workspace').click();
  await page.getByTestId('create-project-name').fill('Cookies API');
  await page.getByTestId('create-project-submit').click();
  await page.getByTestId('explorer-empty-new-collection').click();
  await page.getByTestId('explorer-rename-input').fill('Users');
  await page.getByTestId('explorer-rename-input').press('Enter');
  await page.getByTestId('explorer-item').filter({ hasText: 'Users' }).click({ button: 'right' });
  await page.getByTestId('menu-new-request').click();
  const url = page.getByTestId('url-input');
  const body = page.getByTestId('response-body');

  // Off (the default): the browser neither stores nor sends cookies.
  await url.fill(`${SAME_SITE}/cookies/set?web=off`);
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  await url.fill(`${SAME_SITE}/cookies`);
  await page.getByTestId('send-button').click();
  await expect(body).toContainText('"cookies": {}');

  await page.getByTestId('settings-tab').click();
  await page.getByTestId('setting-include-credentials').check();
  await url.fill(`${SAME_SITE}/cookies/set?web=on`);
  await page.getByTestId('send-button').click();
  await expect(body).toContainText('"web": "on"');
  await url.fill(`${SAME_SITE}/cookies`);
  await page.getByTestId('send-button').click();
  await expect(body).toContainText('"web": "on"');

  // The cookie manager explains why it can't list them.
  await page.keyboard.press('ControlOrMeta+KeyK');
  await page.getByTestId('palette-input').fill('manage cookies');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cookie-manager-web')).toBeVisible();
});
