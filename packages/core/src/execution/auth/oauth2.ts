/**
 * OAuth 2.0 (RFC 6749 / 7636, PIGN-047): token requests through the platform transport, PKCE,
 * authorization URLs and the token cache rules. Tokens live in the project's secret store
 * (never in files or exports); the auth only says how to get them.
 *
 * Grants: client credentials and password run automatically on send when there is no valid
 * token; authorization code (with or without PKCE) needs the user ("Get new token": a browser
 * window and a redirect back to Pigeon). Expired tokens with a refresh token are refreshed.
 */

import type { PreparedRequest, Transport } from '@pigeon/platform';

import type { Auth } from '../../model/auth';

export type OAuth2Auth = Extract<Auth, { type: 'oauth2' }>;

export interface OAuthToken {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  /** Epoch ms; absent = no expiry given. */
  expiresAt?: number;
  scope?: string;
  /** Epoch ms. */
  obtainedAt: number;
}

/** Where a project's tokens are kept (the session's secret store). */
export interface OAuthTokenStore {
  get(key: string): OAuthToken | undefined;
  set(key: string, token: OAuthToken | undefined): void;
}

export class OAuthError extends Error {
  override readonly name = 'OAuthError';
}

/** Tokens are reused across requests with the same grant, token URL, client and scope. */
export function tokenCacheKey(auth: OAuth2Auth): string {
  return [auth.grantType, auth.accessTokenUrl, auth.clientId, auth.scope].join('|');
}

/** Seconds of slack before `expiresAt` at which a token counts as expired. */
const EXPIRY_SLACK_MS = 30_000;

export function isExpired(token: OAuthToken, now = Date.now()): boolean {
  return token.expiresAt !== undefined && token.expiresAt - EXPIRY_SLACK_MS <= now;
}

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += chars[(n >> 18) & 63]! + chars[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += chars[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += chars[n & 63]!;
  }
  return out;
}

/** A PKCE verifier and its challenge (RFC 7636; `plain` sends the verifier itself). */
export async function pkcePair(
  method: string,
  verifier = base64Url(crypto.getRandomValues(new Uint8Array(32))),
): Promise<{ verifier: string; challenge: string; method: 'S256' | 'plain' }> {
  if (method === 'plain') return { verifier, challenge: verifier, method: 'plain' };
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)), method: 'S256' };
}

export function randomState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(12)));
}

export function usesPkce(auth: OAuth2Auth): boolean {
  return auth.grantType === 'authorization_code_with_pkce';
}

export function isAuthorizationCodeGrant(auth: OAuth2Auth): boolean {
  return auth.grantType === 'authorization_code' || usesPkce(auth);
}

/** The URL the user opens to approve access. */
export function authorizationUrl(
  auth: OAuth2Auth,
  options: { redirectUri: string; state: string; challenge?: { value: string; method: string } },
): string {
  if (!URL.canParse(auth.authUrl)) throw new OAuthError('The auth URL is not a valid URL.');
  const url = new URL(auth.authUrl);
  const set = (key: string, value: string) => {
    if (value !== '') url.searchParams.set(key, value);
  };
  set('response_type', 'code');
  set('client_id', auth.clientId);
  set('redirect_uri', options.redirectUri);
  set('scope', auth.scope);
  set('state', options.state);
  if (options.challenge) {
    set('code_challenge', options.challenge.value);
    set('code_challenge_method', options.challenge.method);
  }
  return url.toString();
}

export type TokenGrant =
  | { kind: 'client_credentials' }
  | { kind: 'password' }
  | { kind: 'authorization_code'; code: string; redirectUri: string; codeVerifier?: string }
  | { kind: 'refresh'; refreshToken: string };

