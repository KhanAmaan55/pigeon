import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';
import './hooks';

/** The golden fixture project as `path → text`. */
function fixtureFiles(): Record<string, string> {
  const root = join(import.meta.dirname, '../../packages/fixtures/projects/basic');
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(root, full).split('\\').join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

// The memory-backed project behind "Open folder" exists in Chromium builds only until real
// folder access lands (PIGN-015); other browsers show no folder buttons.
test.skip(({ browserName }) => browserName !== 'chromium', 'folder access is Chromium-only');

test('opens a project, browses the explorer and sends a project request', async ({ page }) => {
  await page.goto('/');
  const files = fixtureFiles();
  // Point a request at the test server so it can be sent.
  files['collections/billing/get-invoices.request.json'] = files[
    'collections/billing/get-invoices.request.json'
  ]!.replace(
    'https://billing.example.test/invoices?status=open&archived&page=',
    `${TEST_SERVER_URL}/json/user?status=open&archived&page=`,
  );
  files['collections/billing/broken.request.json'] = '{ "id": ';
  await page.evaluate((f) => window.__pigeonTest!.preloadProject(f), files);

  await page.getByTestId('open-folder').click();
  const items = page.getByTestId('explorer-item');
  await expect(page.getByTestId('project-tab')).toContainText('Basic project');
  await expect(items).toHaveText([
    'Users API',
    'GETList users',
    'Admin',
    'POSTCreate user',
    'Billing API',
    'GETGet invoices',
    'POSTPay invoice',
    // Not in `_pigeon.order`: appended alphabetically.
    'broken',
  ]);
  await expect(items.filter({ hasText: 'broken' }).getByTestId('explorer-broken')).toBeVisible();

  await items.filter({ hasText: 'Admin' }).click();
  await expect(items.nth(3)).toHaveText('DELDelete user');

  await items.filter({ hasText: 'Get invoices' }).click();
  await expect(page.getByTestId('project-request-banner')).toContainText(
    'collections/billing/get-invoices.request.json',
  );
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');

  await items.filter({ hasText: 'broken' }).click();
  await expect(page.getByTestId('broken-file-panel')).toContainText(
    'collections/billing/broken.request.json',
  );
});
