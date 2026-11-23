/**
 * OAuth 2.0 on desktop (PIGN-047): the Rust side listens on a loopback redirect URI and opens
 * the system browser (src-tauri/src/oauth.rs).
 */

import type { OAuthBrowser } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function createDesktopOAuth(invoke: Invoke = tauriInvoke): OAuthBrowser {
  return {
    begin: (preferredRedirectUri) =>
      invoke('oauth_begin', { preferred: preferredRedirectUri ?? null }),
    complete: (session, url) => invoke('oauth_complete', { session, url }),
  };
}
