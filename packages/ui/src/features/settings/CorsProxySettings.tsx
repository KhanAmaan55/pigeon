/**
 * Settings → CORS proxy (web only, PIGN-052): route this project's requests through a proxy you
 * run yourself (`pnpm --filter @pigeon/cors-proxy start`). URL and token are kept in this
 * browser's local state for the project, never in project files. `useCorsProxyActivation` turns
 * the active project's setting on when the project opens and off when no project is open.
 */

import type { CorsProxyConfig } from '@pigeon/platform';
import { useEffect, useId, useState } from 'react';

import { useCapabilities, usePlatform } from '../../app/PlatformProvider';
import { useAppStore } from '../../stores/AppStoreProvider';

export const CORS_PROXY_KEY = 'corsProxy';
export const DEFAULT_PROXY_URL = 'http://127.0.0.1:8787';
export const PROXY_START_COMMAND = 'pnpm --filter @pigeon/cors-proxy start';

export interface StoredCorsProxy extends CorsProxyConfig {
  enabled: boolean;
}

function isStored(value: unknown): value is StoredCorsProxy {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['url'] === 'string' &&
    typeof v['token'] === 'string' &&
    typeof v['enabled'] === 'boolean'
  );
}

/** Applies the active project's proxy setting to the platform (web). */
export function useCorsProxyActivation(): void {
  const platform = usePlatform();
  const localKey = useAppStore((s) => s.project?.session.localKey ?? null);
  useEffect(() => {
    const control = platform.corsProxy;
    if (!control) return;
    if (!localKey) {
      control.use(null);
      return;
    }
    let current = true;
    void platform.appState
      .get<unknown>(`project:${localKey}`, CORS_PROXY_KEY)
      .catch(() => undefined)
      .then((stored) => {
        if (!current) return;
        control.use(isStored(stored) && stored.enabled ? stored : null);
      });
    return () => {
      current = false;
    };
  }, [platform, localKey]);
}

export function CorsProxySettings() {
  const platform = usePlatform();
  const localKey = useAppStore((s) => s.project?.session.localKey ?? null);
  if (!platform.corsProxy) return null;
  return (
    <section
      aria-labelledby="cors-proxy-title"
      data-testid="cors-proxy-settings"
      className="border-b border-border p-3 text-sm"
    >
      <h2 id="cors-proxy-title" className="mb-2 font-semibold">
        CORS proxy
      </h2>
      {localKey ? (
        <ProxyForm key={localKey} localKey={localKey} />
      ) : (
        <p className="text-xs text-fg-muted">
          Open a project to route its requests through a proxy.
        </p>
      )}
    </section>
  );
}

function ProxyForm({ localKey }: { localKey: string }) {
  const platform = usePlatform();
  const control = platform.corsProxy!;
  const { transport } = useCapabilities();
  const [form, setForm] = useState<StoredCorsProxy | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const id = useId();

  useEffect(() => {
    let current = true;
    void platform.appState
      .get<unknown>(`project:${localKey}`, CORS_PROXY_KEY)
      .catch(() => undefined)
      .then((stored) => {
        if (current) {
          setForm(
            isStored(stored) ? stored : { url: DEFAULT_PROXY_URL, token: '', enabled: false },
          );
        }
      });
    return () => {
      current = false;
    };
  }, [platform, localKey]);

  if (!form) return null;
  const save = (next: StoredCorsProxy) => {
    setForm(next);
    setStatus(null);
    void platform.appState.set(`project:${localKey}`, CORS_PROXY_KEY, next).catch(() => undefined);
    control.use(next.enabled ? next : null);
  };
  const test = async () => {
    setStatus({ ok: true, text: 'Checking…' });
    const problem = await control.check(form);
    setStatus(problem ? { ok: false, text: problem } : { ok: true, text: 'The proxy answers.' });
  };
  const input = 'h-7 w-full rounded border border-border bg-bg px-2 font-mono text-xs text-fg';
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-fg-muted">
        Browsers block many API calls (CORS, forbidden headers). Run the proxy on your machine with{' '}
        <code data-testid="cors-proxy-command">{PROXY_START_COMMAND}</code>, then enter the URL and
        token it prints. It only accepts this app’s origin and your token; keep it bound to
        127.0.0.1 — anyone with the token can send requests from your network.
      </p>
      <label htmlFor={`${id}-url`} className="text-xs text-fg-muted">
        Proxy URL
      </label>
      <input
        id={`${id}-url`}
        data-testid="cors-proxy-url"
        value={form.url}
        spellCheck={false}
        onChange={(event) => save({ ...form, url: event.target.value })}
        className={input}
      />
      <label htmlFor={`${id}-token`} className="text-xs text-fg-muted">
        Token
      </label>
      <input
        id={`${id}-token`}
        type="password"
        data-testid="cors-proxy-token"
        value={form.token}
        autoComplete="off"
        onChange={(event) => save({ ...form, token: event.target.value })}
        className={input}
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor={`${id}-enabled`} className="flex items-center gap-1.5">
          <input
            id={`${id}-enabled`}
            type="checkbox"
            data-testid="cors-proxy-enabled"
            checked={form.enabled}
            onChange={(event) => save({ ...form, enabled: event.target.checked })}
          />
          Send this project’s requests through the proxy
        </label>
        <button
          type="button"
          data-testid="cors-proxy-test"
          onClick={() => void test()}
          className="rounded border border-border px-2 py-0.5 hover:bg-hover"
        >
          Test
        </button>
      </div>
      <p data-testid="cors-proxy-mode" className="text-xs text-fg-muted">
        {transport === 'proxy' ? 'Proxy mode is on.' : 'Requests go directly from the browser.'}
      </p>
      {status && (
        <p
          role={status.ok ? 'status' : 'alert'}
          data-testid="cors-proxy-status"
          className={`text-xs ${status.ok ? 'text-fg-muted' : 'text-fail'}`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
