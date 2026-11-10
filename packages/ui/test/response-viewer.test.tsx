import type { Capabilities, MockResponseInit } from '@pigeon/platform';
import { createMemoryPlatform, MockTransport } from '@pigeon/platform';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MainArea } from '../src/app/MainArea';
import { PlatformProvider } from '../src/app/PlatformProvider';
import { RequestEditor } from '../src/features/request-editor/RequestEditor';
import { ScratchRequestProvider } from '../src/features/request-editor/ScratchRequestProvider';
import { ResponseViewer } from '../src/features/response-viewer/ResponseViewer';

const MIB = 1024 * 1024;
const JSON_TYPE: Array<[string, string]> = [['content-type', 'application/json']];

beforeEach(() => {
  // jsdom has no blob URLs.
  URL.createObjectURL = vi.fn(() => 'blob:pigeon/test');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

/** Renders the editor and viewer, sends one request answered by `reply`. */
async function respond(reply: MockResponseInit, capabilities: Partial<Capabilities> = {}) {
  const transport = new MockTransport().on(() => true, reply);
  const platform = createMemoryPlatform({ transport, capabilities, os: 'linux' });
  render(
    <PlatformProvider platform={platform}>
      <ScratchRequestProvider>
        <RequestEditor />
        <ResponseViewer />
      </ScratchRequestProvider>
    </PlatformProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByTestId('url-input'), 'localhost:4010/thing{enter}');
  await screen.findByTestId('response-status');
  // The body view is a lazy chunk.
  await waitFor(() => expect(screen.queryByTestId('response-body-loading')).toBeNull());
  return { user, platform };
}

const mode = () => screen.getByTestId('response-body-mode').getAttribute('data-mode');
const views = () =>
  within(screen.getByRole('radiogroup', { name: 'Body view' }))
    .getAllByRole('radio')
    .map((radio) => radio.textContent);

describe('response body views', () => {
  it('opens JSON in Pretty with fold markers, and Raw shows the bytes as received', async () => {
    const { user } = await respond({ headers: JSON_TYPE, body: '{"a":{"b":[1,2]}}' });
    expect(views()).toEqual(['Pretty', 'Raw']);
    expect(mode()).toBe('pretty');
    const body = await screen.findByTestId('response-body');
    expect(body.textContent).toBe('{  "a": {    "b": [      1,      2    ]  }}');
    await waitFor(() => expect(document.querySelector('.cm-foldGutter')).not.toBeNull());

    await user.click(screen.getByTestId('response-view-raw'));
    expect(mode()).toBe('raw');
    expect((await screen.findByTestId('response-body')).textContent).toBe('{"a":{"b":[1,2]}}');
  });

  it('opens plain text in Raw with no Pretty view', async () => {
    await respond({ headers: [['content-type', 'text/plain']], body: 'hello' });
    expect(screen.queryByRole('radiogroup', { name: 'Body view' })).toBeNull();
    expect(mode()).toBe('raw');
    expect((await screen.findByTestId('response-body')).textContent).toBe('hello');
  });

  it('previews HTML in a sandboxed iframe that allows nothing', async () => {
    const html = '<p id="s">no</p><script>document.getElementById("s").textContent="yes"</script>';
    const { user } = await respond({ headers: [['content-type', 'text/html']], body: html });
    expect(views()).toEqual(['Pretty', 'Raw', 'Preview']);
    expect(mode()).toBe('pretty');

    await user.click(screen.getByTestId('response-view-preview'));
    const frame = screen.getByTestId('response-preview') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe(html);
  });

  it('previews images from a blob URL of the exact bytes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await respond({ headers: [['content-type', 'image/png']], body: png });
    expect(mode()).toBe('preview');
    expect(screen.getByTestId('response-preview-image').getAttribute('src')).toBe(
      'blob:pigeon/test',
    );
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
  });

  it('summarizes other binary bodies as hex and saves their exact bytes', async () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    const { user, platform } = await respond({
      headers: [['content-type', 'application/octet-stream']],
      body: bytes,
    });
    expect(screen.getByTestId('response-binary').textContent).toContain('300 B');
    expect(screen.getByTestId('response-hex').textContent).toMatch(
      /^00000000 {2}00 01 02 03 04 05 06 07 {2}08 09 0a 0b 0c 0d 0e 0f {2}\|\.{16}\|/,
    );
    expect(screen.getByTestId('response-copy').className).toContain('pointer-events-none');

    await user.click(screen.getByTestId('response-save'));
    await waitFor(() => expect(platform.files.saved).toHaveLength(1));
    expect(platform.files.saved[0]).toEqual({
      name: 'thing.bin',
      data: bytes,
      mime: 'application/octet-stream',
    });
    expect(screen.getByTestId('response-save-status').textContent).toBe('Saved');
  });

  it('shows an empty body as such', async () => {
    await respond({ status: 204 });
    expect(screen.getByTestId('response-body-empty').textContent).toBe('Empty response body');
  });
});

