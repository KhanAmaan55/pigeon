import { diagnosticCount, forceLinting } from '@codemirror/lint';
import type { Capabilities, PreparedRequest } from '@pigeon/platform';
import { createMemoryPlatform, MockTransport } from '@pigeon/platform';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformProvider } from '../src/app/PlatformProvider';
import { TooltipProvider } from '../src/components/Tooltip';
import { RequestEditor } from '../src/features/request-editor/RequestEditor';
import { ScratchRequestProvider } from '../src/features/request-editor/ScratchRequestProvider';
import { ResponseViewer } from '../src/features/response-viewer/ResponseViewer';
import { beautifyJson } from '../src/lib/json-format';
import { bodyInput, editorText, editorView, setEditorText } from './code-editor';

afterEach(cleanup);

const WEB: Partial<Capabilities> = {
  transport: 'fetch',
  canSetAnyHeader: false,
  canSendBodyWithGet: false,
};
const decoder = new TextDecoder();

function renderEditor(capabilities: Partial<Capabilities> = {}) {
  const sent: PreparedRequest[] = [];
  const transport = new MockTransport().on(
    () => true,
    (req) => {
      sent.push(req);
      return { body: 'ok' };
    },
  );
  const platform = createMemoryPlatform({ transport, capabilities });
  render(
    <PlatformProvider platform={platform}>
      <TooltipProvider>
        <ScratchRequestProvider>
          <RequestEditor />
          <ResponseViewer />
        </ScratchRequestProvider>
      </TooltipProvider>
    </PlatformProvider>,
  );
  const user = userEvent.setup();
  const send = async () => {
    const before = sent.length;
    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(screen.queryByTestId('response-loading')).toBeNull());
    return sent.length > before ? sent[sent.length - 1] : undefined;
  };
  return { user, send, sent, platform };
}

async function setup(method: string, capabilities?: Partial<Capabilities>) {
  const ctx = renderEditor(capabilities);
  await ctx.user.selectOptions(screen.getByTestId('method-select'), method);
  await ctx.user.type(screen.getByTestId('url-input'), 'localhost:4010/echo');
  await ctx.user.click(screen.getByTestId('body-tab'));
  return ctx;
}

const header = (req: PreparedRequest | undefined, name: string) =>
  req?.headers.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
const bytesOf = (req: PreparedRequest | undefined) =>
  req?.body?.kind === 'bytes' ? decoder.decode(req.body.bytes) : undefined;

