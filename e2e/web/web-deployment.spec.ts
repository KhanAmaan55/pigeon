import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

/** PIGN-039: CSP, sub-path serving and the Web limitations help. */

test('the CSP blocks inline scripts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const outcome = await page.evaluate(async () => {
    const violation = new Promise<string>((resolve) =>
      document.addEventListener('securitypolicyviolation', (event) =>
        resolve(event.effectiveDirective),
      ),
    );
    const script = document.createElement('script');
    script.textContent = 'window.__inlineScriptRan = true;';
    document.head.append(script);
    const directive = await Promise.race([
      violation,
      new Promise<string>((resolve) => setTimeout(() => resolve('none'), 2000)),
    ]);
    return {
      ran: (window as unknown as { __inlineScriptRan?: boolean }).__inlineScriptRan === true,
      directive,
    };
  });
  expect(outcome.ran).toBe(false);
  expect(outcome.directive).toMatch(/^script-src/);
});

test.describe('sub-path hosting', () => {
  // The built app (apps/web/dist) served under /tools/pigeon/ by a plain static server.
  let server: Server;
  let origin: string;
  test.beforeAll(async () => {
    const dist = join(import.meta.dirname, '../../apps/web/dist');
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://x').pathname;
      if (!path.startsWith('/tools/pigeon/')) {
        response.writeHead(404).end();
        return;
      }
      const relativePath = path.slice('/tools/pigeon/'.length) || 'index.html';
      const file = normalize(join(dist, relativePath));
      if (!file.startsWith(dist) || !existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      });
      response.end(readFileSync(file));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  test('the build works from a sub-path', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/tools/pigeon/`);
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/json/user`);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    // The body viewer (a lazy chunk) and the formatter worker load from the sub-path too.
    await expect(page.getByTestId('response-body')).toContainText('"name": "Ada Lovelace"');
    expect(errors).toEqual([]);
  });
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

test.describe('web limitations help', () => {
  const help = (page: Page) => page.getByTestId('web-limitations');

  test('the status bar, settings and header hints open their sections', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('status-browser-mode').click();
    await expect(help(page)).toHaveAttribute('data-section', 'cors');
    await expect(help(page).locator('[data-help-section="cors"]')).toBeInViewport();
    await page.getByTestId('web-limitations-close').click();
    await expect(help(page)).toBeHidden();

    await expect(page.getByTestId('status-get-desktop')).toHaveAttribute(
      'href',
      'https://pigeon.example.test/download',
    );

    await page.getByRole('tab', { name: 'Settings' }).click();
    const settings = page.getByTestId('request-settings');
    await settings.getByTestId('help-link').first().click();
    await expect(help(page)).toHaveAttribute('data-section', 'redirects');
    await expect(help(page).locator('[data-help-section="redirects"]')).toBeInViewport();
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Headers' }).first().click();
    const key = page.getByTestId('headers-table').getByRole('textbox').first();
    await key.fill('Cookie');
    await page.getByTestId('forbidden-header-warning').click();
    await expect(help(page)).toHaveAttribute('data-section', 'forbidden-headers');
    await expect(help(page).locator('[data-help-section="forbidden-headers"]')).toBeInViewport();
  });

  test('a CORS failure links to the CORS section', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/cors/none`);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-error')).toHaveAttribute('data-kind', 'cors-suspected');
    await page
      .getByTestId('response-error-hint')
      .getByRole('button', { name: 'Learn more about CORS' })
      .click();
    await expect(help(page)).toHaveAttribute('data-section', 'cors');
  });

  test('the first-run notice explains storage and secrets until dismissed', async ({ page }) => {
    await page.goto('/');
    const notice = page.getByTestId('web-first-run-notice');
    await expect(notice).toBeVisible();
    await notice.getByTestId('help-link').first().click();
    await expect(help(page)).toHaveAttribute('data-section', 'storage');
    await page.keyboard.press('Escape');
    await notice.getByTestId('web-first-run-dismiss').click();
    await expect(notice).toBeHidden();
    // The dismissal is written to IndexedDB asynchronously.
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expect(page.getByTestId('web-first-run-notice')).toBeHidden();
  });
});
