import type { Capabilities, MockResponseInit, PreparedRequest } from '@pigeon/platform';
import { createMemoryPlatform, MockTransport, TransportError } from '@pigeon/platform';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformProvider } from '../src/app/PlatformProvider';
import { PreferencesProvider } from '../src/app/preferences';
import { Sidebar } from '../src/app/Sidebar';
import { TooltipProvider } from '../src/components/Tooltip';
import { RequestEditor } from '../src/features/request-editor/RequestEditor';
import { ScratchRequestProvider } from '../src/features/request-editor/ScratchRequestProvider';
import { UNSUPPORTED_SETTING_REASONS } from '../src/features/request-editor/SettingsTab';
import { ResponseViewer } from '../src/features/response-viewer/ResponseViewer';

afterEach(cleanup);

const WEB: Partial<Capabilities> = {
  transport: 'fetch',
  canSetAnyHeader: false,
  canReadAllResponseHeaders: false,
  canControlRedirects: false,
  canDisableTlsVerification: false,
  canSendBodyWithGet: false,
  detailedTimings: false,
};

/** A transport whose `/slow` requests hang until aborted; everything else answers `reply`. */
function slowTransport(reply: MockResponseInit = { body: 'ok' }) {
  const sent: PreparedRequest[] = [];
  const transport = new MockTransport()
    .on({ url: /\/slow/ }, (req) => {
      sent.push(req);
      return new Promise<MockResponseInit>(() => undefined);
    })
    .on(
      () => true,
      (req) => {
        sent.push(req);
        return reply;
      },
    );
  return { transport, sent };
}

function renderApp(transport: MockTransport, capabilities: Partial<Capabilities> = {}) {
  const platform = createMemoryPlatform({ transport, capabilities, os: 'linux' });
  render(
    <PlatformProvider platform={platform}>
      <PreferencesProvider>
        <TooltipProvider delayDuration={0}>
          <Sidebar view="settings" />
          <ScratchRequestProvider>
            <RequestEditor />
            <ResponseViewer />
          </ScratchRequestProvider>
        </TooltipProvider>
      </PreferencesProvider>
    </PlatformProvider>,
  );
  return userEvent.setup();
}

describe('cancel', () => {
  it('turns Send into Cancel; cancelling shows a quiet "Cancelled", not an error card', async () => {
    const { transport } = slowTransport();
    const user = renderApp(transport);

    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/slow{enter}');
    await user.click(await screen.findByTestId('cancel-button'));

    expect((await screen.findByTestId('response-cancelled')).textContent).toBe('Cancelled');
    expect(screen.queryByTestId('response-error')).toBeNull();
    expect(screen.queryByTestId('response-loading')).toBeNull();
    expect(screen.getByTestId('send-button')).toBeTruthy();
  });

  it('cancels with Esc', async () => {
    const { transport } = slowTransport();
    const user = renderApp(transport);

    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/slow{enter}');
    await screen.findByTestId('cancel-button');
    await user.keyboard('{Escape}');

    expect(await screen.findByTestId('response-cancelled')).toBeTruthy();
  });

  it('ignores Esc when nothing is in flight, or when something else handled it', async () => {
    const { transport } = slowTransport();
    const user = renderApp(transport);
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('response-cancelled')).toBeNull();

    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/slow{enter}');
    await screen.findByTestId('cancel-button');
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    handled.preventDefault();
    act(() => void window.dispatchEvent(handled));
    expect(screen.getByTestId('cancel-button')).toBeTruthy();
  });

  it('sending again cancels the previous execution and shows only the new result', async () => {
    const { transport, sent } = slowTransport({ status: 201 });
    const user = renderApp(transport);

    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/slow{enter}');
    await screen.findByTestId('cancel-button');
    await user.clear(screen.getByTestId('url-input'));
    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/fast{enter}');

    expect((await screen.findByTestId('response-status')).textContent).toContain('201');
    expect(screen.queryByTestId('response-cancelled')).toBeNull();
    expect(sent.map((req) => new URL(req.url).pathname)).toEqual(['/slow', '/fast']);
  });
});

describe('request settings', () => {
  const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByTestId('settings-tab'));
    return screen.getByTestId('request-settings');
  };

  it('sends timeout, redirect and TLS settings, defaulting to the preferences', async () => {
    const { transport, sent } = slowTransport();
    const user = renderApp(transport);
    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/a');

    await user.click(screen.getByTestId('send-button'));
    await screen.findByTestId('response-status');
    expect(sent.at(-1)?.settings).toEqual({
      timeoutMs: 30_000,
      followRedirects: true,
      maxRedirects: 10,
      strictSSL: true,
    });

    await openSettings(user);
    expect(screen.getByTestId('setting-timeout').getAttribute('placeholder')).toBe('30000');
    await user.type(screen.getByTestId('setting-timeout'), '1000');
    await user.click(screen.getByTestId('setting-follow-redirects'));
    expect((screen.getByTestId('setting-max-redirects') as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByTestId('setting-follow-redirects'));
    await user.type(screen.getByTestId('setting-max-redirects'), '2');
    await user.click(screen.getByTestId('setting-strict-ssl'));

    await user.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.at(-1)?.settings).toEqual({
      timeoutMs: 1000,
      followRedirects: true,
      maxRedirects: 2,
      strictSSL: false,
    });
  });

  it('uses the global default timeout from Settings → Requests', async () => {
    const { transport, sent } = slowTransport();
    const user = renderApp(transport);

    const input = within(screen.getByTestId('request-defaults')).getByTestId('preference-timeout');
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByTestId('request-defaults').textContent).toContain('no timeout');

    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/a{enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.settings.timeoutMs).toBe(0);

    await openSettings(user);
    expect(screen.getByTestId('setting-timeout').getAttribute('placeholder')).toBe('0');
  });

  it('enables every control on desktop', async () => {
    const user = renderApp(new MockTransport());
    await openSettings(user);
    for (const id of ['setting-follow-redirects', 'setting-max-redirects', 'setting-strict-ssl']) {
      expect((screen.getByTestId(id) as HTMLInputElement).disabled).toBe(false);
    }
    expect(document.querySelector('[data-unsupported]')).toBeNull();
  });

  it('disables redirect and TLS controls on web, explaining why in a tooltip', async () => {
    const user = renderApp(new MockTransport(), WEB);
    await openSettings(user);

    for (const id of ['setting-follow-redirects', 'setting-max-redirects', 'setting-strict-ssl']) {
      expect((screen.getByTestId(id) as HTMLInputElement).disabled).toBe(true);
    }
    expect((screen.getByTestId('setting-follow-redirects') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('setting-strict-ssl') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('setting-timeout') as HTMLInputElement).disabled).toBe(false);

    await user.hover(screen.getByTestId('setting-strict-ssl-row'));
    const tooltip = await screen.findAllByTestId('setting-unsupported-tooltip');
    expect(tooltip[0]?.textContent).toBe(UNSUPPORTED_SETTING_REASONS.tls);
  });
});

