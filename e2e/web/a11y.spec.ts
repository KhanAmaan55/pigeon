import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

/**
 * axe-core scans of the main screens (PIGN-042): no critical violations, and no colour contrast
 * failures since the PIGN-058 palette. Other serious ones are listed in the output.
 */
async function scan(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  for (const v of violations) {
    console.log(
      `axe [${screen}] ${v.impact}: ${v.id} (${v.nodes.length}) ${v.nodes
        .slice(0, 3)
        .map((n) => `${n.target.join(' ')} (${n.any[0]?.message ?? ''})`)
        .join(' | ')}`,
    );
  }
  expect(
    violations
      .filter((v) => v.impact === 'critical' || v.id === 'color-contrast')
      .map((v) => `${v.id}: ${v.help}`),
    screen,
  ).toEqual([]);
}

test.describe('accessibility', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one engine is enough for axe');
  // Dialogs and menus fade in; axe should see the finished colours, not a frame of the fade.
  test.use({ reducedMotion: 'reduce' });

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`${colorScheme} theme`, () => {
      test.use({ colorScheme });
      test('main screens have no critical axe violations', async ({ page }) => {
        await scanMainScreens(page);
      });
    });
  }
});

async function scanMainScreens(page: Page) {
  {
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await scan(page, 'welcome');

    await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/json/user`);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    await scan(page, 'response');

    await page.getByTestId('new-browser-workspace').click();
    await page.getByTestId('create-project-name').fill('A11y API');
    await page.getByTestId('create-project-submit').click();
    await page.getByTestId('explorer-empty-new-collection').click();
    await page.getByTestId('explorer-rename-input').fill('Users');
    await page.getByTestId('explorer-rename-input').press('Enter');
    await page.getByTestId('explorer-item').filter({ hasText: 'Users' }).click({ button: 'right' });
    await page.getByTestId('menu-new-request').click();
    await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/json/user`);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    await scan(page, 'project');

    await page.getByTestId('activity-settings').click();
    await expect(page.getByTestId('keyboard-settings')).toBeVisible();
    await scan(page, 'settings');

    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await scan(page, 'palette');
    await page.keyboard.press('Escape');

    await page.getByTestId('status-browser-mode').click();
    await expect(page.getByTestId('web-limitations')).toBeVisible();
    await scan(page, 'help');
  }
}
