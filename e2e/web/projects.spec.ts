import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';
import './hooks';

/** A golden fixture project as `path → text`. */
function fixtureFiles(name = 'basic'): Record<string, string> {
  const root = join(import.meta.dirname, '../../packages/fixtures/projects', name);
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

/** Row texts: method + name, then badges (`JS`: the collection and List users have scripts). */
const FIXTURE_TREE = [
  'Users APIJS',
  'GETList usersJS',
  'Admin',
  'POSTCreate user',
  'Billing API',
  'GETGet invoices',
  'POSTPay invoice',
];

/** Loads the app and waits for the E2E hooks (installed after a dynamic import). */
async function gotoApp(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__pigeonTest !== undefined);
}

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
    await gotoApp(page);
    await openFixtureFolder(page, { 'collections/billing/broken.request.json': '{ "id": ' });
    const items = page.getByTestId('explorer-item');
    // `broken` is not in `_pigeon.order`: appended alphabetically.
    await expect(items).toHaveText([...FIXTURE_TREE, 'broken']);
    await expect(items.filter({ hasText: 'broken' }).getByTestId('explorer-broken')).toBeVisible();

    await items.filter({ hasText: 'Admin' }).click();
    await expect(items.nth(3)).toHaveText('DELDelete user');

    await items.filter({ hasText: 'Get invoices' }).click();
    await expect(page.getByTestId('request-tab-name')).toHaveText(['Get invoices']);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');

    await items.filter({ hasText: 'broken' }).click();
    await expect(page.getByTestId('broken-file-panel')).toContainText(
      'collections/billing/broken.request.json',
    );
  });

  test('reconnects to a folder after a reload', async ({ page }) => {
    await gotoApp(page);
    await openFixtureFolder(page);
    await page.evaluate(() => window.__pigeonTest!.simulatePermissionPromptAfterReload());
    await page.reload();
    await page.waitForFunction(() => window.__pigeonTest !== undefined);

    const recent = page.getByTestId('recent-project').filter({ hasText: 'Basic project' });
    await expect(recent).toHaveAttribute('data-status', 'needs-permission');
    await recent.getByTestId('recent-reconnect').click();
    await expect(page.getByTestId('explorer-item')).toHaveText(FIXTURE_TREE);
  });

  test('initializes an empty folder', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() =>
      window.__pigeonTest!.preloadProject({ 'README.md': '# repo' }, 'empty-repo'),
    );
    await page.getByTestId('open-folder').click();
    await page.getByTestId('init-project-name').fill('Repo API');
    await page.getByTestId('init-project-confirm').click();
    await expect(page.getByTestId('explorer-project-name')).toHaveText('Repo API');
  });

  test('picks up changes made outside the app on focus and Refresh', async ({ page }) => {
    await gotoApp(page);
    await openFixtureFolder(page);
    await expect(page.getByTestId('status-change-detection')).toHaveText('Refresh on focus');
    const items = page.getByTestId('explorer-item');
    await items.filter({ hasText: 'Pay invoice' }).dblclick();

    // Another program edits the file (here: the page writing to the same OPFS folder).
    const editOutside = (from: string, to: string) =>
      page.evaluate(
        async ([a, b]) => {
          const root = await navigator.storage.getDirectory();
          const dir = await (
            await (
              await root.getDirectoryHandle('fixture-project')
            ).getDirectoryHandle('collections')
          ).getDirectoryHandle('billing');
          const handle = await dir.getFileHandle('pay-invoice.request.json');
          const text = (await (await handle.getFile()).text()).replace(a!, b!);
          const writable = await handle.createWritable();
          await writable.write(text);
          await writable.close();
        },
        [from, to],
      );
    await editOutside('"Pay invoice"', '"Settle invoice"');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(items.filter({ hasText: 'Settle invoice' })).toHaveCount(1);
    await expect(page.getByTestId('request-tab-name')).toHaveText(['Settle invoice']);

    await editOutside('"Settle invoice"', '"Close invoice"');
    await page.getByTestId('explorer-refresh').click();
    await expect(items.filter({ hasText: 'Close invoice' })).toHaveCount(1);
  });

  test('FsAccessFs passes the filesystem conformance cases on OPFS', async ({ page }) => {
    await gotoApp(page);
    expect(await page.evaluate(() => window.__pigeonTest!.runFsConformance())).toEqual([]);
  });
});