describe('error card', () => {
  function failing(error: TransportError) {
    return new MockTransport().on(
      () => true,
      () => {
        throw error;
      },
    );
  }

  it('shows the kind title, message and hint, with the raw detail folded away', async () => {
    const user = renderApp(
      failing(new TransportError('tls', 'Bad certificate.', { detail: 'UnknownIssuer' })),
    );
    await user.type(screen.getByTestId('url-input'), 'https://localhost:4443/{enter}');

    const card = await screen.findByTestId('response-error');
    expect(card.getAttribute('data-kind')).toBe('tls');
    expect(within(card).getByTestId('response-error-title').textContent).toBe(
      'TLS / certificate error',
    );
    expect(within(card).getByTestId('response-error-message').textContent).toBe('Bad certificate.');
    expect(within(card).getByTestId('response-error-hint').textContent).toContain(
      'Verify TLS certificates',
    );
    const detail = within(card).getByTestId('response-error-detail') as HTMLDetailsElement;
    expect(detail.open).toBe(false);
    expect(detail.textContent).toContain('UnknownIssuer');
  });

  it('names the timeout that applied', async () => {
    const user = renderApp(failing(new TransportError('timeout', 'Timed out.')));
    await user.click(screen.getByTestId('settings-tab'));
    await user.type(screen.getByTestId('setting-timeout'), '1000');
    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/delay/3000{enter}');

    const card = await screen.findByTestId('response-error');
    expect(card.getAttribute('data-kind')).toBe('timeout');
    expect(card.textContent).toContain('timed out after 1 s');
  });

  it('explains CORS on web', async () => {
    const user = renderApp(failing(new TransportError('cors-suspected', 'Blocked.')), WEB);
    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/cors/none{enter}');
    const card = await screen.findByTestId('response-error');
    expect(card.getAttribute('data-kind')).toBe('cors-suspected');
    expect(within(card).getByTestId('response-error-hint').textContent).toMatch(/CORS/);
  });
});

describe('timeline', () => {
  const redirected: MockResponseInit = {
    status: 200,
    url: 'http://localhost:4010/echo',
    redirects: [
      { status: 302, url: 'http://localhost:4010/redirect/2', location: '/redirect/1' },
      { status: 302, url: 'http://localhost:4010/redirect/1', location: '/echo' },
    ],
    ttfbMs: 12,
    body: '{}',
  };

  it('shows the request line, headers, redirect hops and TTFB/total on desktop', async () => {
    const transport = new MockTransport().on(() => true, redirected);
    const user = renderApp(transport);
    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/redirect/2{enter}');
    await screen.findByTestId('response-status');
    await user.click(screen.getByTestId('response-timeline-tab'));

    const timeline = screen.getByTestId('response-timeline');
    expect(within(timeline).getByTestId('timeline-request-line').textContent).toContain(
      'GET http://localhost:4010/redirect/2',
    );
    expect(within(timeline).getByTestId('timeline-request-headers').textContent).toContain(
      'Accept*/*',
    );
    const hops = within(timeline).getAllByTestId('timeline-redirect');
    expect(hops.map((hop) => hop.textContent)).toEqual([
      '302http://localhost:4010/redirect/2/redirect/1',
      '302http://localhost:4010/redirect/1/echo',
    ]);
    expect(within(timeline).getByTestId('timeline-response-line').textContent).toContain(
      'http://localhost:4010/echo',
    );
    expect(within(timeline).getByTestId('timeline-ttfb').textContent).toBe('12 ms');
    expect(within(timeline).getByTestId('timeline-total').textContent).toMatch(/ms|s$/);
  });

  it('says what the browser hides on web', async () => {
    const transport = new MockTransport().on(() => true, { body: '{}' });
    const user = renderApp(transport, WEB);
    await user.type(screen.getByTestId('url-input'), 'http://localhost:4010/json{enter}');
    await screen.findByTestId('response-status');
    await user.click(screen.getByTestId('response-timeline-tab'));

    expect(screen.getByTestId('timeline-no-redirects').textContent).toMatch(/Not visible/);
    expect(screen.queryByTestId('timeline-ttfb')).toBeNull();
    expect(screen.getByTestId('response-timeline').textContent).toContain('total time');
  });
});
