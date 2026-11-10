import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { TEST_SERVER_URL } from '../test-server';
import { sendAndEcho } from './echo';

/** The parts of `/echo`'s JSON these tests read. */
interface Echo {
  method: string;
  rawHeaders: Array<[string, string]>;
  body: { size: number; text: string | null; sha256: string };
  parsed: unknown;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function postToEcho(page: Page, mode: string) {
  await page.getByTestId('method-select').selectOption('POST');
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/echo`);
  await page.getByTestId('body-tab').click();
  await page.getByTestId(`body-mode-${mode}`).check();
}

const contentType = (echo: Echo) =>
  echo.rawHeaders.filter(([name]) => name.toLowerCase() === 'content-type').map(([, v]) => v);

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('a raw JSON body is sent byte for byte as application/json', async ({ page }) => {
  await postToEcho(page, 'raw');
  const json = '{\n  "id": 12345678901234567890,\n  "name": "Ada ✓",\n  "tags": [ ]\n}';
  await page.getByTestId('body-input').fill(json);

  const echo = await sendAndEcho<Echo>(page);
  expect(echo.body.text).toBe(json);
  expect(contentType(echo)).toEqual(['application/json']);
});

test('invalid JSON shows an inline lint marker but is still sent', async ({ page }) => {
  await postToEcho(page, 'raw');
  await page.getByTestId('body-input').fill('{"a": }');
  // Inline marker (a point here: the error is at the `}`) and a gutter marker.
  await expect(page.locator('.cm-lintRange-error, .cm-lintPoint-error')).toHaveCount(1);
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(1);

  const echo = await sendAndEcho<Echo>(page);
  expect(echo.body.text).toBe('{"a": }');
  expect(echo.parsed).toMatchObject({ kind: 'invalid' });
});

test('Beautify re-indents JSON', async ({ page }) => {
  await postToEcho(page, 'raw');
  await page.getByTestId('body-input').fill('{"a":[1,2],"b":{}}');
  await page.getByTestId('beautify-button').click();
  await expect(page.getByTestId('body-input')).toHaveText(
    // CodeMirror renders one element per line.
    ['{', '  "a": [', '    1,', '    2', '  ],', '  "b": {}', '}'].join(''),
  );
});

test('an urlencoded body with special characters is parsed back exactly', async ({ page }) => {
  await postToEcho(page, 'urlencoded');
  const rows = page.getByTestId('urlencoded-table');
  const fields: Array<[string, string]> = [
    ['q', 'a b&c=d+e'],
    ['emoji', 'ü ✓ 🐦'],
    ['pct', '100% {{x}}'],
  ];
  for (const [index, [key, value]] of fields.entries()) {
    await rows.getByLabel('Key').nth(index).fill(key);
    await rows.getByLabel('Value').nth(index).fill(value);
  }

  const echo = await sendAndEcho<Echo>(page);
  expect(echo.parsed).toEqual({ kind: 'urlencoded', fields });
  expect(contentType(echo)).toEqual(['application/x-www-form-urlencoded']);
});

test('form-data with two text fields and a file arrives with names, file name, size and type', async ({
  page,
}) => {
  await postToEcho(page, 'formdata');
  const table = page.getByTestId('formdata-table');
  await table.getByLabel('Key').nth(0).fill('name');
  await table.getByLabel('Value').nth(0).fill('Ada Lovelace');
  await table.getByLabel('Key').nth(1).fill('note');
  await table.getByLabel('Value').nth(1).fill('héllo & "quotes"');
  await table.getByLabel('Key').nth(2).fill('avatar');
  await table.getByTestId('formdata-kind-select').nth(2).selectOption('file');
  const png = Buffer.from(Uint8Array.from({ length: 2048 }, (_, i) => (i * 7) % 256));
  await table
    .getByTestId('formdata-file-input')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await expect(table.getByTestId('file-chip')).toHaveText('avatar.png');

  const echo = await sendAndEcho<Echo>(page);
  expect(contentType(echo)[0]).toMatch(/^multipart\/form-data; boundary=/);
  expect(echo.parsed).toEqual({
    kind: 'multipart',
    parts: [
      { name: 'name', kind: 'text', value: 'Ada Lovelace' },
      { name: 'note', kind: 'text', value: 'héllo & "quotes"' },
      {
        name: 'avatar',
        kind: 'file',
        filename: 'avatar.png',
        contentType: 'image/png',
        size: png.byteLength,
        sha256: sha256(png),
      },
    ],
  });
});

test('a binary body from a picked file arrives byte for byte', async ({ page }) => {
  await postToEcho(page, 'file');
  const bytes = Buffer.from(Uint8Array.from({ length: 4096 }, (_, i) => (i * 31) % 256));
  await page
    .getByTestId('binary-file-input')
    .setInputFiles({ name: 'dump.bin', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.getByTestId('file-chip')).toHaveText('dump.bin');

  const echo = await sendAndEcho<Echo>(page);
  expect([echo.body.size, echo.body.sha256]).toEqual([bytes.byteLength, sha256(bytes)]);
  expect(contentType(echo)).toEqual(['application/octet-stream']);
});

test('GET with a body shows a validation error in the browser', async ({ page }) => {
  await page.getByTestId('url-input').fill(`${TEST_SERVER_URL}/echo`);
  await page.getByTestId('body-tab').click();
  await page.getByTestId('body-mode-raw').check();
  await page.getByTestId('body-input').fill('{}');
  await expect(page.getByTestId('get-body-notice')).toBeVisible();
  await page.getByTestId('send-button').click();

  const error = page.getByTestId('response-error');
  await expect(error).toHaveAttribute('data-kind', 'invalid-request');
  await expect(error).toContainText('GET requests cannot have a body here.');
});
