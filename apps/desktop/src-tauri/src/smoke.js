// Smoke probe injected by src/smoke.rs as an initialization script (runs before the page's
// own scripts, on every load). Reports to the `smoke_report` command once the shell has
// rendered, the bundled monospace font has loaded, a request built in the editor (path variable,
// duplicate, disabled and browser-forbidden headers) has gone through the native transport
// (http_send) intact, the desktop platform is wired in and no errors were logged.
(() => {
  if (window.top !== window) return;

  // A local server without CORS headers, started by smoke.rs (which fills in the URL).
  const PROBE_URL = '__SMOKE_HTTP_URL__';

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

  async function probe() {
    for (let attempt = 0; !document.querySelector('[data-testid="app-shell"]'); attempt++) {
      if (attempt >= 300) throw new Error('app shell did not render within 30s');
      await delay(100);
    }
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
        const found = check();
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
    // The probe target echoes the request head it received.
    const echoed = text('response-body') ?? '';
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
    if (errors.length > 0) throw new Error(errors.join('\n'));
  }

  const report = (error) => window.__TAURI_INTERNALS__.invoke('smoke_report', { error });
  window.addEventListener('DOMContentLoaded', () =>
    probe().then(
      () => report(null),
      (error) => report(String(error)),
    ),
  );
})();