function formBody(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** RFC 6749 §2.3.1: id and secret form-encoded, then Basic. */
function basic(user: string, pass: string): string {
  const form = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
  const bytes = encoder.encode(`${form(user)}:${form(pass)}`);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += chars[(n >> 18) & 63]! + chars[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? chars[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? chars[n & 63]! : '=';
  }
  return `Basic ${out}`;
}

/** Calls the token endpoint for `grant` (RFC 6749 §4) and parses the answer. */
export async function requestToken(
  transport: Transport,
  auth: OAuth2Auth,
  grant: TokenGrant,
  options: { signal?: AbortSignal; now?: number } = {},
): Promise<OAuthToken> {
  if (!URL.canParse(auth.accessTokenUrl)) {
    throw new OAuthError('The access token URL is not a valid URL.');
  }
  const params: Record<string, string> =
    grant.kind === 'client_credentials'
      ? { grant_type: 'client_credentials', scope: auth.scope }
      : grant.kind === 'password'
        ? {
            grant_type: 'password',
            username: auth.username,
            password: auth.password,
            scope: auth.scope,
          }
        : grant.kind === 'authorization_code'
          ? {
              grant_type: 'authorization_code',
              code: grant.code,
              redirect_uri: grant.redirectUri,
              ...(grant.codeVerifier ? { code_verifier: grant.codeVerifier } : {}),
            }
          : { grant_type: 'refresh_token', refresh_token: grant.refreshToken, scope: auth.scope };
  const headers: Array<[string, string]> = [
    ['Content-Type', 'application/x-www-form-urlencoded'],
    ['Accept', 'application/json'],
  ];
  if (auth.clientAuthentication === 'body') {
    params['client_id'] = auth.clientId;
    params['client_secret'] = auth.clientSecret;
  } else if (auth.clientSecret !== '') {
    headers.push(['Authorization', basic(auth.clientId, auth.clientSecret)]);
  } else {
    // A public client (no secret) identifies itself in the body.
    params['client_id'] = auth.clientId;
  }
  const request: PreparedRequest = {
    id: crypto.randomUUID(),
    method: 'POST',
    url: auth.accessTokenUrl,
    headers,
    body: { kind: 'bytes', bytes: encoder.encode(formBody(params)) },
    settings: { timeoutMs: 30_000, followRedirects: true, maxRedirects: 5, strictSSL: true },
    meta: {
      protocol: 'http',
      unresolved: [],
      secretValues: [auth.clientSecret, auth.password].filter((v) => v !== ''),
    },
  };
  let raw;
  try {
    raw = await transport.send(request, { signal: options.signal ?? new AbortController().signal });
  } catch (error) {
    throw new OAuthError(
      `The token request failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const text = new TextDecoder().decode(raw.body);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = Object.fromEntries(new URLSearchParams(text));
  }
  if (raw.status >= 400 || typeof data['access_token'] !== 'string') {
    const reason =
      typeof data['error'] === 'string'
        ? `${data['error']}${typeof data['error_description'] === 'string' ? `: ${data['error_description']}` : ''}`
        : `HTTP ${raw.status}`;
    throw new OAuthError(`The token endpoint refused the request (${reason}).`);
  }
  const now = options.now ?? Date.now();
  const expiresIn = Number(data['expires_in']);
  return {
    accessToken: data['access_token'],
    ...(typeof data['token_type'] === 'string' ? { tokenType: data['token_type'] } : {}),
    ...(typeof data['refresh_token'] === 'string'
      ? { refreshToken: data['refresh_token'] }
      : grant.kind === 'refresh'
        ? { refreshToken: grant.refreshToken }
        : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: now + expiresIn * 1000 } : {}),
    ...(typeof data['scope'] === 'string' ? { scope: data['scope'] } : {}),
    obtainedAt: now,
  };
}

/**
 * The token to send with a request: a valid cached one, else a refreshed one, else (client
 * credentials / password) a new one. Authorization-code grants never start a browser flow
 * here; they fall back to a token saved in the file, else `undefined`.
 */
export async function ensureToken(
  transport: Transport,
  store: OAuthTokenStore,
  auth: OAuth2Auth,
  options: { signal?: AbortSignal; now?: number } = {},
): Promise<{ token?: OAuthToken; note?: string }> {
  const key = tokenCacheKey(auth);
  const now = options.now ?? Date.now();
  const cached = store.get(key);
  if (cached && !isExpired(cached, now)) return { token: cached };
  if (cached?.refreshToken) {
    try {
      const refreshed = await requestToken(
        transport,
        auth,
        { kind: 'refresh', refreshToken: cached.refreshToken },
        options,
      );
      store.set(key, refreshed);
      return { token: refreshed, note: 'The expired OAuth 2.0 token was refreshed.' };
    } catch {
      store.set(key, undefined);
    }
  }
  if (auth.grantType === 'client_credentials' || auth.grantType === 'password_credentials') {
    const token = await requestToken(
      transport,
      auth,
      { kind: auth.grantType === 'client_credentials' ? 'client_credentials' : 'password' },
      options,
    );
    store.set(key, token);
    return { token, note: 'A new OAuth 2.0 token was requested.' };
  }
  if (auth.accessToken !== '') return { token: { accessToken: auth.accessToken, obtainedAt: now } };
  return {
    note: isAuthorizationCodeGrant(auth)
      ? 'No OAuth 2.0 token: use "Get new token" in the Auth tab (the authorization code grant needs your approval in a browser).'
      : `OAuth 2.0 grant "${auth.grantType}" is not supported; the request was sent without a token.`,
  };
}
