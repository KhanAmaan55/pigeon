/**
 * Postman auth ⇄ `ProjectAuth` (compatibility.md §A.2, PIGN-026). Postman v2.1 stores the params
 * of the active type as `[{ key, value, type }]` under the type's name; v2.0 used an object
 * (`basic: { username, password }`), which is read too. `noauth`, `basic`, `bearer` and `apikey`
 * are typed; every other type is kept verbatim as `unsupported`.
 */

import type { ExtraFields, ProjectAuth } from '../project/types';

type Typed = Exclude<ProjectAuth, { type: 'unsupported' }>;

/** The params Pigeon edits for each typed auth, in the order Postman writes them. */
const FIELDS = {
  noauth: [],
  basic: ['username', 'password'],
  bearer: ['token'],
  apikey: ['key', 'value', 'in'],
  digest: [
    'username',
    'password',
    'realm',
    'nonce',
    'algorithm',
    'qop',
    'nonceCount',
    'clientNonce',
    'opaque',
  ],
  awsv4: ['accessKey', 'secretKey', 'region', 'service', 'sessionToken', 'addAuthDataToQuery'],
  oauth2: [
    'grant_type',
    'authUrl',
    'accessTokenUrl',
    'clientId',
    'clientSecret',
    'scope',
    'state',
    'redirect_uri',
    'username',
    'password',
    'challengeAlgorithm',
    'code_verifier',
    'client_authentication',
    'addTokenTo',
    'headerPrefix',
    'accessToken',
    'tokenName',
  ],
} as const satisfies Record<Typed['type'], readonly string[]>;

function isObject(value: unknown): value is ExtraFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** `{ key: value }` of a Postman params array (v2.1) or object (v2.0). */
function paramsOf(raw: ExtraFields, type: string): Map<string, unknown> {
  const params = raw[type];
  const map = new Map<string, unknown>();
  if (Array.isArray(params)) {
    for (const entry of params) {
      if (isObject(entry) && typeof entry['key'] === 'string' && !map.has(entry['key'])) {
        map.set(entry['key'], entry['value']);
      }
    }
  } else if (isObject(params)) {
    for (const [key, value] of Object.entries(params)) map.set(key, value);
  }
  return map;
}

export function authFromPostman(raw: unknown): ProjectAuth {
  if (!isObject(raw) || typeof raw['type'] !== 'string') {
    const type = isObject(raw) ? asText(raw['type']) : '';
    return { type: 'unsupported', authType: type || 'unknown', source: raw };
  }
  const type = raw['type'];
  const params = paramsOf(raw, type);
  const text = (key: string) => asText(params.get(key));
  switch (type) {
    case 'noauth':
      return { type, source: raw };
    case 'basic':
      return { type, username: text('username'), password: text('password'), source: raw };
    case 'bearer':
      return { type, token: text('token'), source: raw };
    case 'apikey':
      return {
        type,
        key: text('key'),
        value: text('value'),
        in: text('in') === 'query' ? 'query' : 'header',
        source: raw,
      };
    case 'digest':
      return {
        type,
        username: text('username'),
        password: text('password'),
        realm: text('realm'),
        nonce: text('nonce'),
        algorithm: text('algorithm'),
        qop: text('qop'),
        nonceCount: text('nonceCount'),
        clientNonce: text('clientNonce'),
        opaque: text('opaque'),
        source: raw,
      };
    case 'awsv4':
      return {
        type,
        accessKey: text('accessKey'),
        secretKey: text('secretKey'),
        region: text('region'),
        service: text('service'),
        sessionToken: text('sessionToken'),
        addAuthDataToQuery:
          params.get('addAuthDataToQuery') === true || text('addAuthDataToQuery') === 'true',
        source: raw,
      };
    case 'oauth2':
      return {
        type,
        grantType: text('grant_type'),
        authUrl: text('authUrl'),
        accessTokenUrl: text('accessTokenUrl'),
        clientId: text('clientId'),
        clientSecret: text('clientSecret'),
        scope: text('scope'),
        state: text('state'),
        redirectUri: text('redirect_uri'),
        username: text('username'),
        password: text('password'),
        challengeAlgorithm: text('challengeAlgorithm'),
        codeVerifier: text('code_verifier'),
        clientAuthentication: text('client_authentication'),
        addTokenTo: text('addTokenTo'),
        headerPrefix: text('headerPrefix'),
        accessToken: text('accessToken'),
        tokenName: text('tokenName'),
        source: raw,
      };
    default:
      return { type: 'unsupported', authType: type, source: raw };
  }
}

