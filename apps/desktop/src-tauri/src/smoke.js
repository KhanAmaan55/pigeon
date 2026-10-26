// Smoke probe injected by src/smoke.rs as an initialization script (runs before the page's
// own scripts, on every load). Reports to the `smoke_report` command once the shell has
// rendered, the bundled monospace font has loaded and no errors were logged.
(() => {
  if (window.top !== window) return;

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