test.describe('request tabs', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'uses a folder (Chromium-only)');

  test('preview, pin, edit, switch and close tabs', async ({ page }) => {
    await gotoApp(page);
    await openFixtureFolder(page);
    const items = page.getByTestId('explorer-item');
    const tabs = page.getByTestId('request-tab-name');

    // Single clicks reuse the preview tab; a double click pins.
    await items.filter({ hasText: 'Pay invoice' }).click();
    await items.filter({ hasText: 'Get invoices' }).click();
    await expect(tabs).toHaveText(['Get invoices']);
    await items.filter({ hasText: 'Get invoices' }).dblclick();
    await items.filter({ hasText: 'List users' }).click();
    await expect(tabs).toHaveText(['Get invoices', 'List users']);

    // Edit + send in the first tab; its response stays when switching.
    await page.getByTestId('request-tab').first().click();
    await page.getByTestId('url-input').press('End');
    await page.getByTestId('url-input').pressSequentially('&tab=1');
    await expect(page.getByTestId('request-tab-unsaved')).toHaveCount(1);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    await page.getByTestId('request-tab').nth(1).click();
    await expect(page.getByTestId('url-input')).toHaveValue('{{baseUrl}}/users?limit=20');
    await expect(page.getByTestId('response-status')).toHaveCount(0);
    await page.getByTestId('request-tab').first().click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');

    // Closing an edited tab asks; Discard restores the file version.
    await page.getByTestId('request-tab').first().hover();
    await page.getByTestId('request-tab-close').first().click();
    await page.getByTestId('close-tab-discard').click();
    await expect(tabs).toHaveText(['List users']);
    await items.filter({ hasText: 'Get invoices' }).click();
    await expect(page.getByTestId('url-input')).not.toHaveValue(/tab=1/);
  });
});

