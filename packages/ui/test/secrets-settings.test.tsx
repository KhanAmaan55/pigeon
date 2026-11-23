import type { SecretBackend, SecretStore } from '@pigeon/platform';
import { createMemoryPlatform, MemoryFs, MemorySecretStore } from '@pigeon/platform';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformProvider } from '../src/app/PlatformProvider';
import { Diagnostics } from '../src/features/settings/Diagnostics';
import { SecretsSettings } from '../src/features/settings/SecretsSettings';
import { AppStoreProvider } from '../src/stores/AppStoreProvider';
import { createAppStore } from '../src/stores/app-store';

afterEach(cleanup);

/** A keychain store that fell back, like `KeychainSecretStore` without a Secret Service. */
class FallbackStore implements SecretStore {
  readonly backend: SecretBackend = 'local-state';
  readonly notice = 'The OS keychain is not available (no Secret Service).';
  readonly #inner = new MemorySecretStore();
  getAll = (projectId: string) => this.#inner.getAll(projectId);
  get = (projectId: string, key: string) => this.#inner.get(projectId, key);
  set = (projectId: string, key: string, value: string) => this.#inner.set(projectId, key, value);
  delete = (projectId: string, key: string) => this.#inner.delete(projectId, key);
  clear = (projectId: string) => this.#inner.clear(projectId);
}

async function openProject(secrets: SecretStore) {
  const platform = createMemoryPlatform({ os: 'linux' });
  (platform as { secrets: SecretStore }).secrets = secrets;
  const store = createAppStore(platform);
  platform.projects.pickResult = platform.projects.add(new MemoryFs());
  await store.getState().openFolder();
  await store.getState().confirmInit('Secrets');
  const session = store.getState().project!.session;
  render(
    <PlatformProvider platform={platform}>
      <AppStoreProvider store={store}>
        <SecretsSettings />
        <Diagnostics />
      </AppStoreProvider>
    </PlatformProvider>,
  );
  return { store, session };
}

describe('Settings → Secrets (PIGN-053)', () => {
  it('shows the fallback notice in project settings and Diagnostics', async () => {
    await openProject(new FallbackStore());
    expect(screen.getByTestId('secrets-backend').textContent).toContain(
      'a local file in the app data folder',
    );
    expect(screen.getByTestId('secrets-notice').textContent).toMatch(/keychain is not available/);
    expect(screen.getByTestId('diagnostics-secrets').textContent).toMatch(/^local-state: /);
    expect(screen.getByTestId('diagnostics-secrets-notice').textContent).toMatch(
      /no Secret Service/,
    );
  });

  it('forgets every secret of the project after confirmation', async () => {
    const secrets = new MemorySecretStore();
    const { store, session } = await openProject(secrets);
    act(() => {
      session.apply({
        type: 'createEnvironment',
        id: 'env',
        name: 'Local',
        values: [{ key: 'token', value: '', type: 'secret', enabled: true }],
      });
      session.setCurrentValue('env:env', 'token', 'super-secret-token');
    });
    await waitFor(async () =>
      expect(Object.keys(await secrets.getAll(session.localKey))).toHaveLength(1),
    );
    expect(screen.queryByTestId('secrets-notice')).toBeNull();
    expect(screen.getByTestId('diagnostics-secrets').textContent).toMatch(/^memory: /);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('secrets-forget'));
    await user.click(screen.getByTestId('secrets-forget-confirm'));
    await waitFor(() => expect(store.getState().notice?.message).toMatch(/Forgot every secret/));
    expect(session.currentValues('env:env')).toEqual({});
    expect(await secrets.getAll(session.localKey)).toEqual({});
  });
});
