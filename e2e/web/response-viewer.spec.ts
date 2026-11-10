import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function get(page: Page, path: string) {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}${path}`);
  await page.getByTestId('send-button').click();
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
}

const body = (page: Page) => page.getByTestId('response-body');
const mode = (page: Page) => page.getByTestId('response-body-mode');

test('/json/nested opens pretty with folding, and search highlights matches', async ({ page }) => {
  await get(page, '/json/nested');
  await expect(mode(page)).toHaveAttribute('data-mode', 'pretty');
  await expect(body(page)).toContainText('"name": "Ada Lovelace"');

  // Fold the outermost object: everything collapses into one placeholder.
  const lines = body(page).locator('.cm-line');
  const before = await lines.count();
  await page.locator('.cm-foldGutter [title="Fold line"]').first().click();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
  expect(await lines.count()).toBeLessThan(before);
  await page.locator('.cm-foldPlaceholder').click();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);

  await body(page).click();
  await page.keyboard.press('ControlOrMeta+f');
  const search = page.locator('.cm-search input[name="search"]');
  await expect(search).toBeFocused();
  // The find panel reads its field on keyup, as when a user types.
  await search.pressSequentially('Ada');
  await expect(page.locator('.cm-searchMatch')).not.toHaveCount(0);
  await search.fill('');
  await search.pressSequentially('no such text');
  await expect(page.locator('.cm-searchMatch')).toHaveCount(0);
});

test('/unicode renders correctly in Pretty and Raw', async ({ page }) => {
  await get(page, '/unicode');
  for (const view of ['pretty', 'raw'] as const) {
    await page.getByTestId(`response-view-${view}`).click();
    await expect(mode(page)).toHaveAttribute('data-mode', view);
    for (const text of ['こんにちは', 'مرحبا', 'नमस्ते', '🐦 🚀 👩‍💻 🏳️‍🌈', '𝄞 𐐷', 'ключ 🔑']) {
      await expect(body(page)).toContainText(text);
    }
  }
});

test('the HTML preview never runs scripts', async ({ page }) => {
  await get(page, '/html');
  await expect(mode(page)).toHaveAttribute('data-mode', 'pretty');
  await page.getByTestId('response-view-preview').click();

  const preview = page.getByTestId('response-preview');
  await expect(preview).toHaveAttribute('sandbox', '');
  const frame = page.frameLocator('[data-testid="response-preview"]');
  await expect(frame.getByRole('heading', { name: 'Pigeon test page 🐦' })).toBeVisible();
  await expect(frame.locator('#script-status')).toHaveText('Scripts did not run.');
  expect(await page.evaluate(() => 'pigeonScriptRan' in window)).toBe(false);
});

test('images preview from the response bytes', async ({ page }) => {
  await get(page, '/image/png');
  await expect(mode(page)).toHaveAttribute('data-mode', 'preview');
  const image = page.getByTestId('response-preview-image');
  await expect(image).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
});

test('XML opens formatted, one element per line', async ({ page }) => {
  await get(page, '/xml');
  await expect(mode(page)).toHaveAttribute('data-mode', 'pretty');
  const lines = body(page).locator('.cm-line');
  await expect(lines.nth(1)).toHaveText('<catalog>');
  await expect(lines.nth(2)).toHaveText('  <book id="1" lang="en">');
  await expect(lines.nth(3)).toHaveText('    <title>Notes on the Analytical Engine</title>');
});

test('the headers tab lists headers and says the browser hides some', async ({ page }) => {
  await get(page, '/cors/allow-all');
  await page.getByTestId('response-headers-tab').click();
  await expect(page.getByTestId('response-headers-restricted')).toContainText(
    'Some headers are hidden by the browser',
  );
  await expect(
    page.getByTestId('response-header-row').filter({ hasText: 'x-pigeon-test' }),
  ).toContainText('exposed');
});

test('/large/5 renders raw in under 1 s and pretty in under 2 s', async ({ page }) => {
  await get(page, '/large/5');
  let started = Date.now();
  await expect(mode(page)).toHaveAttribute('data-mode', 'raw');
  await expect(body(page).locator('.cm-line').nth(1)).toContainText('{"id":0,"name":"Item 0"');
  const rawMs = Date.now() - started;
  await expect(page.getByTestId('response-body-large')).toContainText('shown raw');

  started = Date.now();
  await page.getByTestId('response-format-anyway').click();
  await expect(mode(page)).toHaveAttribute('data-mode', 'pretty');
  await expect(body(page).locator('.cm-line').nth(2)).toHaveText('    "id": 0,');
  const prettyMs = Date.now() - started;

  test
    .info()
    .annotations.push({ type: 'timing', description: `raw ${rawMs} ms, pretty ${prettyMs} ms` });
  expect(rawMs).toBeLessThan(1000);
  expect(prettyMs).toBeLessThan(2000);
  // Still responsive: the URL bar takes input right away.
  await page.getByTestId('url-input').fill('typing works');
  await expect(page.getByTestId('url-input')).toHaveValue('typing works');
});

test('Save body downloads the exact bytes with the server-given file name', async ({ page }) => {
  // Use the download path: Playwright can't drive the native picker of showSaveFilePicker.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
    Reflect.deleteProperty(Window.prototype, 'showSaveFilePicker');
  });
  await page.reload();
  await get(page, '/unicode');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('response-save').click(),
  ]);
  // WebKit on macOS hands the name back NFD-normalized.
  expect(download.suggestedFilename().normalize('NFC')).toBe('🐦-ünïcödé.json');
  const saved = await readFile(await download.path());
  const expected = Buffer.from(await (await fetch(`${TEST_SERVER_URL}/unicode`)).arrayBuffer());
  expect(saved.equals(expected)).toBe(true);
  await expect(page.getByTestId('response-save-status')).toHaveText('Saved');
});

test('Ctrl/Cmd+Alt+L moves the response to the right and back', async ({ page }) => {
  const split = page.getByTestId('request-response-split');
  await expect(split).toHaveAttribute('data-dock', 'bottom');
  await page.keyboard.press('ControlOrMeta+Alt+KeyL');
  await expect(split).toHaveAttribute('data-dock', 'right');

  await get(page, '/json/user');
  await page.getByTestId('response-view-raw').click();
  await page.getByTestId('response-dock-toggle').click();
  await expect(split).toHaveAttribute('data-dock', 'bottom');
  // The response keeps its view across the move.
  await expect(mode(page)).toHaveAttribute('data-mode', 'raw');
  await expect(body(page)).toContainText('Ada Lovelace');
});
