import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';

/**
 * Sends the request in the editor and returns `/echo`'s JSON as the browser received it. Read
 * from the network rather than the response viewer: the viewer is a CodeMirror editor that only
 * keeps the lines on screen in the DOM.
 */
export async function sendAndEcho<T>(page: Page, send?: () => Promise<void>): Promise<T> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().startsWith(`${TEST_SERVER_URL}/echo`) && res.request().method() !== 'OPTIONS',
    ),
    send ? send() : page.getByTestId('send-button').click(),
  ]);
  await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  return (await response.json()) as T;
}