test.describe('explorer CRUD', () => {
  test('create, rename, move by drag and drop, and delete', async ({ page }) => {
    // Runs on a browser workspace, so all three browsers cover it.
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('CRUD API');
    await page.getByTestId('create-project-submit').click();
    const items = page.getByTestId('explorer-item');

    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await items.filter({ hasText: 'Users' }).click({ button: 'right' });
    await page.getByTestId('menu-new-folder').click();
    await page.getByTestId('explorer-rename-input').fill('Admin');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await items.filter({ hasText: 'Users' }).click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await expect(page.getByTestId('url-input')).toBeFocused();
    await page.getByTestId('url-input').fill('{{baseUrl}}/users');
    await expect(items).toHaveText(['Users', 'Admin', 'GETNew Request']);

    // Rename with F2 from the keyboard.
    await items.filter({ hasText: 'New Request' }).click();
    await page.getByRole('tree').press('F2');
    await page.getByTestId('explorer-rename-input').fill('List users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await expect(page.getByTestId('request-tab-name')).toHaveText(['List users']);

    // Drag the request into the folder.
    await items.filter({ hasText: 'List users' }).dragTo(items.filter({ hasText: 'Admin' }));
    await expect(items).toHaveText(['Users', 'Admin', 'GETList users']);
    await expect(items.filter({ hasText: 'List users' })).toHaveAttribute('aria-level', '3');

    // Delete the folder: its request's tab closes.
    await items.filter({ hasText: 'Admin' }).click({ button: 'right' });
    await page.getByTestId('menu-delete').click();
    await page.getByTestId('delete-confirm').click();
    await expect(items).toHaveText(['Users']);
    await expect(page.getByTestId('request-tab-name')).toHaveCount(0);
  });
});

test.describe('save to local state', () => {
  test('saved edits, tabs and badges survive a reload; files are unchanged until commit', async ({
    page,
  }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Drafts API');
    await page.getByTestId('create-project-submit').click();
    const items = page.getByTestId('explorer-item');
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await items.filter({ hasText: 'Users' }).click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await page.getByTestId('url-input').fill('{{baseUrl}}/users');
    await expect(page.getByTestId('request-tab-unsaved')).toHaveCount(1);

    await page.getByTestId('url-input').press('ControlOrMeta+s');
    await expect(page.getByTestId('request-tab-unsaved')).toHaveCount(0);
    await expect(items.filter({ hasText: 'New Request' }).getByTestId('explorer-badge')).toHaveText(
      'A',
    );
    await expect(items.filter({ hasText: 'Users' }).getByTestId('explorer-badge')).toHaveText('A');

    await page.waitForTimeout(700); // UI state is written after a short debounce
    await page.reload();
    await page.waitForFunction(() => window.__pigeonTest !== undefined);
    // The project that was open reopens by itself (PIGN-021).
    await expect(page.getByTestId('project-tab')).toContainText('Drafts API');
    await expect(page.getByTestId('request-tab-name')).toHaveText(['New Request']);
    await expect(page.getByTestId('url-input')).toHaveValue('{{baseUrl}}/users');
    await expect(items.filter({ hasText: 'New Request' }).getByTestId('explorer-badge')).toHaveText(
      'A',
    );
  });
});

test.describe('save for commit', () => {
  test('pending changes: review the plan and diff, write files, then nothing is pending', async ({
    page,
  }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Commit API');
    await page.getByTestId('create-project-submit').click();
    const items = page.getByTestId('explorer-item');
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await items.filter({ hasText: 'Users' }).click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await page.getByTestId('url-input').fill('{{baseUrl}}/users');
    await page.getByTestId('url-input').press('ControlOrMeta+s');
    await expect(page.getByTestId('pending-count')).toHaveText('2');

    await page.getByTestId('activity-pending').click();
    await expect(page.getByTestId('pending-changes-item')).toHaveCount(2);
    await expect(page.getByTestId('pending-file')).toHaveText([
      'Acollections/users/collection.json',
      'Acollections/users/new-request.request.json',
      'Mpigeon.json',
    ]);
    await page.getByTestId('pending-file').filter({ hasText: 'pigeon.json' }).click();
    await expect(page.getByTestId('diff-view').locator('[data-kind="add"]')).toContainText([
      '"users"',
    ]);
    await page.getByTestId('commit-all').click();
    await expect(page.getByTestId('toast')).toHaveText(/Wrote 3 files/);
    await expect(page.getByTestId('pending-empty')).toBeVisible();
    await expect(page.getByTestId('pending-count')).toHaveCount(0);

    await page.reload();
    await page.waitForFunction(() => window.__pigeonTest !== undefined);
    // The project that was open reopens by itself (PIGN-021).
    await expect(page.getByTestId('project-tab')).toContainText('Commit API');
    await expect(items).toHaveText(['Users', 'GETNew Request']);
    await expect(page.getByTestId('explorer-badge')).toHaveCount(0);
  });
});

test.describe('environments', () => {
  test('create, edit values, select and commit; selection survives a reload', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Env API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('activity-environments').click();
    await page.getByTestId('new-environment').click();
    await page.getByTestId('environment-rename-input').fill('Local');
    await page.getByTestId('environment-rename-input').press('Enter');

    const table = page.getByTestId('env-variables');
    await table.getByLabel('Key').last().fill('baseUrl');
    await table.getByLabel('Shared value').first().fill('http://localhost:3000');
    await page.getByTestId('env-current-value').first().fill('http://127.0.0.1:4010');
    await page.getByTestId('url-input').or(table).first().press('ControlOrMeta+Shift+s');
    await expect(page.getByTestId('toast')).toHaveText(/Wrote 1 file/);

    await page.keyboard.press('ControlOrMeta+e');
    await page.getByTestId('environment-option').filter({ hasText: 'Local' }).click();
    await expect(page.getByTestId('environment-selector')).toHaveText('Local');
    await page.waitForTimeout(700); // the selection is written after a short debounce

    await page.reload();
    await expect(page.getByTestId('environment-selector')).toHaveText('Local');
    await page.getByTestId('activity-environments').click();
    await page.getByTestId('environment-item').filter({ hasText: 'Local' }).click();
    await expect(page.getByTestId('env-current-value').first()).toHaveValue(
      'http://127.0.0.1:4010',
    );
  });
});