/** The edited fields of a typed auth, as Postman param values. */
function fieldValues(auth: Typed): Record<string, string> {
  switch (auth.type) {
    case 'noauth':
      return {};
    case 'basic':
      return { username: auth.username, password: auth.password };
    case 'bearer':
      return { token: auth.token };
    case 'apikey':
      return { key: auth.key, value: auth.value, in: auth.in };
    case 'digest':
      return {
        username: auth.username,
        password: auth.password,
        realm: auth.realm,
        nonce: auth.nonce,
        algorithm: auth.algorithm,
        qop: auth.qop,
        nonceCount: auth.nonceCount,
        clientNonce: auth.clientNonce,
        opaque: auth.opaque,
      };
    case 'awsv4':
      return {
        accessKey: auth.accessKey,
        secretKey: auth.secretKey,
        region: auth.region,
        service: auth.service,
        sessionToken: auth.sessionToken,
        addAuthDataToQuery: auth.addAuthDataToQuery ? 'true' : 'false',
      };
    case 'oauth2':
      return {
        grant_type: auth.grantType,
        authUrl: auth.authUrl,
        accessTokenUrl: auth.accessTokenUrl,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        scope: auth.scope,
        state: auth.state,
        redirect_uri: auth.redirectUri,
        username: auth.username,
        password: auth.password,
        challengeAlgorithm: auth.challengeAlgorithm,
        code_verifier: auth.codeVerifier,
        client_authentication: auth.clientAuthentication,
        addTokenTo: auth.addTokenTo,
        headerPrefix: auth.headerPrefix,
        accessToken: auth.accessToken,
        tokenName: auth.tokenName,
      };
  }
}

function sameFields(a: Typed, b: ProjectAuth): boolean {
  if (a.type !== b.type) return false;
  const left = fieldValues(a);
  const right = fieldValues(b as Typed);
  return Object.keys(left).every((key) => left[key] === right[key]);
}

/** Values a param may be left out with (Postman omits them too). */
const DEFAULTS: Record<string, string> = { in: 'header', addAuthDataToQuery: 'false' };

/** Params Postman stores as booleans. */
const BOOLEAN_PARAMS = new Set(['addAuthDataToQuery']);

export function authToPostman(auth: ProjectAuth): unknown {
  if (auth.type === 'unsupported') return 'source' in auth ? auth.source : { type: auth.authType };
  const source = isObject(auth.source) && auth.source['type'] === auth.type ? auth.source : {};
  // Unchanged: exactly as read.
  if (auth.source !== undefined && sameFields(auth, authFromPostman(auth.source))) {
    return auth.source;
  }
  const values = fieldValues(auth);
  const fields: readonly string[] = FIELDS[auth.type];
  if (fields.length === 0) {
    return { ...source, type: auth.type };
  }
  const existing = source[auth.type];
  // Edit the params array in place, keeping unknown params, their order and extra keys.
  const entries: unknown[] = Array.isArray(existing) ? [...existing] : [];
  const written = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (!isObject(entry) || typeof entry['key'] !== 'string') continue;
    const key = entry['key'];
    if (!(key in values) || written.has(key)) continue;
    written.add(key);
    const typed = BOOLEAN_PARAMS.has(key) ? values[key] === 'true' : values[key];
    if (asText(entry['value']) !== values[key]) entries[index] = { ...entry, value: typed };
  }
  for (const key of fields) {
    if (written.has(key)) continue;
    const value = values[key]!;
    if (value === '' || value === DEFAULTS[key]) continue;
    entries.push(
      BOOLEAN_PARAMS.has(key)
        ? { key, value: value === 'true', type: 'boolean' }
        : { key, value, type: 'string' },
    );
  }
  return { ...source, type: auth.type, [auth.type]: entries };
}

/** A label for the auth type, as the UI and warnings name it. */
export function authTypeLabel(auth: ProjectAuth): string {
  switch (auth.type) {
    case 'noauth':
      return 'No auth';
    case 'basic':
      return 'Basic';
    case 'bearer':
      return 'Bearer';
    case 'apikey':
      return 'API Key';
    case 'digest':
      return 'Digest';
    case 'awsv4':
      return 'AWS Signature';
    case 'oauth2':
      return 'OAuth 2.0';
    case 'unsupported':
      return auth.authType;
  }
}
