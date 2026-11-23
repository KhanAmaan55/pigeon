// Smoke probe injected by src/smoke.rs as an initialization script (runs before the page's
// own scripts, on every load). Reports to the `smoke_report` command once the shell has
// rendered, the bundled monospace font has loaded, a request built in the editor (path variable,
// duplicate, disabled and browser-forbidden headers) has gone through the native transport
// (http_send) intact, the desktop platform is wired in, project folders stay closed until
// picked, a project folder goes through open → edit → Save for Commit → external change →
// reload, and no errors were logged.
(() => {
  if (window.top !== window) return;

  // A local server without CORS headers, started by smoke.rs (which fills in the URL).
  const PROBE_URL = '__SMOKE_HTTP_URL__';
  // The project smoke.rs seeded as a granted recent project (it fills in a JSON string literal).
  // eslint-disable-next-line no-undef
  const PROJECT_ROOT = __SMOKE_PROJECT_ROOT__;

  const errors = [];
  window.addEventListener('error', (event) => errors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  document.addEventListener('securitypolicyviolation', (event) =>
    errors.push(`CSP blocked ${event.blockedURI} (${event.violatedDirective})`),
  );
  const consoleError = console.error;
  console.error = (...args) => {
    errors.push(args.map(String).join(' '));
    consoleError.apply(console, args);
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let shellAtMs = null;

  async function probe() {
    for (let attempt = 0; !document.querySelector('[data-testid="app-shell"]'); attempt++) {
      if (attempt >= 3000) throw new Error('app shell did not render within 30s');
      await delay(10);
    }
    // For `--smoke --timing` (cold start, PIGN-042): after the shell's first paint.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    shellAtMs = Date.now();
    const faces = await document.fonts.load('12px "JetBrains Mono"');
    if (faces.length === 0) throw new Error('bundled monospace font did not load');
    const text = (testId) => document.querySelector(`[data-testid="${testId}"]`)?.textContent;

    const find = (testId) => document.querySelector(`[data-testid="${testId}"]`);
    // React tracks input values: set them through the native setter, then fire `input`.
    const setValue = (element, value) => {
      const prototype = Object.getPrototypeOf(element);
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    const waitFor = async (what, check) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const found = await check();
        if (found) return found;
        await delay(100);
      }
      throw new Error(`${what} did not appear`);
    };

    // Build a request in the editor and send it through the UI → prepareRequest →
    // NativeTransport → http_send → reqwest. The webview's fetch would fail here (CORS, and the
    // CSP only allows IPC).
    setValue(find('url-input'), `${PROBE_URL}/:id`);
    setValue(
      await waitFor('path variable row', () =>
        find('path-variables-table')?.querySelector('input[aria-label="Value"]'),
      ),
      '42',
    );
    // Radix tabs switch on mousedown.
    find('headers-tab').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    const bulk = await waitFor('headers bulk edit button', () =>
      [...(find('headers-table')?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent === 'Bulk edit',
      ),
    );
    bulk.click();
    setValue(
      await waitFor('headers bulk editor', () => find('kv-bulk-input')),
      'X-Dup: one\nX-Dup: two\n//X-Off: no\nCookie: smoke=1',
    );
    find('send-button').click();
    for (let attempt = 0; !text('response-status') && !text('response-error'); attempt++) {
      if (attempt >= 150) throw new Error('no response from the native transport within 15s');
      await delay(100);
    }
    if (text('response-error')) throw new Error(`native request failed: ${text('response-error')}`);
    if (text('response-status') !== '200 OK') throw new Error(`status: ${text('response-status')}`);
    if (text('response-transport') !== 'Native') throw new Error('transport badge is not Native');
    // The probe target echoes the request head it received. The body view is a lazy chunk that
    // renders after the status line, so wait for its text.
    // CodeMirror renders one element per line, so `textContent` would run them together.
    const echoed = await waitFor('response body', () =>
      [...(find('response-body')?.querySelectorAll('.cm-line') ?? [])]
        .map((line) => line.textContent)
        .join('\n'),
    );
    const lines = echoed.split('\n').map((line) => line.toLowerCase());
    if (lines[0] !== 'native-ok') throw new Error(`unexpected response body: ${echoed}`);
    if (lines[1] !== 'get /smoke/42 http/1.1') throw new Error(`path variable not sent: ${echoed}`);
    const dup = lines.filter((line) => line.startsWith('x-dup:'));
    if (dup.join('|') !== 'x-dup: one|x-dup: two') throw new Error(`duplicates: ${echoed}`);
    if (lines.some((line) => line.startsWith('x-off:'))) throw new Error('disabled header sent');
    if (!lines.includes('cookie: smoke=1')) throw new Error(`Cookie header not sent: ${echoed}`);

    // The desktop platform is wired in: capabilities and an OS detected by plugin-os.
    document.querySelector('[data-testid="activity-settings"]').click();
    await delay(100);
    if (text('capability-bypassesCors') !== 'true') throw new Error('desktop capabilities missing');
    const os = text('diagnostics-os');
    if (!['macOS', 'Windows', 'Linux'].includes(os)) throw new Error(`OS not detected: ${os}`);

    // Project folders (PIGN-014): the welcome panel rendered after reading recent projects from
    // app state (an IPC failure would be logged), and folders the user never picked stay closed.
    document.querySelector('[data-testid="activity-collections"]').click();
    await waitFor('welcome panel', () => find('welcome'));
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const denied = await invoke('project_fs_stat', { root: '/', path: 'etc' }).then(
      () => null,
      (error) => error,
    );
    if (!denied || !String(denied.message).includes('no access')) {
      throw new Error(`ungranted folder was readable: ${JSON.stringify(denied)}`);
    }

    // A project on disk (PIGN-040): open the recent project, edit a request, Save for Commit,
    // then change the file outside Pigeon and see the app reload it.
    const recent = await waitFor('recent project', () => find('recent-project'));
    recent.querySelector('button').click();
    const item = (name) =>
      [...document.querySelectorAll('[data-testid="explorer-item"]')].find(
        (row) => row.querySelector('[data-testid="explorer-item-name"]')?.textContent === name,
      );
    (await waitFor('request in the explorer', () => item('Ping'))).click();
    const url = await waitFor('project request in the editor', () => {
      const input = find('url-input');
      return input?.value === `${PROBE_URL}/ping` ? input : null;
    });
    setValue(url, `${PROBE_URL}/edited`);
    await delay(100);
    // Its pre-request script runs in the sandbox (PIGN-043) and adds a header.
    find('send-button').click();
    const scripted = await waitFor('scripted response', () => {
      if (text('response-error'))
        throw new Error(`scripted send failed: ${text('response-error')}`);
      const lines = [...(find('response-body')?.querySelectorAll('.cm-line') ?? [])].map((line) =>
        line.textContent.toLowerCase(),
      );
      return lines.includes('get /smoke/edited http/1.1') ? lines : null;
    });
    if (!scripted.includes('x-script: desktop')) {
      throw new Error(`pre-request script header missing: ${scripted.join(' | ')}`);
    }
    // The project's cookie jar (PIGN-045): a cookie set by one response is sent with the next.
    const echoedFor = (path) =>
      waitFor(`response for ${path}`, () => {
        if (text('response-error')) throw new Error(`send failed: ${text('response-error')}`);
        const lines = [...(find('response-body')?.querySelectorAll('.cm-line') ?? [])].map((line) =>
          line.textContent.toLowerCase(),
        );
        return lines.includes(`get /smoke${path} http/1.1`) ? lines : null;
      });
    setValue(url, `${PROBE_URL}/cookie-set`);
    find('send-button').click();
    await echoedFor('/cookie-set');
    setValue(url, `${PROBE_URL}/cookie-check`);
    find('send-button').click();
    const withCookie = await echoedFor('/cookie-check');
    if (!withCookie.includes('cookie: smoke=jar')) {
      throw new Error(`cookie jar not used: ${withCookie.join(' | ')}`);
    }
    // OAuth 2.0 (PIGN-047): authorization code + PKCE through the loopback listener (smoke
    // runs follow the auto-approving authorize page instead of opening a browser).
    find('auth-tab').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    const getToken = await waitFor('Get new token', () => find('oauth-get-token')).catch(() => {
      throw new Error(
        `no Get new token button; auth tab shows: ${(find('request-editor')?.textContent ?? '').slice(0, 400)}`,
      );
    });
    getToken.click();
    await waitFor('token', () => {
      const message = text('oauth-token-message') ?? '';
      if (message && message !== 'Working…' && message !== 'Token acquired.') {
        throw new Error(`OAuth flow failed: ${message}`);
      }
      return message === 'Token acquired.';
    });
    setValue(url, `${PROBE_URL}/oauth-check`);
    find('send-button').click();
    const withToken = await echoedFor('/oauth-check');
    if (!withToken.includes('authorization: bearer smoke-token')) {
      throw new Error(`OAuth token not sent: ${withToken.join(' | ')}`);
    }
    // Local history (PIGN-051): the sends above went to app data through the history commands,
    // with the OAuth token masked.
    const stored = await waitFor('history on disk', async () => {
      const list = await invoke('history_list', { projectKey: 'smoke-project' });
      return list.length >= 4 ? list : null;
    });
    if (!stored.some((summary) => summary.url === `${PROBE_URL}/oauth-check`)) {
      throw new Error(`history misses the last send: ${JSON.stringify(stored).slice(0, 300)}`);
    }
    document.querySelector('[data-testid="activity-history"]').click();
    const oauthEntry = await waitFor('history item', () =>
      [...document.querySelectorAll('[data-testid="history-item"]')].find((row) =>
        row.textContent.includes('/oauth-check'),
      ),
    );
    oauthEntry.click();
    const sentHeaders = await waitFor('history entry', () => find('history-entry-request-headers'));
    if (sentHeaders.textContent.includes('smoke-token')) {
      throw new Error('the OAuth token was stored unmasked in history');
    }
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor('history entry closed', () => !find('history-entry'));
    document.querySelector('[data-testid="activity-collections"]').click();
    await delay(100);
    setValue(url, `${PROBE_URL}/edited`);
    await delay(100);
    const mac = navigator.userAgent.includes('Mac');
    window.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'S',
        code: 'KeyS',
        shiftKey: true,
        metaKey: mac,
        ctrlKey: !mac,
        bubbles: true,
      }),
    );
    await waitFor('Save for Commit toast', () => (text('toast') ?? '').includes('Wrote'));
    const path = 'collections/smoke/ping.request.json';
    const onDisk = new TextDecoder().decode(
      await invoke('project_fs_read', { root: PROJECT_ROOT, path }),
    );
    if (!onDisk.includes(`${PROBE_URL}/edited`)) throw new Error(`not written: ${onDisk}`);
    if (onDisk.includes('\r')) throw new Error('written with CR line endings');
    // Another program edits the file: the explorer follows (file watching or refresh on focus).
    const changed = new TextEncoder().encode(onDisk.replace('"Ping"', '"Ping externally"'));
    const meta = new TextEncoder().encode(JSON.stringify({ root: PROJECT_ROOT, path }));
    const frame = new Uint8Array(4 + meta.byteLength + changed.byteLength);
    new DataView(frame.buffer).setUint32(0, meta.byteLength, true);
    frame.set(meta, 4);
    frame.set(changed, 4 + meta.byteLength);
    await invoke('project_fs_write', frame);
    for (let attempt = 0; !item('Ping externally'); attempt++) {
      if (attempt >= 100) throw new Error('the external change was not picked up within 10s');
      if (attempt % 10 === 9) window.dispatchEvent(new window.Event('focus'));
      await delay(100);
    }
    if (errors.length > 0) throw new Error(errors.join('\n'));
  }

  const report = (error) => window.__TAURI_INTERNALS__.invoke('smoke_report', { error, shellAtMs });
  window.addEventListener('DOMContentLoaded', () =>
    probe().then(
      () => report(null),
      (error) => report(String(error)),
    ),
  );
})();