test.describe('variables', () => {
  test('the selected environment decides where a request goes', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Vars API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('activity-environments').click();
    for (const [name, url] of [
      ['Local', TEST_SERVER_URL],
      ['Down', 'http://127.0.0.1:9'],
    ] as const) {
      await page.getByTestId('new-environment').click();
      await page.getByTestId('environment-rename-input').fill(name);
      await page.getByTestId('environment-rename-input').press('Enter');
      const table = page.getByTestId('env-variables');
      await table.getByLabel('Key').last().fill('baseUrl');
      await table.getByLabel('Shared value').first().fill(url);
    }
    await page.getByTestId('activity-collections').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').press('Enter');
    await page.getByTestId('explorer-item').first().click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await page.getByTestId('url-input').fill('{{baseUrl}}/json/user');
    await expect(page.locator('[data-variable-state="unresolved"]').first()).toBeVisible();

    await page.getByTestId('environment-selector').click();
    await page.getByTestId('environment-option').filter({ hasText: 'Local' }).click();
    await expect(page.locator('[data-variable-state="resolved"]').first()).toBeVisible();
    await page
      .getByTestId('request-editor')
      .screenshot({ path: 'test-results/variable-highlight.png' });
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');

    await page.getByTestId('environment-selector').click();
    await page.getByTestId('environment-option').filter({ hasText: 'Down' }).click();
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-error')).toBeVisible();
  });
});

test.describe('collection variables', () => {
  test('a collection variable applies until an environment overrides it', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Scopes API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    const collection = page.getByTestId('explorer-item').filter({ hasText: 'Users' });
    await collection.click({ button: 'right' });
    await page.getByTestId('menu-variables').click();
    const table = page.getByTestId('env-variables');
    await table.getByLabel('Key').last().fill('baseUrl');
    await table.getByLabel('Shared value').first().fill(`${TEST_SERVER_URL}/json`);
    await collection.click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await page.getByTestId('url-input').fill('{{baseUrl}}/user');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');

    await page.getByTestId('activity-environments').click();
    await page.getByTestId('new-environment').click();
    await page.getByTestId('environment-rename-input').fill('Broken');
    await page.getByTestId('environment-rename-input').press('Enter');
    await page.getByTestId('env-variables').getByLabel('Key').last().fill('baseUrl');
    await page
      .getByTestId('env-variables')
      .getByLabel('Shared value')
      .first()
      .fill('http://127.0.0.1:9');
    await page.getByTestId('environment-selector').click();
    await page.getByTestId('environment-option').filter({ hasText: 'Broken' }).click();
    await page.getByTestId('request-tab').filter({ hasText: 'New Request' }).click();
    await expect(page.getByTestId('url-input')).toHaveAttribute(
      'title',
      /Broken\) — also defined in collection Users/,
    );
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-error')).toBeVisible();
  });
});

test.describe('secret variables', () => {
  test('secret current values are masked, revealed while held, and kept after a reload', async ({
    page,
  }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Secret API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('activity-environments').click();
    await page.getByTestId('new-environment').click();
    await page.getByTestId('environment-rename-input').fill('Prod');
    await page.getByTestId('environment-rename-input').press('Enter');
    const table = page.getByTestId('env-variables');
    await table.getByLabel('Key').last().fill('token');
    await table.getByTestId('env-variable-type').first().selectOption('secret');
    const current = table.getByTestId('env-current-value').first();
    await current.fill('live-token-123');
    await expect(current).toHaveAttribute('type', 'password');
    await expect(page.getByTestId('browser-secrets-notice')).toBeVisible();

    const reveal = table.getByTestId('secret-reveal');
    await reveal.hover();
    await page.mouse.down();
    await expect(current).toHaveAttribute('type', 'text');
    await page.mouse.up();
    await expect(current).toHaveAttribute('type', 'password');

    await page.getByTestId('browser-secrets-dismiss').click();
    await table.getByLabel('Key').first().press('ControlOrMeta+s');
    await expect(page.getByTestId('request-tab-unsaved')).toHaveCount(0);
    await page.waitForTimeout(700); // tabs and UI state are written after a short debounce
    await page.reload();
    await page.getByTestId('activity-environments').click();
    await page.getByTestId('environment-item').filter({ hasText: 'Prod' }).click();
    await expect(page.getByTestId('env-current-value').first()).toHaveValue('live-token-123');
    await expect(page.getByTestId('browser-secrets-notice')).toHaveCount(0);
  });
});