describe('Body tab', () => {
  it('starts with no body and offers every mode', async () => {
    await setup('POST');
    const modes = within(screen.getByRole('radiogroup', { name: 'Body type' }));
    expect(modes.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'none',
      'formdata',
      'urlencoded',
      'raw',
      'file',
    ]);
    expect((screen.getByTestId('body-mode-none') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('body-tab-indicator')).toBeNull();
  });

  it('sends raw JSON exactly as typed with application/json', async () => {
    const { user, send } = await setup('POST');
    await user.click(screen.getByTestId('body-mode-raw'));
    expect((screen.getByTestId('raw-language-select') as HTMLSelectElement).value).toBe('json');
    const json = '{ "id": 12345678901234567890,\n  "name": "Ada" }';
    setEditorText(await bodyInput(), json);

    const req = await send();
    expect(bytesOf(req)).toBe(json);
    expect(header(req, 'content-type')).toEqual(['application/json']);
    expect(screen.getByTestId('body-tab-indicator')).toBeTruthy();
  });

  it('lints invalid JSON but still sends it', async () => {
    const { user, send } = await setup('POST');
    await user.click(screen.getByTestId('body-mode-raw'));
    const input = await bodyInput();
    setEditorText(input, '{"a": }');
    const view = editorView(input);
    await waitFor(() => {
      forceLinting(view);
      expect(diagnosticCount(view.state)).toBe(1);
    });

    expect(bytesOf(await send())).toBe('{"a": }');
  });

  it('uses the language for the default Content-Type, and a user header wins', async () => {
    const { user, send } = await setup('PUT');
    await user.click(screen.getByTestId('body-mode-raw'));
    await user.selectOptions(screen.getByTestId('raw-language-select'), 'xml');
    setEditorText(await bodyInput(), '<a/>');
    expect(header(await send(), 'content-type')).toEqual(['application/xml']);

    await user.click(screen.getByTestId('headers-tab'));
    const table = within(screen.getByTestId('headers-table'));
    await user.type(table.getAllByRole('textbox', { name: 'Key' }).at(-1)!, 'Content-Type');
    await user.type(table.getAllByRole('textbox', { name: 'Value' })[0]!, 'text/xml');
    expect(header(await send(), 'content-type')).toEqual(['text/xml']);
  });

  it('beautifies JSON without changing numbers, and leaves invalid JSON alone', async () => {
    const { user } = await setup('POST');
    await user.click(screen.getByTestId('body-mode-raw'));
    const input = await bodyInput();
    setEditorText(input, '{"n":12345678901234567890,"a":[1.0,{}],"s":"x\\"y"}');
    await user.click(screen.getByTestId('beautify-button'));
    expect(editorText(input)).toBe(
      '{\n  "n": 12345678901234567890,\n  "a": [\n    1.0,\n    {}\n  ],\n  "s": "x\\"y"\n}',
    );

    setEditorText(input, '{nope');
    await user.click(screen.getByTestId('beautify-button'));
    expect(editorText(input)).toBe('{nope');
    expect(screen.getByTestId('beautify-button').getAttribute('title')).toMatch(/not valid/);

    await user.selectOptions(screen.getByTestId('raw-language-select'), 'text');
    expect(screen.queryByTestId('beautify-button')).toBeNull();
  });

  it('keeps each mode’s content when switching, but sends only the active mode', async () => {
    const { user, send } = await setup('POST');
    await user.click(screen.getByTestId('body-mode-raw'));
    setEditorText(await bodyInput(), '{"keep":true}');

    await user.click(screen.getByTestId('body-mode-urlencoded'));
    const table = within(screen.getByTestId('urlencoded-table'));
    await user.type(table.getByRole('textbox', { name: 'Key' }), 'q');
    await user.type(table.getAllByRole('textbox', { name: 'Value' })[0]!, 'a b&c=d');
    const urlencoded = await send();
    expect(bytesOf(urlencoded)).toBe('q=a+b%26c%3Dd');
    expect(header(urlencoded, 'content-type')).toEqual(['application/x-www-form-urlencoded']);

    await user.click(screen.getByTestId('body-mode-raw'));
    expect(editorText(await bodyInput())).toBe('{"keep":true}');
    expect(bytesOf(await send())).toBe('{"keep":true}');

    await user.click(screen.getByTestId('body-mode-urlencoded'));
    expect(
      within(screen.getByTestId('urlencoded-table')).getAllByRole('textbox')[0],
    ).toHaveProperty('value', 'q');
    await user.click(screen.getByTestId('body-mode-none'));
    const none = await send();
    expect(none?.body).toBeUndefined();
    expect(header(none, 'content-type')).toEqual([]);
  });

  it('sends form-data text fields and picked files as multipart parts', async () => {
    const { user, send, platform } = await setup('POST');
    await user.click(screen.getByTestId('body-mode-formdata'));
    const table = () => within(screen.getByTestId('formdata-table'));

    await user.type(table().getByRole('textbox', { name: 'Key' }), 'name');
    await user.type(table().getAllByRole('textbox', { name: 'Value' })[0]!, 'Ada');
    await user.type(table().getAllByRole('textbox', { name: 'Key' }).at(-1)!, 'avatar');
    await user.selectOptions(table().getAllByTestId('formdata-kind-select')[1]!, 'file');
    const upload = new File([new Uint8Array([137, 80, 78, 71])], 'pixel.png', {
      type: 'image/png',
    });
    await user.upload(table().getByTestId('formdata-file-input'), upload);
    await waitFor(() => expect(table().getAllByTestId('file-chip')).toHaveLength(1));
    expect(table().getByTestId('file-chip').textContent).toBe('pixel.png');
    await user.type(table().getAllByRole('textbox', { name: 'Content type' })[0]!, 'text/plain');

    await user.click(screen.getByTestId('headers-tab'));
    expect(screen.getAllByTestId('auto-header-row').map((row) => row.textContent)).toContainEqual(
      expect.stringContaining('multipart/form-data; boundary=<calculated'),
    );
    await user.click(screen.getByTestId('body-tab'));

    const req = await send();
    expect(header(req, 'content-type')).toEqual([]);
    expect(req?.body?.kind).toBe('multipart');
    const parts = req?.body?.kind === 'multipart' ? req.body.parts : [];
    expect(parts).toMatchObject([
      { name: 'name', kind: 'text', value: 'Ada', contentType: 'text/plain' },
      { name: 'avatar', kind: 'file', filename: 'pixel.png', contentType: 'image/png' },
    ]);
    const file = parts[1]?.kind === 'file' ? parts[1].file : undefined;
    expect(file?.kind).toBe('picked');
    expect(file?.kind === 'picked' && platform.pickedFiles.get(file.id)).toMatchObject({
      name: 'pixel.png',
      bytes: new Uint8Array([137, 80, 78, 71]),
      mime: 'image/png',
    });

    await user.click(within(table().getByTestId('file-chip')).getByRole('button'));
    expect(table().queryByTestId('file-chip')).toBeNull();
  });

  it('sends a picked binary file with a Content-Type from its extension', async () => {
    const { user, send, platform } = await setup('POST');
    await user.click(screen.getByTestId('body-mode-file'));
    await user.upload(
      screen.getByTestId('binary-file-input'),
      new File([new Uint8Array([0, 1, 255])], 'dump.pdf'),
    );
    await waitFor(() => expect(screen.getByTestId('file-chip').textContent).toBe('dump.pdf'));

    const req = await send();
    expect(header(req, 'content-type')).toEqual(['application/pdf']);
    expect(req?.body?.kind).toBe('file');
    const ref = req?.body?.kind === 'file' ? req.body.ref : undefined;
    expect(ref?.kind === 'picked' && platform.pickedFiles.get(ref.id)?.bytes).toEqual(
      new Uint8Array([0, 1, 255]),
    );
  });

  it('blocks GET with a body on web with a validation error', async () => {
    const { user, send } = await setup('GET', WEB);
    await user.click(screen.getByTestId('body-mode-raw'));
    setEditorText(await bodyInput(), '{}');
    expect(screen.getByTestId('get-body-notice').textContent).toMatch(/Browsers can't send/);

    expect(await send()).toBeUndefined();
    const error = screen.getByTestId('response-error');
    expect(error.getAttribute('data-kind')).toBe('invalid-request');
    expect(error.textContent).toContain('GET requests cannot have a body here.');

    await user.click(screen.getByTestId('settings-tab'));
    expect((screen.getByTestId('setting-send-body-with-get') as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it('drops a GET body on desktop with a warning unless "Send body with GET" is on', async () => {
    const { user, send } = await setup('GET');
    await user.click(screen.getByTestId('body-mode-raw'));
    setEditorText(await bodyInput(), '{"q":1}');
    expect(screen.getByTestId('get-body-notice').textContent).toMatch(/Send body with GET/);

    const dropped = await send();
    expect(dropped?.body).toBeUndefined();
    expect(header(dropped, 'content-type')).toEqual([]);
    expect(screen.getByTestId('response-warnings').textContent).toContain(
      'The body was not sent: GET requests are sent without a body',
    );

    await user.click(screen.getByTestId('settings-tab'));
    await user.click(screen.getByTestId('setting-send-body-with-get'));
    await user.click(screen.getByTestId('body-tab'));
    expect(screen.queryByTestId('get-body-notice')).toBeNull();
    const sent = await send();
    expect(bytesOf(sent)).toBe('{"q":1}');
    expect(header(sent, 'content-type')).toEqual(['application/json']);
    expect(screen.queryByTestId('response-warnings')).toBeNull();
  });
});

describe('beautifyJson', () => {
  it.each([
    ['[]', '[]'],
    ['{ }', '{}'],
    ['[ 1 , [ ] ]', '[\n  1,\n  []\n]'],
    ['"a , : { b"', '"a , : { b"'],
    ['{"a":{"b":null}}', '{\n  "a": {\n    "b": null\n  }\n}'],
    ['  -1.50e+10 ', '-1.50e+10'],
  ])('%s', (input, output) => {
    expect(beautifyJson(input)).toBe(output);
  });

  it('returns null for invalid JSON', () => {
    expect(beautifyJson('{"a":1,}')).toBeNull();
    expect(beautifyJson('')).toBeNull();
  });
});
