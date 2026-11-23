/**
 * Settings → Secrets (PIGN-053): where this project's secret current values and OAuth tokens are
 * kept on this machine, the keychain fallback notice, and "Forget all secrets for this project".
 */

import type { OperatingSystem, SecretBackend } from '@pigeon/platform';
import { useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';

const KEYCHAIN_NAMES: Record<OperatingSystem, string> = {
  macos: 'the macOS Keychain',
  windows: 'Windows Credential Manager',
  linux: 'the Secret Service (GNOME Keyring / KWallet)',
  unknown: 'the OS keychain',
};

/** Where secret values live, as a phrase ("the macOS Keychain"). */
export function secretBackendLabel(backend: SecretBackend, os: OperatingSystem): string {
  switch (backend) {
    case 'os-keychain':
      return KEYCHAIN_NAMES[os];
    case 'local-state':
      return 'a local file in the app data folder, readable only by your user account';
    case 'indexeddb':
      return 'this browser’s storage for this site (not encrypted at rest)';
    case 'memory':
      return 'memory only (forgotten when the app closes)';
  }
}

export function SecretsSettings() {
  const platform = usePlatform();
  const project = useAppStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);
  // Re-render on session changes (a fallback during the run changes the backend).
  useProjectState((s) => s.model, null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!project) return null;
  const { session } = project;
  const backend = session.secretBackend;
  const notice = session.secretStoreNotice;

  const forget = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      await session.forgetSecrets();
      notify('Forgot every secret value and token of this project on this machine.');
    } catch (error) {
      notify(
        `Could not forget every secret: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="secrets-settings-title"
      data-testid="secrets-settings"
      className="border-b border-border p-3 text-sm"
    >
      <h2 id="secrets-settings-title" className="mb-2 font-semibold">
        Secrets
      </h2>
      {backend === undefined ? (
        <p className="text-xs text-fg-muted">
          Secret values are not kept for this project (it is read-only).
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-xs">
          <p data-testid="secrets-backend" className="text-fg-muted">
            Secret variable values and OAuth tokens of this project are stored on this machine in{' '}
            {secretBackendLabel(backend, platform.os)}. They are never written to project files.
          </p>
          {notice && (
            <p data-testid="secrets-notice" role="status" className="text-warn">
              {notice}
            </p>
          )}
          {confirming ? (
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-fg-muted">
                Remove every secret value and token of this project? This cannot be undone.
              </span>
              <button
                type="button"
                data-testid="secrets-forget-confirm"
                onClick={() => void forget()}
                className="rounded border border-fail px-1.5 py-0.5 text-fail hover:bg-hover"
              >
                Forget all
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded border border-border px-1.5 py-0.5 hover:bg-hover"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              data-testid="secrets-forget"
              disabled={busy}
              onClick={() => setConfirming(true)}
              className="self-start rounded border border-border px-1.5 py-0.5 hover:bg-hover disabled:opacity-50"
            >
              Forget all secrets for this project
            </button>
          )}
        </div>
      )}
    </section>
  );
}
