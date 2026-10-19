import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const SHELL_REGIONS = [
  'app-shell',
  'top-bar',
  'project-tabs',
  'environment-selector',
  'activity-bar',
  'sidebar',
  'request-tabs',
  'request-editor',
  'response-panel',
  'status-bar',
];

/** Drags a resize handle by (dx, dy) with real pointer events. */
async function drag(page: Page, handle: Locator, dx: number, dy: number) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('resize handle is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

async function size(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element is not visible');
  return box;
}

test('renders every shell region', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Pigeon');
  for (const region of SHELL_REGIONS) {
    await expect(page.getByTestId(region), region).toBeVisible();
  }
});

test('production build loads under the CSP without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /script-src 'self'/,
  );
  // The bundled monospace font must be loadable from our own origin under the CSP.
  const loadedFaces = await page.evaluate(
    async () => (await document.fonts.load('12px "JetBrains Mono"')).length,
  );
  expect(loadedFaces).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('theme follows the OS by default and can be toggled', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('activity bar switches the sidebar view', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('activity-environments').click();
  await expect(page.getByTestId('sidebar')).toHaveAccessibleName('Environments');
  await expect(page.getByTestId('activity-environments')).toHaveAttribute('aria-pressed', 'true');
});

test('sidebar and response panel are resizable', async ({ page }) => {
  await page.goto('/');

  const sidebar = page.getByTestId('sidebar');
  const sidebarBefore = (await size(sidebar)).width;
  await drag(page, page.getByTestId('sidebar-resize-handle'), 120, 0);
  await expect.poll(async () => (await size(sidebar)).width).toBeGreaterThan(sidebarBefore + 80);

  const response = page.getByTestId('response-panel');
  const responseBefore = (await size(response)).height;
  await drag(page, page.getByTestId('response-resize-handle'), 0, -100);
  await expect.poll(async () => (await size(response)).height).toBeGreaterThan(responseBefore + 60);
});