test.describe('auth', () => {
  test('a request inherits the bearer token set on its collection', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Auth API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Secured');
    await page.getByTestId('explorer-rename-input').press('Enter');
    const collection = page.getByTestId('explorer-item').filter({ hasText: 'Secured' });
    await collection.click({ button: 'right' });
    await page.getByTestId('menu-variables').click();
    const auth = page.getByTestId('container-auth');
    await auth.getByTestId('auth-type').selectOption('bearer');
    await auth.getByTestId('auth-token').fill('pigeon-token');
    await expect(auth.getByTestId('literal-secret-hint')).toBeVisible();

    await collection.click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/auth/bearer?token=pigeon-token`);
    await page.getByTestId('auth-tab').click();
    await expect(page.getByTestId('auth-inherited')).toHaveText(
      'Inherited from collection Secured: Bearer',
    );
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');

    await page.getByTestId('auth-type').selectOption('noauth');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('401 Unauthorized');
  });

  test('requests inherit the collection bearer; Basic sends UTF-8 credentials', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'uses a folder (Chromium-only)');
    await gotoApp(page);
    const files = fixtureFiles('auth');
    const collectionPath = 'collections/auth-api/collection.json';
    const collection = JSON.parse(files[collectionPath]!) as {
      variable: Array<{ key: string; value: string }>;
    };
    collection.variable = [
      { key: 'baseUrl', value: TEST_SERVER_URL },
      { key: 'token', value: 'pigeon-token' },
    ];
    files[collectionPath] = JSON.stringify(collection);
    await page.evaluate((f) => window.__pigeonTest!.preloadProject(f), files);
    await page.getByTestId('open-folder').click();
    await expect(page.getByTestId('project-tab')).toContainText('Auth project');

    await page.getByTestId('explorer-item').filter({ hasText: 'Inherited bearer' }).dblclick();
    await page.getByTestId('auth-tab').click();
    await expect(page.getByTestId('auth-inherited')).toHaveText(
      'Inherited from collection Auth API: Bearer',
    );
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');

    await page
      .getByTestId('explorer-item')
      .filter({ hasText: /^GETBasic$/ })
      .dblclick();
    await page.getByTestId('auth-tab').click();
    await expect(page.getByTestId('auth-username')).toHaveValue('ünï');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');

    // Inherit instead: the collection bearer doesn't satisfy /auth/basic.
    await page.getByTestId('auth-type').selectOption('inherit');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('401 Unauthorized');
  });
});

test.describe('examples', () => {
  test('saves a response as an example, views, edits and commits it', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Examples API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    const collection = page.getByTestId('explorer-item').filter({ hasText: 'Users' });
    await collection.click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/json/user`);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    await page.getByTestId('save-as-example').click();
    await expect(page.getByTestId('example-saved')).toContainText('200 OK');
    await page.keyboard.press('ControlOrMeta+Shift+s');
    await expect(page.getByTestId('toast')).toContainText('Wrote');

    await page.getByTestId('explorer-examples-toggle').click();
    await page.getByTestId('explorer-item').filter({ hasText: '200 OK' }).click();
    const view = page.getByTestId('example-view');
    await expect(view.getByTestId('example-status-line')).toHaveText('200 OK');
    await expect(view.getByTestId('example-body-editor')).toContainText('Ada Lovelace');
    await view.getByTestId('example-edit-toggle').click();
    await view.getByTestId('example-status').fill('All good');
    await page.keyboard.press('ControlOrMeta+Shift+s');
    await expect(page.getByTestId('toast')).toContainText('Wrote 1 file');
    await view.getByTestId('example-edit-toggle').click();
    await expect(view.getByTestId('example-status-line')).toHaveText('200 All good');
  });
});

test.describe('Postman import', () => {
  test('drops a collection file on the window, previews and imports it', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Imported API');
    await page.getByTestId('create-project-submit').click();
    await expect(page.getByTestId('explorer')).toBeVisible();

    const text = readFileSync(
      join(import.meta.dirname, '../../packages/fixtures/postman/examples.v2.1.json'),
      'utf8',
    );
    const dataTransfer = await page.evaluateHandle((content) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], 'examples.v2.1.json', { type: 'application/json' }));
      return transfer;
    }, text);
    await page.dispatchEvent('[data-testid="app-shell"]', 'dragover', { dataTransfer });
    await page.dispatchEvent('[data-testid="app-shell"]', 'drop', { dataTransfer });

    const dialog = page.getByTestId('import-dialog');
    await expect(dialog.getByTestId('import-format')).toHaveText(
      'Detected: Postman Collection v2.1',
    );
    await expect(dialog.getByTestId('import-count-examples')).toHaveText('5');
    await dialog.getByTestId('import-write').click();
    await expect(page.getByTestId('toast')).toContainText('Imported 1 request; wrote');
    await expect(page.getByTestId('explorer-item').filter({ hasText: 'Examples' })).toBeVisible();
    await page.getByTestId('explorer-examples-toggle').click();
    await expect(
      page.getByTestId('explorer-item').filter({ hasText: '404 Not Found' }),
    ).toBeVisible();
  });
});

