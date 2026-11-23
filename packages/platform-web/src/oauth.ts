/**
 * OAuth 2.0 in the browser (PIGN-047): the provider's page opens in a popup and redirects to
 * `oauth-callback.html` on the Pigeon origin, which posts the redirect's query parameters back
 * and closes. Register that page's URL as the redirect URI with the provider.
 */

import type { OAuthBrowser } from '@pigeon/platform';

const MESSAGE = 'pigeon-oauth';
const TIMEOUT_MS = 5 * 60_000;

export function callbackUrl(base = document.baseURI): string {
  return new URL('oauth-callback.html', base).href;
}

export function createWebOAuth(): OAuthBrowser {
  return {
    async begin() {
      return { redirectUri: callbackUrl(), session: crypto.randomUUID() };
    },
    complete(_session, url) {
      return new Promise((resolve, reject) => {
        const popup = window.open(url, 'pigeon-oauth', 'popup,width=520,height=680');
        if (!popup) {
          reject(new Error('The browser blocked the sign-in window. Allow pop-ups for Pigeon.'));
          return;
        }
        const done = (finish: () => void) => {
          window.removeEventListener('message', onMessage);
          clearInterval(closed);
          clearTimeout(timeout);
          finish();
        };
        const onMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          const data = event.data as { type?: string; params?: Record<string, string> };
          if (data?.type !== MESSAGE || !data.params) return;
          done(() => resolve(data.params!));
        };
        window.addEventListener('message', onMessage);
        const closed = setInterval(() => {
          if (popup.closed) done(() => reject(new Error('The sign-in window was closed.')));
        }, 500);
        const timeout = setTimeout(
          () => done(() => reject(new Error('Sign-in took too long (5 minutes).'))),
          TIMEOUT_MS,
        );
      });
    },
  };
}
