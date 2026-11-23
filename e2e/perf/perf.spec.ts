import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { generateLargeProject } from '../../packages/fixtures/src/generate-large-project';
import { TEST_SERVER_URL } from '../test-server';
import '../web/hooks';

/**
 * ui-ux.md §7 budgets with 20 % tolerance (PIGN-042). Each test logs its measurement so a run
 * records the numbers.
 */
const TOLERANCE = 1.2;
const record = (name: string, ms: number, budget: number) => {
  console.log(`perf: ${name} ${ms.toFixed(1)} ms (budget ${budget} ms)`);
  expect(ms, name).toBeLessThan(budget * TOLERANCE);
};

async function openLargeProject(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__pigeonTest !== undefined);
  await page.evaluate(
    (files) => window.__pigeonTest!.preloadProject(files),
    generateLargeProject(),
  );
  const started = Date.now();
  await page.getByTestId('open-folder').click();
  // Interactive: the tree shows, and a folder expands on click.
  const items = page.getByTestId('explorer-item');
  await items.filter({ hasText: 'Folder 000' }).click();
  await expect(items.filter({ hasText: 'Request 0 list resource' })).toBeVisible();
  return Date.now() - started;
}

test.describe('performance budgets', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'folder access is Chromium-only');
  test.setTimeout(120_000);

  test('open a 5,000-request project, scroll the explorer, switch tabs, type', async ({ page }) => {
    record('open 5,000-request project', await openLargeProject(page), 2000);

    // Explorer scroll: no long task (> 50 ms) while scrolling through expanded folders.
    const items = page.getByTestId('explorer-item');
    for (const folder of ['Folder 001', 'Folder 002', 'Folder 003', 'Folder 004']) {
      await items.filter({ hasText: folder }).click();
    }
    await page.evaluate(() => {
      const w = window as unknown as { __longTasks: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
      }).observe({ type: 'longtask' });
    });
    const tree = page.getByRole('tree', { name: 'Collections' });
    await tree.hover();
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400);
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300);
    const longTasks = await page.evaluate(
      () => (window as unknown as { __longTasks: number[] }).__longTasks,
    );
    record('explorer scroll: longest task', Math.max(0, ...longTasks), 50);

    // Tab switch: two pinned tabs, then click → the other request is in the editor.
    await items.filter({ hasText: 'Request 0 list resource' }).dblclick();
    await items.filter({ hasText: 'Request 1 create resource' }).dblclick();
    await expect(page.getByTestId('request-tab')).toHaveCount(2);
    const switches: number[] = [];
    for (let i = 0; i < 6; i++) {
      const name = i % 2 === 0 ? 'Request 0 list resource' : 'Request 1 create resource';
      const url = i % 2 === 0 ? '/resources/0?page=1' : '/resources/1?page=1';
      switches.push(
        await page.evaluate(
          async ({ name, url }) => {
            const tab = [...document.querySelectorAll('[data-testid="request-tab"]')].find((t) =>
              t.textContent?.includes(name),
            ) as HTMLElement;
            const input = () =>
              (document.querySelector('[data-testid="url-input"]') as HTMLInputElement | null)
                ?.value ?? '';
            const started = performance.now();
            tab.click();
            while (!input().endsWith(url)) await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            return performance.now() - started;
          },
          { name, url },
        ),
      );
    }
    record('tab switch (median)', switches.sort((a, b) => a - b)[3]!, 50);

    // Keystroke latency in the URL editor (Event Timing: handler time for each key).
    await page.evaluate(() => {
      const w = window as unknown as { __events: Array<{ processing: number; duration: number }> };
      w.__events = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEventTiming[]) {
          if (entry.name === 'keydown' || entry.name === 'keypress' || entry.name === 'input') {
            w.__events.push({
              processing: entry.processingEnd - entry.processingStart,
              duration: entry.duration,
            });
          }
        }
      }).observe({
        type: 'event',
        durationThreshold: 16,
        buffered: false,
      } as PerformanceObserverInit);
    });
    await page.getByTestId('url-input').click();
    await page.keyboard.press('End');
    await page.keyboard.type('&filter=active&sort=name&order=asc', { delay: 30 });
    await page.waitForTimeout(500);
    const events = await page.evaluate(
      () => (window as unknown as { __events: Array<{ processing: number }> }).__events,
    );
    record('keystroke handling (slowest)', Math.max(0, ...events.map((e) => e.processing)), 16);
  });

  test('render a 5 MB JSON response raw and pretty', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/large/5`);
    const started = Date.now();
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('response-body-mode')).toHaveAttribute('data-mode', 'raw');
    await expect(page.getByTestId('response-body')).toContainText('"id"');
    record('5 MB response raw (send → shown)', Date.now() - started, 1000);
    const pretty = Date.now();
    await page.getByTestId('response-format-anyway').click();
    await expect(page.getByTestId('response-body-mode')).toHaveAttribute('data-mode', 'pretty', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('response-body')).toContainText('"id": 0');
    record('5 MB response pretty', Date.now() - pretty, 2000);
  });
});