test.describe('Postman environments', () => {
  test('drops a collection and two environments, imports them once, selects one and sends', async ({
    page,
  }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Env import');
    await page.getByTestId('create-project-submit').click();
    await expect(page.getByTestId('explorer')).toBeVisible();

    const collection = {
      info: {
        name: 'Users',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        { id: 'get-user', name: 'Get user', request: { method: 'GET', url: '{{baseUrl}}/user' } },
      ],
    };
    const environment = (name: string, baseUrl: string) => ({
      name,
      values: [{ key: 'baseUrl', value: baseUrl, type: 'default', enabled: true }],
      _postman_variable_scope: 'environment',
    });
    const files = [
      ['users.postman_collection.json', collection],
      ['local.postman_environment.json', environment('Local', `${TEST_SERVER_URL}/json`)],
      ['broken.postman_environment.json', environment('Broken', 'http://127.0.0.1:9')],
    ] as const;
    const dataTransfer = await page.evaluateHandle((entries) => {
      const transfer = new DataTransfer();
      for (const [name, data] of entries) {
        transfer.items.add(new File([JSON.stringify(data)], name, { type: 'application/json' }));
      }
      return transfer;
    }, files);
    await page.dispatchEvent('[data-testid="app-shell"]', 'dragover', { dataTransfer });
    await page.dispatchEvent('[data-testid="app-shell"]', 'drop', { dataTransfer });

    const dialog = page.getByTestId('import-dialog');
    await expect(dialog.getByTestId('import-item')).toHaveCount(3);
    await dialog.getByTestId('import-write').click();
    await expect(page.getByTestId('toast')).toContainText('Imported 1 request, 2 environments');

    await page.getByTestId('environment-selector').click();
    await page.getByTestId('environment-option').filter({ hasText: 'Local' }).click();
    await page.getByTestId('explorer-item').filter({ hasText: 'Get user' }).click();
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  });
});

test.describe('scripts', () => {
  test('edits a test script and commits it', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Scripts API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    const collection = page.getByTestId('explorer-item').filter({ hasText: 'Users' });
    await collection.click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/json/user`);

    await page.getByTestId('scripts-tab').click();
    await expect(page.getByTestId('scripts-not-run')).toBeVisible();
    await page.getByTestId('script-test-editor').click();
    await page.keyboard.type("pm.test('ok', () => {});");
    await expect(page.getByTestId('script-test-lines')).toHaveText('1 line');
    await page.keyboard.press('ControlOrMeta+Shift+s');
    await expect(page.getByTestId('toast')).toContainText('Wrote');
    await expect(
      page
        .getByTestId('explorer-item')
        .filter({ hasText: 'New Request' })
        .getByTestId('explorer-scripts'),
    ).toHaveText('JS');

    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-panel')).toContainText(
      'Scripts were not run (not supported yet): this request.',
    );
  });
});

test.describe('GraphQL', () => {
  test('queries the test server with variables and shows GraphQL errors', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('GraphQL API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    const collection = page.getByTestId('explorer-item').filter({ hasText: 'Users' });
    await collection.click({ button: 'right' });
    await page.getByTestId('menu-new-graphql').click();
    await expect(
      page
        .getByTestId('explorer-item')
        .filter({ hasText: 'New GraphQL Request' })
        .getByTestId('explorer-method'),
    ).toHaveText('GQL');
    await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/graphql`);
    await page.getByTestId('body-tab').click();

    await page.getByTestId('graphql-query').click();
    await page.keyboard.type('query One($id: ID!) { user(id: $id) { name } }');
    await page.getByTestId('graphql-variables').click();
    await page.keyboard.type('{ "id": ');
    await expect(page.getByTestId('graphql-variables-error')).toBeVisible();
    await page.keyboard.type('"1" }');
    await expect(page.getByTestId('graphql-variables-error')).toHaveCount(0);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    await expect(page.getByTestId('response-panel')).toContainText('Ada Lovelace');
    await expect(page.getByTestId('graphql-errors-chip')).toHaveCount(0);

    await page.getByTestId('graphql-query').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('{ error }');
    await page.getByTestId('graphql-variables').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('graphql-errors-chip')).toHaveText('errors: 1');
    await expect(page.getByTestId('graphql-errors')).toContainText(
      'Deliberate error from the test server',
    );
  });
});

