/**
 * Auth handlers (docs/api-execution.md §4, PIGN-026): each turns an auth definition, with its
 * variables already resolved, into the headers and query params it adds. `prepareRequest` merges
 * them (a header the user set wins, with a warning) and masks the credentials in results.
 */

import type { Auth } from '../../model/auth';

export { inheritedAuth } from './inherit';
export type { AuthOrigin, EffectiveAuth } from './inherit';

export interface AuthOutput {
  headers: Array<[string, string]>;
  query: Array<[string, string]>;
  /** Values shown masked in results (tokens, passwords, encoded credentials). */
  credentials: string[];
  warnings: string[];
  /**
   * Auth applied by the executor once the final request is known (PIGN-046): Digest answers the
   * server's challenge, AWS SigV4 signs the final URL, headers and body.
   */
  deferred?: Extract<Auth, { type: 'digest' | 'awsv4' }>;
}

export interface AuthHandler<A extends Auth = Auth> {
  type: A['type'];
  apply(auth: A): AuthOutput;
}

const none = (): AuthOutput => ({ headers: [], query: [], credentials: [], warnings: [] });

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** UTF-8 bytes, base64 encoded (RFC 7617 with charset UTF-8). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!;
    out += b === undefined ? '=' : BASE64[(n >> 6) & 63]!;
    out += c === undefined ? '=' : BASE64[n & 63]!;
  }
  return out;
}

const handlers = new Map<string, AuthHandler>();

export function registerAuthHandler<A extends Auth>(handler: AuthHandler<A>): void {
  handlers.set(handler.type, handler as unknown as AuthHandler);
}

registerAuthHandler<Extract<Auth, { type: 'noauth' }>>({ type: 'noauth', apply: none });

registerAuthHandler<Extract<Auth, { type: 'basic' }>>({
  type: 'basic',
  apply: ({ username, password }) => {
    const encoded = base64Utf8(`${username}:${password}`);
    return {
      ...none(),
      headers: [['Authorization', `Basic ${encoded}`]],
      credentials: [encoded, password],
    };
  },
});

registerAuthHandler<Extract<Auth, { type: 'bearer' }>>({
  type: 'bearer',
  apply: ({ token }) =>
    token === ''
      ? { ...none(), warnings: ['Bearer auth has no token; no Authorization header was added.'] }
      : { ...none(), headers: [['Authorization', `Bearer ${token}`]], credentials: [token] },
});

registerAuthHandler<Extract<Auth, { type: 'apikey' }>>({
  type: 'apikey',
  apply: ({ key, value, in: placement }) => {
    const name = key.trim();
    if (name === '')
      return { ...none(), warnings: ['API key auth has no key name; nothing added.'] };
    const entry: [string, string] = [name, value];
    return {
      ...none(),
      ...(placement === 'query' ? { query: [entry] } : { headers: [entry] }),
      credentials: [value],
    };
  },
});

registerAuthHandler<Extract<Auth, { type: 'digest' }>>({
  type: 'digest',
  apply: (auth) =>
    auth.username === ''
      ? { ...none(), warnings: ['Digest auth has no username; the request was sent without auth.'] }
      : { ...none(), credentials: [auth.password], deferred: auth },
});

registerAuthHandler<Extract<Auth, { type: 'awsv4' }>>({
  type: 'awsv4',
  apply: (auth) =>
    auth.accessKey === '' || auth.secretKey === ''
      ? {
          ...none(),
          warnings: [
            'AWS Signature needs an access key and a secret key; the request was not signed.',
          ],
        }
      : {
          ...none(),
          credentials: [auth.secretKey, ...(auth.sessionToken ? [auth.sessionToken] : [])],
          deferred: auth,
        },
});

/** What `auth` adds to a request; unsupported types add nothing and a warning. */
export function applyAuth(auth: Auth | undefined): AuthOutput {
  if (!auth) return none();
  const handler = handlers.get(auth.type);
  if (auth.type === 'unsupported' || !handler) {
    const name = auth.type === 'unsupported' ? auth.authType : auth.type;
    return {
      ...none(),
      warnings: [`Auth type "${name}" is not supported yet; the request was sent without auth.`],
    };
  }
  return handler.apply(auth);
}

/** `auth` with `{{variables}}` resolved in every field the handlers read. */
export function resolveAuth(auth: Auth, resolve: (text: string) => string): Auth {
  switch (auth.type) {
    case 'basic':
      return { ...auth, username: resolve(auth.username), password: resolve(auth.password) };
    case 'bearer':
      return { ...auth, token: resolve(auth.token) };
    case 'apikey':
      return { ...auth, key: resolve(auth.key), value: resolve(auth.value) };
    case 'digest':
      return {
        ...auth,
        username: resolve(auth.username),
        password: resolve(auth.password),
        realm: resolve(auth.realm),
        nonce: resolve(auth.nonce),
        algorithm: resolve(auth.algorithm),
        qop: resolve(auth.qop),
        nonceCount: resolve(auth.nonceCount),
        clientNonce: resolve(auth.clientNonce),
        opaque: resolve(auth.opaque),
      };
    case 'awsv4':
      return {
        ...auth,
        accessKey: resolve(auth.accessKey),
        secretKey: resolve(auth.secretKey),
        region: resolve(auth.region),
        service: resolve(auth.service),
        sessionToken: resolve(auth.sessionToken),
      };
    default:
      return auth;
  }
}
