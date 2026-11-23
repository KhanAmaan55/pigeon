import { expect, test } from '@playwright/test';

/**
 * Keyboard commands in every browser (PIGN-042): the palette, Quick open and the alternatives
 * for keys browsers keep (Alt+N new request, Alt+W close tab).
 */
test('palette, quick open and the browser alternatives for reserved keys', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-browser-workspace').click();
  await page.getByTestId('create-project-name').fill('Keys API');
  await page.getByTestId('create-project-submit').click();
  await page.getByTestId('explorer-empty-new-collection').click();
  await page.getByTestId('explorer-rename-input').fill('Users');
  await page.getByTestId('explorer-rename-input').press('Enter');

  // Alt+N: a new request (Cmd/Ctrl+N opens a browser window).
  await page.keyboard.press('Alt+KeyN');
  await expect(page.getByTestId('url-input')).toBeFocused();
  await page.getByTestId('url-input').fill('https://api.example.test/users');
  await page.keyboard.press('Alt+KeyN');
  await expect(page.getByTestId('request-tab')).toHaveCount(2);

  // Command palette: run "Toggle response layout" by typing.
  await page.keyboard.press('ControlOrMeta+KeyK');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toHaveAttribute('data-mode', 'commands');
  await palette.getByTestId('palette-input').fill('response layout');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByTestId('request-response-split')).toHaveAttribute('data-dock', 'right');

  // Quick open goes to the first request.
  await page.keyboard.press('ControlOrMeta+KeyP');
  await expect(palette).toHaveAttribute('data-mode', 'files');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('url-input')).toHaveValue('https://api.example.test/users');

  // Alt+W closes the active tab (Cmd/Ctrl+W closes the browser tab); it has unsaved edits.
  await page.getByTestId('url-input').click();
  await page.keyboard.press('Alt+KeyW');
  await page.getByTestId('close-tab-discard').click();
  await expect(page.getByTestId('request-tab')).toHaveCount(1);
});