test.describe('comparison', () => {
  test('compares responses with the saved example: pass, fail, content type', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Compare API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await page.getByTestId('explorer-item').filter({ hasText: 'Users' }).click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    const url = page.getByTestId('url-input');
    await url.fill(`${TEST_SERVER_URL}/json/user`);
    await page.getByTestId('send-button').click();
    const badge = page.getByTestId('comparison-badge');
    await expect(badge).toHaveAttribute('data-outcome', 'none');
    await badge.click();
    await expect(page.getByTestId('compare-no-baseline')).toHaveText(
      'No baseline — Save as example to start tracking.',
    );

    await page.getByTestId('save-as-example').click();
    await expect(badge).toHaveAttribute('data-outcome', 'pass');

    await url.fill(`${TEST_SERVER_URL}/json/user-v2`);
    await page.getByTestId('send-button').click();
    await expect(badge).toHaveAttribute('data-outcome', 'fail');
    await badge.click();
    await expect(page.getByTestId('compare-finding-path')).toHaveText([
      '$.email',
      '$.id',
      '$.nickname',
    ]);
    await expect(page.getByTestId('compare-finding')).toHaveCount(3);

    await url.fill(`${TEST_SERVER_URL}/html`);
    await page.getByTestId('send-button').click();
    await expect(badge).toHaveAttribute('data-outcome', 'fail');
    await badge.click();
    // The Content-Type header changed too (Headers section, PIGN-036).
    await expect(page.getByTestId('compare-finding')).toHaveCount(2);
    await expect(
      page.getByRole('region', { name: 'Body' }).getByTestId('compare-finding'),
    ).toHaveAttribute('data-kind', 'body.contentType.changed');
  });
});

test.describe('field rules', () => {
  test('mark optional and ignore relax the comparison to warn, then commit', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Rules API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await page.getByTestId('explorer-item').filter({ hasText: 'Users' }).click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    const url = page.getByTestId('url-input');
    await url.fill(`${TEST_SERVER_URL}/json/user`);
    await page.getByTestId('send-button').click();
    await page.getByTestId('save-as-example').click();
    const badge = page.getByTestId('comparison-badge');
    await expect(badge).toHaveAttribute('data-outcome', 'pass');

    await url.fill(`${TEST_SERVER_URL}/json/user-v2`);
    await page.getByTestId('send-button').click();
    await expect(badge).toHaveAttribute('data-outcome', 'fail');
    await badge.click();
    await page.getByTestId('finding-mark-optional').click();
    await expect(badge).toHaveAttribute('data-outcome', 'fail'); // the id type change remains
    await page
      .getByTestId('compare-finding')
      .filter({ hasText: '$.id' })
      .getByTestId('finding-ignore')
      .click();
    await expect(badge).toHaveAttribute('data-outcome', 'warn');
    await page.keyboard.press('ControlOrMeta+Shift+s');
    await expect(page.getByTestId('toast')).toContainText('Wrote');
  });
});

test.describe('values mode', () => {
  test('values mode catches a changed value that schema mode accepts', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Values API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Echo');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await page.getByTestId('explorer-item').filter({ hasText: 'Echo' }).click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    const url = page.getByTestId('url-input');
    await url.fill(`${TEST_SERVER_URL}/echo?name=ada`);
    await page.getByTestId('send-button').click();
    await page.getByTestId('save-as-example').click();
    const badge = page.getByTestId('comparison-badge');
    await expect(badge).toHaveAttribute('data-outcome', 'pass');

    await url.fill(`${TEST_SERVER_URL}/echo?name=grace`);
    await page.getByTestId('send-button').click();
    // Wait for the new response: the previous one already showed "pass".
    await expect(page.getByTestId('response-panel')).toContainText('grace');
    await expect(badge).toHaveAttribute('data-outcome', 'pass'); // schema mode: same shape
    await badge.click();
    await page.getByTestId('compare-rules').locator('summary').click();
    await page.getByTestId('override-body-mode').selectOption('values');
    await expect(badge).toHaveAttribute('data-outcome', 'fail');
    await expect(
      page.getByTestId('compare-finding').filter({ hasText: 'grace' }).first(),
    ).toHaveAttribute('data-kind', 'body.value.changed');
  });
});

