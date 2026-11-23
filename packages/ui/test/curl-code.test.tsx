import { createMemoryPlatform, MockTransport } from '@pigeon/platform';
import type { PreparedRequest } from '@pigeon/platform';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformProvider } from '../src/app/PlatformProvider';
import { TooltipProvider } from '../src/components/Tooltip';
import { RequestEditor } from '../src/features/request-editor/RequestEditor';
import { ScratchRequestProvider } from '../src/features/request-editor/ScratchRequestProvider';
import { ResponseViewer } from '../src/features/response-viewer/ResponseViewer';

afterEach(cleanup);

function renderEditor() {
  const sent: PreparedRequest[] = [];
  const transport = new MockTransport().on(
    () => true,
    (req) => {
      sent.push(req);
      return { headers: [['content-type', 'text/plain']], body: 'ok' };
    },
  );
  render(
    <PlatformProvider platform={createMemoryPlatform({ transport })}>
      <TooltipProvider>
        <ScratchRequestProvider>
          <RequestEditor />
          <ResponseViewer />
        </ScratchRequestProvider>
      </TooltipProvider>
    </PlatformProvider>,
  );
  return { user: userEvent.setup(), sent };
}

const CURL = `curl 'http://localhost:4010/echo?a=1' \\
  -H 'content-type: application/json' \\
  -H 'x-trace: abc' \\
  -u 'ada:secret-pw' \\
  --data-raw '{"name":"Ada"}'`;

describe('cURL paste and Code tab (PIGN-050)', () => {
  it('pasting cURL into the URL bar fills the request, which then sends', async () => {
    const { user, sent } = renderEditor();
    await user.click(screen.getByTestId('url-input'));
    await user.paste(CURL);
    expect(screen.getByTestId<HTMLInputElement>('url-input').value).toBe(
      'http://localhost:4010/echo?a=1',
    );
    expect(screen.getByTestId<HTMLSelectElement>('method-select').value).toBe('POST');
    expect(screen.getByTestId('headers-tab-count').textContent).toBe('2');
    expect(screen.getByTestId('auth-tab-indicator')).toBeTruthy();

    await user.click(screen.getByTestId('send-button'));
    await screen.findByTestId('response-status');
    const [request] = sent;
    expect(request?.method).toBe('POST');
    expect(new TextDecoder().decode((request?.body as { bytes: Uint8Array }).bytes)).toBe(
      '{"name":"Ada"}',
    );
    expect(request?.headers).toContainEqual(['Authorization', `Basic ${btoa('ada:secret-pw')}`]);
  });

  it('plain text pastes into the URL bar as usual', async () => {
    const { user } = renderEditor();
    await user.click(screen.getByTestId('url-input'));
    await user.paste('http://example.com/curl');
    expect(screen.getByTestId<HTMLInputElement>('url-input').value).toBe('http://example.com/curl');
    expect(screen.getByTestId<HTMLSelectElement>('method-select').value).toBe('GET');
  });

  it('the Code tab masks credentials until "Show secrets", and switches languages', async () => {
    const { user } = renderEditor();
    await user.click(screen.getByTestId('url-input'));
    await user.paste(CURL);
    await user.click(screen.getByTestId('code-tab'));
    const snippet = () => screen.getByTestId('code-snippet').textContent ?? '';
    expect(snippet()).toContain("curl 'http://localhost:4010/echo?a=1'");
    expect(snippet()).toContain("--header 'Authorization: Basic ••••••'");
    expect(snippet()).toContain(`--data-raw '{"name":"Ada"}'`);
    expect(snippet()).not.toContain(btoa('ada:secret-pw'));
    expect(screen.getByTestId('code-masked')).toBeTruthy();

    await user.click(screen.getByTestId('code-reveal'));
    expect(snippet()).toContain(`Basic ${btoa('ada:secret-pw')}`);
    expect(screen.queryByTestId('code-masked')).toBeNull();

    await user.selectOptions(screen.getByTestId('code-language'), 'python');
    expect(snippet()).toContain('import requests');
    expect(snippet()).toContain('"x-trace": "abc"');
    await user.selectOptions(screen.getByTestId('code-language'), 'go');
    expect(snippet()).toContain('http.NewRequest("POST", "http://localhost:4010/echo?a=1"');
    await user.selectOptions(screen.getByTestId('code-language'), 'fetch');
    expect(snippet()).toContain('await fetch("http://localhost:4010/echo?a=1"');
    expect(within(screen.getByTestId('code-panel')).getByTestId('code-copy')).toBeTruthy();
  });
});
