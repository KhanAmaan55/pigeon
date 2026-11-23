/**
 * A tiny OAuth 2.0 server (PIGN-047): `/oauth/authorize` approves at once and redirects back with
 * a code, `/oauth/token` issues tokens (client credentials, password, authorization code with
 * PKCE, refresh), `/oauth/protected` accepts only issued, unexpired tokens.
 * `?expires_in=<s>` on the token URL sets the lifetime (default 3600).
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Handler } from './reply.ts';
import { json } from './reply.ts';

export const OAUTH_TEST = {
  clientId: 'pigeon-client',
  clientSecret: 'pigeon-secret',
  username: 'ada',
  password: 'lovelace',
} as const;

const codes = new Map<string, { redirectUri: string; challenge?: string; method?: string }>();
const tokens = new Map<string, number>();
const refreshTokens = new Set<string>();
const id = () => randomBytes(12).toString('hex');

export const authorizeHandler: Handler = ({ query }) => {
  const redirect = query.get('redirect_uri');
  if (!redirect || query.get('client_id') !== OAUTH_TEST.clientId) {
    return json({ error: 'invalid_request' }, 400);
  }
  const code = id();
  const challenge = query.get('code_challenge');
  codes.set(code, {
    redirectUri: redirect,
    ...(challenge ? { challenge, method: query.get('code_challenge_method') ?? 'plain' } : {}),
  });
  const target = new URL(redirect);
  target.searchParams.set('code', code);
  const state = query.get('state');
  if (state) target.searchParams.set('state', state);
  return { status: 302, headers: { Location: target.toString() }, body: '' };
};

export const tokenHandler: Handler = ({ req, body, query }) => {
  const form = new URLSearchParams(body.toString('utf8'));
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ', 2);
  const basic =
    scheme?.toLowerCase() === 'basic'
      ? Buffer.from(encoded ?? '', 'base64')
          .toString('utf8')
          .split(':')
          .map(decodeURIComponent)
      : [];
  const clientId = basic[0] ?? form.get('client_id');
  const clientSecret = basic[1] ?? form.get('client_secret');
  const deny = (error: string) => json({ error, error_description: `test server: ${error}` }, 400);
  if (clientId !== OAUTH_TEST.clientId) return deny('invalid_client');
  const grant = form.get('grant_type');
  // A confidential client must send its secret, except a PKCE public client.
  const pkce = grant === 'authorization_code' && form.has('code_verifier');
  if (!pkce && clientSecret !== OAUTH_TEST.clientSecret) return deny('invalid_client');
  if (grant === 'password') {
    if (
      form.get('username') !== OAUTH_TEST.username ||
      form.get('password') !== OAUTH_TEST.password
    ) {
      return deny('invalid_grant');
    }
  } else if (grant === 'authorization_code') {
    const code = codes.get(form.get('code') ?? '');
    if (!code || code.redirectUri !== form.get('redirect_uri')) return deny('invalid_grant');
    if (code.challenge) {
      const verifier = form.get('code_verifier') ?? '';
      const computed =
        code.method === 'S256'
          ? createHash('sha256').update(verifier).digest('base64url')
          : verifier;
      if (computed !== code.challenge) return deny('invalid_grant');
    }
    codes.delete(form.get('code')!);
  } else if (grant === 'refresh_token') {
    if (!refreshTokens.delete(form.get('refresh_token') ?? '')) return deny('invalid_grant');
  } else if (grant !== 'client_credentials') {
    return deny('unsupported_grant_type');
  }
  const expiresIn = Number(query.get('expires_in') ?? 3600);
  const accessToken = `at-${id()}`;
  tokens.set(accessToken, Date.now() + expiresIn * 1000);
  const refreshToken = grant === 'client_credentials' ? undefined : `rt-${id()}`;
  if (refreshToken) refreshTokens.add(refreshToken);
  return json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    scope: form.get('scope') ?? '',
    grant_type: grant,
  });
};

export const protectedHandler: Handler = ({ req, query }) => {
  const [scheme, value] = (req.headers.authorization ?? '').split(' ', 2);
  const token =
    scheme?.toLowerCase() === 'bearer' ? value : (query.get('access_token') ?? undefined);
  const expires = token ? tokens.get(token) : undefined;
  return expires !== undefined && expires > Date.now()
    ? json({ authenticated: true })
    : json({ authenticated: false }, 401, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
};