test.describe('comparison of large bodies', () => {
  test('compares a 5 MB body in a worker while the editor stays usable', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'one browser is enough for the worker path');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Large API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Big');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await page.getByTestId('explorer-item').filter({ hasText: 'Big' }).click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    const url = page.getByTestId('url-input');
    await url.fill(`${TEST_SERVER_URL}/large/5`);
    await page.getByTestId('send-button').click();
    await page.getByTestId('save-as-example').click();
    await page.getByTestId('send-button').click();
    // Typing while the comparison runs.
    await url.press('End');
    await page.keyboard.type('?typed');
    await expect(url).toHaveValue(`${TEST_SERVER_URL}/large/5?typed`);
    await expect(page.getByTestId('comparison-badge')).toHaveAttribute('data-outcome', 'pass', {
      timeout: 20_000,
    });
    expect(errors).toEqual([]);
  });
});

test.describe('Postman export', () => {
  test('downloads a collection as a Postman v2.1 file', async ({ page, browserName }) => {
    // Chromium saves through the native save picker, which can't be automated.
    test.skip(browserName === 'chromium', 'save picker');
    await gotoApp(page);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Export API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    const collection = page.getByTestId('explorer-item').filter({ hasText: 'Users' });
    await collection.click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await page.getByTestId('url-input').fill('{{baseUrl}}/users?limit=5');

    await collection.click({ button: 'right' });
    await page.getByTestId('menu-export').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-save').click(),
    ]);
    expect(download.suggestedFilename()).toBe('Users.postman_collection.json');
    const data = JSON.parse(readFileSync((await download.path())!, 'utf8')) as {
      info: { name: string; schema: string };
      item: Array<{ request: { url: { raw: string; host: string[]; path: string[] } } }>;
    };
    expect(data.info).toMatchObject({
      name: 'Users',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    });
    expect(data.item[0]!.request.url).toMatchObject({
      raw: '{{baseUrl}}/users?limit=5',
      host: ['{{baseUrl}}'],
      path: ['users'],
    });
  });
});

test.describe('browser workspaces', () => {
  test('creates a workspace that survives a reload', async ({ page, browserName }) => {
    await gotoApp(page);
    // Folder buttons only where the browser can open folders.
    await expect(page.getByTestId('open-folder')).toHaveCount(browserName === 'chromium' ? 1 : 0);
    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('Notes API');
    await page.getByTestId('create-project-submit').click();
    await expect(page.getByTestId('explorer-project-name')).toHaveText('Notes API');
    await expect(page.getByTestId('workspace-badge')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('project-tab')).toContainText('Notes API');
    await expect(page.getByTestId('explorer-project-name')).toHaveText('Notes API');
  });

  test('two projects stay open side by side and come back after a reload', async ({ page }) => {
    await gotoApp(page);
    for (const name of ['First API', 'Second API']) {
      if (await page.getByTestId('add-project').isVisible())
        await page.getByTestId('add-project').click();
      await page.getByTestId('new-browser-workspace').click();
      await page.getByTestId('create-project-name').fill(name);
      await page.getByTestId('create-project-submit').click();
      await expect(page.getByTestId('explorer-project-name')).toHaveText(name);
    }
    const tabs = page.getByTestId('project-tab');
    await expect(tabs).toHaveText(['First API', 'Second API']);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await tabs.nth(0).click();
    await expect(page.getByTestId('explorer-project-name')).toHaveText('First API');

    await page.waitForTimeout(300);
    await page.reload();
    await expect(tabs).toHaveText(['First API', 'Second API']);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ControlOrMeta+Alt+ArrowRight');
    await expect(page.getByTestId('explorer-project-name')).toHaveText('Second API');
  });

  test('export zip → import zip gives identical files', async ({ page, browserName }) => {
    // Chromium saves through the native save picker, which can't be automated.
    test.skip(browserName === 'chromium', 'save picker');
    await gotoApp(page);
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
