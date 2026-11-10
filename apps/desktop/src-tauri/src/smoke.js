// Smoke probe injected by src/smoke.rs as an initialization script (runs before the page's
// own scripts, on every load). Reports to the `smoke_report` command once the shell has
// rendered, the bundled monospace font has loaded, a request has gone through the native
// transport (http_send), the desktop platform is wired in and no errors were logged.
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

    // Send through the UI → NativeTransport → http_send → reqwest. The webview's fetch would
    // fail here (CORS, and the CSP only allows IPC).
    const input = document.querySelector('[data-testid="url-input"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
      input,
      PROBE_URL,
    );
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.querySelector('[data-testid="send-button"]').click();
    for (let attempt = 0; !text('response-status') && !text('response-error'); attempt++) {
      if (attempt >= 150) throw new Error('no response from the native transport within 15s');
      await delay(100);
    }
    if (text('response-error')) throw new Error(`native request failed: ${text('response-error')}`);
    if (text('response-status') !== '200 OK') throw new Error(`status: ${text('response-status')}`);
    if (text('response-transport') !== 'Native') throw new Error('transport badge is not Native');
    if (!text('response-body')?.includes('native-ok')) throw new Error('response body missing');

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
