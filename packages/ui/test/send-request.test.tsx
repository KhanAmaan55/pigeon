import type { Capabilities, MemoryPlatform } from '@pigeon/platform';
import { createMemoryPlatform, MockTransport, TransportError } from '@pigeon/platform';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformProvider } from '../src/app/PlatformProvider';
import { TooltipProvider } from '../src/components/Tooltip';
import { RequestEditor } from '../src/features/request-editor/RequestEditor';
import { ScratchRequestProvider } from '../src/features/request-editor/ScratchRequestProvider';
import { ResponseViewer } from '../src/features/response-viewer/ResponseViewer';
import { formatBytes, formatDuration, statusText } from '../src/lib/format';
import { bodyInput, editorText, editorView, setEditorText } from './code-editor';

afterEach(cleanup);

function renderEditor(
  transport: MockTransport,
  os: MemoryPlatform['os'] = 'macos',
  capabilities: Partial<Capabilities> = {},
) {
  const platform = createMemoryPlatform({ transport, os, capabilities });
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
  return userEvent.setup();
}

describe('scratch request editor', () => {
  it('sends with the Send button and shows status, time, size and body', async () => {
    const transport = new MockTransport().on(
      { method: 'GET', url: 'http://localhost:4010/json/user' },
      { statusText: 'OK', headers: [['content-type', 'application/json']], body: '{"id":1}' },
    );
    const user = renderEditor(transport);

    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/json/user');
    await user.click(screen.getByTestId('send-button'));

    expect((await screen.findByTestId('response-status')).textContent).toContain('200 OK');
    expect(screen.getByTestId('response-status').className).toContain('text-pass');
    expect(screen.getByTestId('response-time').textContent).toMatch(/^\d+ ms$/);
    expect(screen.getByTestId('response-size').textContent).toContain('8 B');
    // JSON opens in Pretty: re-indented, values as received.
    expect((await screen.findByTestId('response-body')).textContent).toBe('{  "id": 1}');
  });

  it('sends a POST with a raw body on Cmd/Ctrl+Enter', async () => {
    const transport = new MockTransport().on({ method: 'POST', url: /\/echo$/ }, (req) => ({
      headers: [['content-type', 'text/plain']],
      body: req.body?.kind === 'bytes' ? req.body.bytes : '',
    }));
    const user = renderEditor(transport, 'linux');

    await user.selectOptions(screen.getByTestId('method-select'), 'POST');
    await user.type(screen.getByTestId('url-input'), 'localhost:4010/echo');
    await user.click(screen.getByTestId('body-tab'));
    await user.click(screen.getByTestId('body-mode-raw'));
    setEditorText(await bodyInput(), 'hello pigeon');
    editorView(await bodyInput()).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect((await screen.findByTestId('response-body')).textContent).toContain('hello pigeon');
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.method).toBe('POST');
    // Cmd/Ctrl+Enter sends; it does not insert a line in the body.
    expect(editorText(await bodyInput())).toBe('hello pigeon');
    expect(screen.getByTestId('send-button').getAttribute('title')).toBe('Send (Ctrl+Enter)');
  });

  it.each([
    ['native', 'Native', 'no CORS'],
    ['fetch', 'Browser', 'CORS applies'],
  ] as const)('labels %s responses with a %s transport badge', async (transport, label, hint) => {
    const mock = new MockTransport().on({ url: /status/ }, { body: 'ok' });
    const user = renderEditor(mock, 'macos', { transport });

    await user.type(screen.getByTestId('url-input'), 'localhost:4010/status/200{enter}');

    const badge = await screen.findByTestId('response-transport');
    expect(badge.textContent).toBe(label);
    expect(badge.getAttribute('data-transport')).toBe(transport);
    expect(badge.getAttribute('title')).toContain(hint);
  });

  it('shows a validation error for an invalid URL without calling the transport', async () => {
    const transport = new MockTransport();
    const user = renderEditor(transport);

    await user.type(screen.getByTestId('url-input'), 'http://{enter}');

    const error = await screen.findByTestId('response-error');
    expect(error.getAttribute('data-kind')).toBe('invalid-url');
    expect(error.textContent).toContain('not a valid URL');
    expect(transport.requests).toHaveLength(0);
  });

  it('shows transport errors and warnings in an error card', async () => {
    const transport = new MockTransport().on({ url: /cors\/none/ }, () => {
      throw new TransportError('cors-suspected', 'Blocked', {
        hint: 'Check CORS.',
        warnings: ['Header "User-Agent" was not sent'],
      });
    });
    const user = renderEditor(transport);

    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/cors/none{enter}');

    const error = await screen.findByTestId('response-error');
    expect(error.getAttribute('data-kind')).toBe('cors-suspected');
    expect(error.textContent).toContain('Check CORS.');
    expect(screen.getByTestId('response-warnings').textContent).toContain('User-Agent');
  });

  it('shows a loading state while the request is in flight', async () => {
    let finish: (() => void) | undefined;
    const transport = new MockTransport().on(
      { url: /slow/ },
      () => new Promise((resolve) => (finish = () => resolve({ status: 204 }))),
    );
    const user = renderEditor(transport);

    await user.type(screen.getByTestId('url-input'), 'http://localhost/slow{enter}');
    expect(await screen.findByTestId('response-loading')).toBeTruthy();
    // Send turns into Cancel while in flight.
    expect(screen.queryByTestId('send-button')).toBeNull();
    expect(screen.getByTestId('cancel-button').textContent).toContain('Cancel');

    finish?.();
    expect((await screen.findByTestId('response-status')).textContent).toContain('204 No Content');
    expect(screen.queryByTestId('response-loading')).toBeNull();
  });
});

describe('format helpers', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('formatBytes(%d) = %s', (bytes, text) => expect(formatBytes(bytes)).toBe(text));

  it.each([
    [0.4, '0 ms'],
    [42.6, '43 ms'],
    [1250, '1.25 s'],
  ])('formatDuration(%d) = %s', (ms, text) => expect(formatDuration(ms)).toBe(text));

  it('falls back to standard reason phrases', () => {
    expect(statusText(404, '')).toBe('Not Found');
    expect(statusText(200, 'Fine')).toBe('Fine');
    expect(statusText(599, '')).toBe('');
  });
});
