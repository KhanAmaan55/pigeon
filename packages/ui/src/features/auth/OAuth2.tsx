/**
 * OAuth 2.0 in the Auth tab (PIGN-047): the grant's settings (Postman params) and the token
 * panel: Get new token, Refresh, Clear. Tokens are kept in the project's secret store, never in
 * files; client credentials and password tokens are also fetched automatically on send.
 */

import type { Auth, OAuth2Auth, OAuthToken } from '@pigeon/core';
import {
  authorizationUrl,
  isAuthorizationCodeGrant,
  isExpired,
  pkcePair,
  randomState,
  requestToken,
  resolveAuth,
  resolveString,
  tokenCacheKey,
  usesPkce,
} from '@pigeon/core';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import { Button, Callout, Select } from '../../components/ui';
import { useVariableScopes } from '../../components/VariableInput/VariablesContext';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';

export const GRANTS = [
  { value: 'authorization_code_with_pkce', label: 'Authorization Code (With PKCE)' },
  { value: 'authorization_code', label: 'Authorization Code' },
  { value: 'client_credentials', label: 'Client Credentials' },
  { value: 'password_credentials', label: 'Password Credentials' },
] as const;

export function emptyOAuth2(): OAuth2Auth {
  return {
    type: 'oauth2',
    grantType: 'authorization_code_with_pkce',
    authUrl: '',
    accessTokenUrl: '',
    clientId: '',
    clientSecret: '',
    scope: '',
    state: '',
    redirectUri: '',
    username: '',
    password: '',
    challengeAlgorithm: 'S256',
    codeVerifier: '',
    clientAuthentication: 'header',
    addTokenTo: 'header',
    headerPrefix: 'Bearer',
    accessToken: '',
    tokenName: '',
  };
}

type Text = (
  label: string,
  testId: string,
  value: string,
  set: (value: string) => void,
  placeholder?: string,
) => ReactNode;

