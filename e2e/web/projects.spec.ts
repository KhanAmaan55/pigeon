import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Page } from '@playwright/test';
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

const FIXTURE_TREE = [
  'Users API',
  'GETList users',
  'Admin',
  'POSTCreate user',
  'Billing API',
  'GETGet invoices',
  'POSTPay invoice',
];

async function openFixtureFolder(page: Page, extra: Record<string, string> = {}) {
  const files = { ...fixtureFiles(), ...extra };
  // Point a request at the test server so it can be sent.
  files['collections/billing/get-invoices.request.json'] = files[
    'collections/billing/get-invoices.request.json'
  ]!.replace(
    'https://billing.example.test/invoices?status=open&archived&page=',
    `${TEST_SERVER_URL}/json/user?status=open&archived&page=`,
  );
  await page.evaluate((f) => window.__pigeonTest!.preloadProject(f), files);
  await page.getByTestId('open-folder').click();
  await expect(page.getByTestId('project-tab')).toContainText('Basic project');
}

test.describe('project folders (File System Access)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'folder access is Chromium-only');

  test('opens a folder, browses the explorer and sends a project request', async ({ page }) => {
    await page.goto('/');
    await openFixtureFolder(page, { 'collections/billing/broken.request.json': '{ "id": ' });
    const items = page.getByTestId('explorer-item');
    // `broken` is not in `_pigeon.order`: appended alphabetically.
    await expect(items).toHaveText([...FIXTURE_TREE, 'broken']);
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

  test('reconnects to a folder after a reload', async ({ page }) => {
    await page.goto('/');
    await openFixtureFolder(page);
    await page.evaluate(() => window.__pigeonTest!.simulatePermissionPromptAfterReload());
    await page.reload();

    const recent = page.getByTestId('recent-project').filter({ hasText: 'Basic project' });
    await expect(recent).toHaveAttribute('data-status', 'needs-permission');
    await recent.getByTestId('recent-reconnect').click();
    await expect(page.getByTestId('explorer-item')).toHaveText(FIXTURE_TREE);
  });

  test('initializes an empty folder', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      window.__pigeonTest!.preloadProject({ 'README.md': '# repo' }, 'empty-repo'),
    );
    await page.getByTestId('open-folder').click();
    await page.getByTestId('init-project-name').fill('Repo API');
    await page.getByTestId('init-project-confirm').click();
    await expect(page.getByTestId('explorer-project-name')).toHaveText('Repo API');
  });

  test('FsAccessFs passes the filesystem conformance cases on OPFS', async ({ page }) => {
    await page.goto('/');
    expect(await page.evaluate(() => window.__pigeonTest!.runFsConformance())).toEqual([]);
  });
});

test.describe('browser workspaces', () => {
  test('creates a workspace that survives a reload', async ({ page, browserName }) => {
    await page.goto('/');
    // Folder buttons only where the browser can open folders.
    await expect(page.getByTestId('open-folder')).toHaveCount(browserName === 'chromium' ? 1 : 0);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Notes API');
    await page.getByTestId('create-project-submit').click();
    await expect(page.getByTestId('explorer-project-name')).toHaveText('Notes API');
    await expect(page.getByTestId('workspace-badge')).toBeVisible();

    await page.reload();
    const recent = page.getByTestId('recent-project').filter({ hasText: 'Notes API' });
    await expect(recent).toHaveAttribute('data-status', 'ok');
    await recent.getByText('Notes API', { exact: true }).click();
    await expect(page.getByTestId('project-tab')).toContainText('Notes API');
  });

  test('export zip → import zip gives identical files', async ({ page, browserName }) => {
    // Chromium saves through the native save picker, which can't be automated.
    test.skip(browserName === 'chromium', 'save picker');
    await page.goto('/');
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Zip API');
    await page.getByTestId('create-project-submit').click();
    await expect(page.getByTestId('explorer-project-name')).toHaveText('Zip API');

    const [first] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-project-zip').click(),
    ]);
    expect(first.suggestedFilename()).toBe('zip-api.zip');
    const firstPath = await first.path();

    await page.getByTestId('close-project').click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId('import-project-zip').click(),
    ]);
    await chooser.setFiles(firstPath);
    await expect(page.getByTestId('explorer-project-name')).toHaveText('Zip API');

    const [second] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-project-zip').click(),
    ]);
    // Exports are deterministic, so equal zips mean byte-equal project files.
    expect(readFileSync(await second.path())).toEqual(readFileSync(firstPath));
  });
});