describe('large bodies', () => {
  const bigJson = (bytes: number) => `[${'1,'.repeat(Math.floor(bytes / 2))}1]`;

  it('open in Raw over 2 MB until "Format anyway"', async () => {
    const { user } = await respond({ headers: JSON_TYPE, body: bigJson(2.1 * MIB) });
    expect(mode()).toBe('raw');
    expect(screen.getByTestId('response-body-large').textContent).toContain('shown raw');

    await user.click(screen.getByTestId('response-format-anyway'));
    expect(mode()).toBe('pretty');
    await waitFor(() => expect(screen.queryByTestId('response-body-formatting')).toBeNull());
    expect((await screen.findByTestId('response-body')).textContent).toMatch(/^\[ {2}1, {2}1,/);
    expect(screen.queryByTestId('response-body-large')).toBeNull();
  });

  it('show only the first 2 MB over 20 MB; desktop can show all', async () => {
    const { user } = await respond({ headers: JSON_TYPE, body: bigJson(21 * MIB) });
    const notice = screen.getByTestId('response-body-truncated');
    expect(notice.textContent).toMatch(/first 2\.0 MB of 21\.0 MB/);
    expect(screen.getByTestId('response-view-pretty')).toHaveProperty('disabled', true);

    await user.click(within(notice).getByTestId('response-show-all'));
    expect(screen.queryByTestId('response-body-truncated')).toBeNull();
    expect(screen.getByTestId('response-view-pretty')).toHaveProperty('disabled', false);
  });

  it('offer only Save over 20 MB in the browser', async () => {
    const { user, platform } = await respond(
      { headers: JSON_TYPE, body: bigJson(21 * MIB) },
      { transport: 'fetch' },
    );
    const notice = screen.getByTestId('response-body-truncated');
    expect(within(notice).queryByTestId('response-show-all')).toBeNull();
    await user.click(within(notice).getByRole('button', { name: /Save to file/ }));
    await waitFor(() => expect(platform.files.saved).toHaveLength(1));
    expect((platform.files.saved[0]?.data as Uint8Array).byteLength).toBeGreaterThan(21 * MIB);
  });
});

describe('response actions and headers', () => {
  it('copies the body as received', async () => {
    const { user } = await respond({ headers: JSON_TYPE, body: '{"a":1}' });
    await user.click(screen.getByTestId('response-copy'));
    expect(await navigator.clipboard.readText()).toBe('{"a":1}');
    expect(screen.getByTestId('response-copy').getAttribute('data-state')).toBe('copied');
  });

  it('reports a cancelled or failed save', async () => {
    const { user, platform } = await respond({ headers: JSON_TYPE, body: '{}' });
    const saveFile = vi.spyOn(platform.files, 'saveFile');
    saveFile.mockResolvedValueOnce('cancelled' as 'saved');
    await user.click(screen.getByTestId('response-save'));
    expect((await screen.findByTestId('response-save-status')).textContent).toBe('Not saved');

    saveFile.mockRejectedValueOnce(new Error('Disk full'));
    await user.click(screen.getByTestId('response-save'));
    await waitFor(() =>
      expect(screen.getByTestId('response-save-status').textContent).toBe('Disk full'),
    );
  });

  it('lists headers in order with duplicates, and copies a row', async () => {
    const { user } = await respond({
      headers: [
        ['content-type', 'text/plain'],
        ['set-cookie', 'a=1'],
        ['set-cookie', 'b=2'],
      ],
      body: 'x',
    });
    expect(screen.getByTestId('response-headers-count').textContent).toBe('3');
    await user.click(screen.getByTestId('response-headers-tab'));
    const rows = screen.getAllByTestId('response-header-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'content-typetext/plain',
      'set-cookiea=1',
      'set-cookieb=2',
    ]);
    expect(screen.queryByTestId('response-headers-restricted')).toBeNull();

    await user.click(within(rows[2]!).getByRole('button', { name: 'Copy header set-cookie' }));
    expect(await navigator.clipboard.readText()).toBe('set-cookie: b=2');
  });

  it('says when the browser hid headers', async () => {
    const { user } = await respond({ body: 'x', headersRestricted: true }, { transport: 'fetch' });
    await user.click(screen.getByTestId('response-headers-tab'));
    expect(screen.getByTestId('response-headers-restricted').textContent).toContain(
      'Some headers are hidden by the browser',
    );
  });

  it('explains the size: decoded, and by the browser on web', async () => {
    await respond({ body: 'x'.repeat(2048) }, { transport: 'fetch' });
    const size = screen.getByTestId('response-size');
    expect(size.textContent).toBe('2.0 KB');
    expect(size.getAttribute('title')).toBe(
      '2,048 bytes, decoded by the browser (the compressed size on the wire is not visible to web pages)',
    );
  });
});

describe('response dock', () => {
  beforeEach(() => {
    // react-resizable-panels measures with ResizeObserver, which jsdom lacks.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves the response between bottom and right on Ctrl/Cmd+Alt+L', async () => {
    render(
      <PlatformProvider platform={createMemoryPlatform({ os: 'linux' })}>
        <MainArea />
      </PlatformProvider>,
    );
    const user = userEvent.setup();
    const dock = () => screen.getByTestId('request-response-split').getAttribute('data-dock');
    expect(dock()).toBe('bottom');

    await user.keyboard('{Control>}{Alt>}l{/Alt}{/Control}');
    expect(dock()).toBe('right');
    await user.keyboard('{Shift>}{Control>}{Alt>}l{/Alt}{/Control}{/Shift}');
    expect(dock()).toBe('right');
    await user.keyboard('{Meta>}{Alt>}l{/Alt}{/Meta}');
    expect(dock()).toBe('bottom');
  });

  it('offers a toggle button naming where the response goes', async () => {
    const onToggleDock = vi.fn();
    const transport = new MockTransport().on(() => true, { body: 'ok' });
    render(
      <PlatformProvider platform={createMemoryPlatform({ transport, os: 'macos' })}>
        <ScratchRequestProvider>
          <RequestEditor />
          <ResponseViewer dock="right" onToggleDock={onToggleDock} />
        </ScratchRequestProvider>
      </PlatformProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId('url-input'), 'localhost/x{enter}');
    const toggle = await screen.findByTestId('response-dock-toggle');
    expect(toggle.getAttribute('aria-label')).toBe('Move response to the bottom (⌘⌥L)');
    await user.click(toggle);
    expect(onToggleDock).toHaveBeenCalledOnce();
  });
});
