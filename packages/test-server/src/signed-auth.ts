/**
 * `/auth/digest` and `/auth/awsv4` (PIGN-046): servers that check Digest answers and AWS SigV4
 * signatures independently of Pigeon's client code (node:crypto).
 */

import { createHash, createHmac } from 'node:crypto';

import type { Handler } from './reply.ts';
import { json } from './reply.ts';

/** Fixed per process, so a challenge stays valid for the retry. */
const NONCE = createHash('sha256').update(String(process.pid)).digest('hex').slice(0, 32);
const OPAQUE = 'pigeon-opaque';
export const DIGEST_REALM = 'pigeon-test';

function digestHash(algorithm: string, text: string): string {
  return createHash(/^sha-?256/i.test(algorithm) ? 'sha256' : 'md5')
    .update(text)
    .digest('hex');
}

function params(header: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of header.matchAll(/([a-zA-Z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) {
    out.set(m[1]!.toLowerCase(), (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1'));
  }
  return out;
}

/** `?user=&pass=&algorithm=MD5|SHA-256` (defaults user/pass, MD5), `qop=auth`. */
export const digestHandler: Handler = ({ req, query, method }) => {
  const user = query.get('user') ?? 'user';
  const pass = query.get('pass') ?? 'pass';
  const algorithm = query.get('algorithm') ?? 'MD5';
  const challenge = {
    'WWW-Authenticate': `Digest realm="${DIGEST_REALM}", qop="auth", algorithm=${algorithm}, nonce="${NONCE}", opaque="${OPAQUE}"`,
  };
  const header = req.headers.authorization ?? '';
  if (!/^digest\s/i.test(header)) return json({ authenticated: false }, 401, challenge);
  const p = params(header.slice(7));
  const ha1 = digestHash(algorithm, `${p.get('username')}:${DIGEST_REALM}:${pass}`);
  const ha2 = digestHash(algorithm, `${method}:${p.get('uri')}`);
  const expected = digestHash(
    algorithm,
    `${ha1}:${p.get('nonce')}:${p.get('nc')}:${p.get('cnonce')}:${p.get('qop')}:${ha2}`,
  );
  const ok =
    p.get('username') === user &&
    p.get('realm') === DIGEST_REALM &&
    p.get('nonce') === NONCE &&
    p.get('qop') === 'auth' &&
    p.get('response') === expected &&
    req.url === p.get('uri');
  return ok
    ? json({ authenticated: true, user, algorithm })
    : json({ authenticated: false, reason: 'wrong digest response' }, 401, challenge);
};

/** The keys `/auth/awsv4` accepts. */
export const AWS_TEST_KEYS = {
  accessKey: 'AKIDPIGEONTEST',
  secretKey: 'pigeon/test+secret',
  region: 'eu-test-1',
  service: 'pigeon',
} as const;

const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Verifies `Authorization: AWS4-HMAC-SHA256 …` or a presigned query against `AWS_TEST_KEYS`. */
export const awsv4Handler: Handler = ({ req, query, method, path, body }) => {
  const header = req.headers.authorization ?? '';
  const presigned = query.has('X-Amz-Signature');
  const credential = presigned
    ? (query.get('X-Amz-Credential') ?? '')
    : (/Credential=([^,]+)/.exec(header)?.[1] ?? '');
  const signedHeaders = presigned
    ? (query.get('X-Amz-SignedHeaders') ?? '')
    : (/SignedHeaders=([^,]+)/.exec(header)?.[1] ?? '');
  const signature = presigned
    ? (query.get('X-Amz-Signature') ?? '')
    : (/Signature=([0-9a-f]+)/.exec(header)?.[1] ?? '');
  const date = presigned
    ? (query.get('X-Amz-Date') ?? '')
    : String(req.headers['x-amz-date'] ?? '');
  const [accessKey, day, region, service] = credential.split('/');
  const fail = (reason: string) => json({ authenticated: false, reason }, 403);
  if (accessKey !== AWS_TEST_KEYS.accessKey) return fail('unknown access key');
  if (region !== AWS_TEST_KEYS.region || service !== AWS_TEST_KEYS.service) {
    return fail('wrong region or service');
  }
  const segments = path.split('/').filter((s) => s !== '' && s !== '.');
  const canonicalPath = `/${segments.map((s) => enc(decodeURIComponent(s))).join('/')}`;
  const canonicalQuery = [...query.entries()]
    .filter(([k]) => k !== 'X-Amz-Signature')
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const names = signedHeaders.split(';');
  const headerLines = names
    .map((name) => {
      const raw = req.headers[name];
      const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      return `${name}:${value.trim().replace(/\s+/g, ' ')}\n`;
    })
    .join('');
  const payload = presigned
    ? 'UNSIGNED-PAYLOAD'
    : String(req.headers['x-amz-content-sha256'] ?? '') === 'UNSIGNED-PAYLOAD'
      ? 'UNSIGNED-PAYLOAD'
      : sha256(body);
  const canonical = [
    method,
    canonicalPath,
    canonicalQuery,
    headerLines,
    signedHeaders,
    payload,
  ].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join('\n');
  let key: Buffer = createHmac('sha256', `AWS4${AWS_TEST_KEYS.secretKey}`)
    .update(day ?? '')
    .digest();
  for (const part of [region!, service!, 'aws4_request'])
    key = createHmac('sha256', key).update(part).digest();
  const expected = createHmac('sha256', key).update(toSign).digest('hex');
  return expected === signature
    ? json({ authenticated: true, signedHeaders: names, presigned })
    : fail('signature does not match');
};
