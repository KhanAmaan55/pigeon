import type { Capabilities } from '@pigeon/platform';
import type { PreparedRequest } from '@pigeon/platform';
import { createMemoryPlatform, MockTransport } from '@pigeon/platform';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformProvider } from '../src/app/PlatformProvider';
import { TooltipProvider } from '../src/components/Tooltip';
import { RequestEditor } from '../src/features/request-editor/RequestEditor';
import { ScratchRequestProvider } from '../src/features/request-editor/ScratchRequestProvider';
import { ResponseViewer } from '../src/features/response-viewer/ResponseViewer';
import { bodyInput, setEditorText } from './code-editor';

afterEach(cleanup);

const BROWSER: Partial<Capabilities> = { transport: 'fetch', canSetAnyHeader: false };

/** Renders the editor with a transport that records what it was asked to send. */
function renderEditor(capabilities: Partial<Capabilities> = {}) {
  const sent: PreparedRequest[] = [];
  const transport = new MockTransport().on(
    () => true,
    (req) => {
      sent.push(req);
      return { headers: [['content-type', 'text/plain']], body: 'ok' };
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
    await user.click(screen.getByTestId('send-button'));
    await screen.findByTestId('response-status');
  };
  return { user, sent, send };
}

const urlInput = () => screen.getByTestId<HTMLInputElement>('url-input');
const table = (testId: string) => screen.getByTestId(testId);
const rowsOf = (testId: string) => within(table(testId)).getAllByTestId('kv-row');
const cell = (row: HTMLElement, label: 'Key' | 'Value') =>
  within(row).getByLabelText<HTMLInputElement>(label);

describe('Params tab', () => {
  it('creates rows from the URL, and the URL follows row edits and toggles', async () => {
    const { user } = renderEditor();
    await user.type(urlInput(), 'http://localhost:4010/echo?a=1&b=2');

    let rows = rowsOf('query-table');
    expect(rows.map((row) => [cell(row, 'Key').value, cell(row, 'Value').value])).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(screen.getByTestId('params-tab-count').textContent).toBe('2');

    await user.type(cell(rows[0]!, 'Value'), '0');
    expect(urlInput().value).toBe('http://localhost:4010/echo?a=10&b=2');

    await user.click(within(rows[0]!).getByLabelText('Enable row 1'));
    expect(urlInput().value).toBe('http://localhost:4010/echo?b=2');
    rows = rowsOf('query-table');
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId('params-tab-count').textContent).toBe('1');

    // Typing in the URL keeps the disabled row; re-enabling puts it back in place.
    await user.type(urlInput(), '&c=3');
    expect(rowsOf('query-table').map((row) => cell(row, 'Key').value)).toEqual(['a', 'b', 'c']);
    await user.click(within(rowsOf('query-table')[0]!).getByLabelText('Enable row 1'));
    expect(urlInput().value).toBe('http://localhost:4010/echo?a=10&b=2&c=3');

    await user.type(cell(within(table('query-table')).getByTestId('kv-draft-row'), 'Key'), 'd');
    expect(urlInput().value).toBe('http://localhost:4010/echo?a=10&b=2&c=3&d=');
  });

  it('shows a path variable row for :name and sends its value', async () => {
    const { user, sent, send } = renderEditor();
    expect(screen.queryByTestId('path-variables-table')).toBeNull();

    await user.type(urlInput(), 'http://localhost:4010/users/:id');
    const [row] = rowsOf('path-variables-table');
    expect(cell(row!, 'Key').value).toBe('id');
    await user.type(cell(row!, 'Value'), '42');
    expect(urlInput().value).toBe('http://localhost:4010/users/:id');

    await send();
    expect(sent[0]?.url).toBe('http://localhost:4010/users/42');
  });

  it('shows {{vars}} untouched and percent-encodes values only on send', async () => {
    const { user, sent, send } = renderEditor();
    // `{{` types a literal `{` in user-event.
    await user.type(urlInput(), 'http://localhost/s?q={{{{term}}&name=Zoë Li');
    expect(rowsOf('query-table').map((row) => cell(row, 'Value').value)).toEqual([
      '{{term}}',
      'Zoë Li',
    ]);
    await user.clear(cell(rowsOf('query-table')[0]!, 'Value'));
    await user.type(cell(rowsOf('query-table')[0]!, 'Value'), 'a b');
    expect(urlInput().value).toBe('http://localhost/s?q=a b&name=Zoë Li');

    await send();
    expect(sent[0]?.url).toBe('http://localhost/s?q=a%20b&name=Zo%C3%AB%20Li');
  });
});