export function OAuth2Fields({
  auth,
  onChange,
  text,
  secretField,
  readOnly,
}: {
  auth: OAuth2Auth;
  onChange: (auth: Auth) => void;
  text: Text;
  secretField: (label: string, value: string, name: string, set: (v: string) => void) => ReactNode;
  readOnly: boolean;
}) {
  const code = isAuthorizationCodeGrant(auth);
  const select = (
    label: string,
    testId: string,
    value: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    set: (value: string) => void,
  ) => (
    <label className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
      <span className="text-fg-muted">{label}</span>
      <Select
        data-testid={testId}
        disabled={readOnly}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="w-56 max-w-full"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
  return (
    <>
      {select('Grant type', 'oauth-grant', auth.grantType, GRANTS, (grantType) =>
        onChange({ ...auth, grantType }),
      )}
      {code &&
        text(
          'Auth URL',
          'oauth-auth-url',
          auth.authUrl,
          (authUrl) => onChange({ ...auth, authUrl }),
          'https://example.com/oauth/authorize',
        )}
      {text(
        'Access token URL',
        'oauth-token-url',
        auth.accessTokenUrl,
        (accessTokenUrl) => onChange({ ...auth, accessTokenUrl }),
        'https://example.com/oauth/token',
      )}
      {text('Client ID', 'oauth-client-id', auth.clientId, (clientId) =>
        onChange({ ...auth, clientId }),
      )}
      {text('Client secret', 'oauth-client-secret', auth.clientSecret, (clientSecret) =>
        onChange({ ...auth, clientSecret }),
      )}
      {secretField('client secret', auth.clientSecret, 'clientSecret', (clientSecret) =>
        onChange({ ...auth, clientSecret }),
      )}
      {auth.grantType === 'password_credentials' && (
        <>
          {text('Username', 'oauth-username', auth.username, (username) =>
            onChange({ ...auth, username }),
          )}
          {text('Password', 'oauth-password', auth.password, (password) =>
            onChange({ ...auth, password }),
          )}
          {secretField('password', auth.password, 'password', (password) =>
            onChange({ ...auth, password }),
          )}
        </>
      )}
      {text(
        'Scope',
        'oauth-scope',
        auth.scope,
        (scope) => onChange({ ...auth, scope }),
        'read write',
      )}
      {code &&
        text(
          'Redirect URI',
          'oauth-redirect',
          auth.redirectUri,
          (redirectUri) => onChange({ ...auth, redirectUri }),
          'Empty: Pigeon picks one',
        )}
      {usesPkce(auth) &&
        select(
          'Code challenge',
          'oauth-pkce',
          auth.challengeAlgorithm || 'S256',
          [
            { value: 'S256', label: 'SHA-256' },
            { value: 'plain', label: 'Plain' },
          ],
          (challengeAlgorithm) => onChange({ ...auth, challengeAlgorithm }),
        )}
      {select(
        'Client authentication',
        'oauth-client-auth',
        auth.clientAuthentication || 'header',
        [
          { value: 'header', label: 'Basic auth header' },
          { value: 'body', label: 'In the request body' },
        ],
        (clientAuthentication) => onChange({ ...auth, clientAuthentication }),
      )}
      {select(
        'Add token to',
        'oauth-add-to',
        auth.addTokenTo || 'header',
        [
          { value: 'header', label: 'Request headers' },
          { value: 'queryParams', label: 'Query params' },
        ],
        (addTokenTo) => onChange({ ...auth, addTokenTo }),
      )}
      {(auth.addTokenTo || 'header') === 'header' &&
        text(
          'Header prefix',
          'oauth-prefix',
          auth.headerPrefix,
          (headerPrefix) => onChange({ ...auth, headerPrefix }),
          'Bearer',
        )}
      <TokenPanel auth={auth} />
    </>
  );
}

function describe(token: OAuthToken | undefined, now: number): string {
  if (!token) return 'No token yet.';
  const expiry =
    token.expiresAt === undefined
      ? 'no expiry given'
      : isExpired(token, now)
        ? 'expired'
        : `expires ${new Date(token.expiresAt).toLocaleString()}`;
  return `Token from ${new Date(token.obtainedAt).toLocaleString()} (${expiry})${
    token.refreshToken ? ', can be refreshed' : ''
  }.`;
}

function TokenPanel({ auth }: { auth: OAuth2Auth }) {
  const project = useAppStore((s) => s.project);
  const platform = usePlatform();
  const scopes = useVariableScopes();
  // Re-render when tokens change (the session emits).
  useProjectState((s) => s.currentValues, null);
  const [status, setStatus] = useState<{ kind: 'busy' | 'ok' | 'error'; text: string } | null>(
    null,
  );
  const [now] = useState(() => Date.now());
  if (!project) {
    return (
      <Callout tone="neutral">
        Open a project to keep tokens; this request gets a token for one send.
      </Callout>
    );
  }
  const store = project.session.oauthTokens;
  const resolved = resolveAuth(auth, (text) => resolveString(text, scopes).value) as OAuth2Auth;
  const key = tokenCacheKey(resolved);
  const token = store.get(key);
  const run = async (job: () => Promise<OAuthToken>, done: string) => {
    setStatus({ kind: 'busy', text: 'Working…' });
    try {
      store.set(key, await job());
      setStatus({ kind: 'ok', text: done });
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };
  const getNew = () =>
    run(async () => {
      if (!isAuthorizationCodeGrant(resolved)) {
        return requestToken(platform.transport, resolved, {
          kind: resolved.grantType === 'password_credentials' ? 'password' : 'client_credentials',
        });
      }
      if (!platform.oauth) throw new Error('This platform cannot open a sign-in window.');
      const redirect = await platform.oauth.begin(resolved.redirectUri || undefined);
      const state = resolved.state || randomState();
      const pkce = usesPkce(resolved)
        ? await pkcePair(resolved.challengeAlgorithm || 'S256')
        : undefined;
      const url = authorizationUrl(resolved, {
        redirectUri: redirect.redirectUri,
        state,
        ...(pkce ? { challenge: { value: pkce.challenge, method: pkce.method } } : {}),
      });
      const params = await platform.oauth.complete(redirect.session, url);
      if (params['error']) {
        throw new Error(
          `The provider refused: ${params['error']}${params['error_description'] ? ` (${params['error_description']})` : ''}`,
        );
      }
      if (params['state'] !== state)
        throw new Error('The sign-in answer had the wrong state; try again.');
      if (!params['code']) throw new Error('The provider sent no authorization code.');
      return requestToken(platform.transport, resolved, {
        kind: 'authorization_code',
        code: params['code'],
        redirectUri: redirect.redirectUri,
        ...(pkce ? { codeVerifier: pkce.verifier } : {}),
      });
    }, 'Token acquired.');
  const refresh = () =>
    run(
      () =>
        requestToken(platform.transport, resolved, {
          kind: 'refresh',
          refreshToken: token!.refreshToken!,
        }),
      'Token refreshed.',
    );
  return (
    <section
      aria-label="OAuth 2.0 token"
      data-testid="oauth-token-panel"
      className="mt-1 flex flex-col gap-3 rounded-lg border border-border bg-sunken p-3 text-xs"
    >
      <p data-testid="oauth-token-status" className="text-fg-muted">
        {describe(token, now)} Tokens stay on this machine (secret store), never in project files.
      </p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          data-testid="oauth-get-token"
          disabled={status?.kind === 'busy'}
          onClick={() => void getNew()}
        >
          Get new token
        </Button>
        <Button
          size="sm"
          data-testid="oauth-refresh-token"
          disabled={!token?.refreshToken || status?.kind === 'busy'}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
        <Button
          size="sm"
          data-testid="oauth-clear-token"
          disabled={!token}
          onClick={() => {
            store.set(key, undefined);
            setStatus({ kind: 'ok', text: 'Token cleared.' });
          }}
        >
          Clear
        </Button>
      </div>
      {status && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          data-testid="oauth-token-message"
          className={status.kind === 'error' ? 'text-fail' : 'text-fg-muted'}
        >
          {status.text}
        </p>
      )}
      {isAuthorizationCodeGrant(resolved) && (
        <p className="text-fg-muted">
          Register the redirect URI with the provider: on the web,{' '}
          <code>
            {typeof window === 'undefined'
              ? ''
              : new URL('oauth-callback.html', document.baseURI).href}
          </code>
          ; on desktop, the loopback URI you enter above (e.g.{' '}
          <code>http://127.0.0.1:8765/callback</code>), or any <code>http://127.0.0.1</code> port if
          the provider allows it.
        </p>
      )}
    </section>
  );
}