describe('Headers tab', () => {
  it('sends enabled headers in order, duplicates included, and counts them', async () => {
    const { user, sent, send } = renderEditor();
    await user.type(urlInput(), 'http://localhost/echo');
    await user.click(screen.getByTestId('headers-tab'));
    await user.click(screen.getByRole('button', { name: 'Bulk edit' }));
    await user.type(
      screen.getByTestId('kv-bulk-input'),
      'X-Dup: one\nX-Dup: two\n//X-Off: no\nAccept: application/json',
    );
    expect(screen.getByTestId('headers-tab-count').textContent).toBe('3');

    await send();
    expect(sent[0]?.headers).toEqual([
      ['X-Dup', 'one'],
      ['X-Dup', 'two'],
      ['Accept', 'application/json'],
      ['User-Agent', expect.stringMatching(/^Pigeon\//)],
    ]);
  });

  it('lists auto-generated headers read-only, minus ones the user overrides', async () => {
    const { user } = renderEditor();
    await user.click(screen.getByTestId('body-tab'));
    await user.click(screen.getByTestId('body-mode-raw'));
    await user.selectOptions(screen.getByTestId('raw-language-select'), 'text');
    setEditorText(await bodyInput(), 'hi');
    await user.click(screen.getByTestId('headers-tab'));

    const autoRows = () =>
      screen.getAllByTestId('auto-header-row').map((row) => row.textContent ?? '');
    expect(autoRows()).toEqual([
      expect.stringMatching(/^User-AgentPigeon\//),
      'Accept*/*',
      'Content-Typetext/plain',
    ]);
    expect(
      within(screen.getByRole('table', { name: 'Auto-generated headers' })).queryAllByRole(
        'textbox',
      ),
    ).toHaveLength(0);

    const draft = within(table('headers-table')).getByTestId('kv-draft-row');
    await user.type(cell(draft, 'Key'), 'accept');
    expect(autoRows()).toEqual([
      expect.stringMatching(/^User-AgentPigeon\//),
      'Content-Typetext/plain',
    ]);
  });

  it('in browsers, flags forbidden headers and adds no User-Agent', async () => {
    const { user } = renderEditor(BROWSER);
    await user.type(urlInput(), 'http://localhost/echo');
    await user.click(screen.getByTestId('headers-tab'));
    // The browser sends its own User-Agent, so Pigeon doesn't add one.
    expect(screen.getAllByTestId('auto-header-row').map((row) => row.textContent)).toEqual([
      'Accept*/*',
    ]);

    const draft = within(table('headers-table')).getByTestId('kv-draft-row');
    await user.type(cell(draft, 'Key'), 'X-Fine');
    expect(screen.queryByTestId('forbidden-header-warning')).toBeNull();
    await user.clear(cell(rowsOf('headers-table')[0]!, 'Key'));
    await user.type(cell(rowsOf('headers-table')[0]!, 'Key'), 'Cookie');
    const warning = within(rowsOf('headers-table')[0]!).getByTestId('forbidden-header-warning');
    expect(warning.getAttribute('aria-label')).toContain('Cookie');
  });

  it('does not flag forbidden headers where any header can be set', async () => {
    const { user } = renderEditor();
    await user.click(screen.getByTestId('headers-tab'));
    const draft = within(table('headers-table')).getByTestId('kv-draft-row');
    await user.type(cell(draft, 'Key'), 'Cookie');
    expect(screen.queryByTestId('forbidden-header-warning')).toBeNull();
  });
});
