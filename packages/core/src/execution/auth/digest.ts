/**
 * HTTP Digest auth (RFC 7616, PIGN-046): the client half. The executor sends once; on a 401 with
 * a `WWW-Authenticate: Digest …` challenge it answers with `Authorization: Digest …` and sends
 * again. With `realm` and `nonce` set in the auth, the first request is signed directly
 * (Postman's preemptive mode). MD5 is implemented here (WebCrypto has none); SHA-256 uses
 * WebCrypto.
 */

import type { Auth } from '../../model/auth';

export type DigestAuth = Extract<Auth, { type: 'digest' }>;

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  algorithm?: string;
  opaque?: string;
}

/** Parses `WWW-Authenticate: Digest realm="…", nonce="…", …` (the first Digest challenge). */
export function parseDigestChallenge(header: string): DigestChallenge | null {
  const at = header.search(/digest\s/i);
  if (at === -1) return null;
  const params = new Map<string, string>();
  const pattern = /([a-zA-Z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  for (const match of header.slice(at + 7).matchAll(pattern)) {
    params.set(match[1]!.toLowerCase(), (match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1'));
  }
  const realm = params.get('realm');
  const nonce = params.get('nonce');
  if (realm === undefined || nonce === undefined) return null;
  return {
    realm,
    nonce,
    ...(params.has('qop') ? { qop: params.get('qop')! } : {}),
    ...(params.has('algorithm') ? { algorithm: params.get('algorithm')! } : {}),
    ...(params.has('opaque') ? { opaque: params.get('opaque')! } : {}),
  };
}

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** MD5 (RFC 1321) of UTF-8 text, as lowercase hex. */
export function md5Hex(text: string): string {
  const data = encoder.encode(text);
  const length = data.length;
  const words = new Uint32Array((((length + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < length; i++) words[i >> 2]! |= data[i]! << ((i % 4) * 8);
  words[length >> 2]! |= 0x80 << ((length % 4) * 8);
  words[words.length - 2] = (length * 8) >>> 0;
  words[words.length - 1] = Math.floor((length * 8) / 2 ** 32);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
  );
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let block = 0; block < words.length; block += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + K[i]! + words[block + g]!) >>> 0;
      const shift = S[(i >> 4) * 4 + (i % 4)]!;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((word, i) => {
    for (let j = 0; j < 4; j++) out[i * 4 + j] = (word >>> (j * 8)) & 0xff;
  });
  return hex(out);
}

async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

async function hash(algorithm: string, text: string): Promise<string> {
  return /^sha-?256/i.test(algorithm) ? sha256Hex(text) : md5Hex(text);
}

function quote(value: string): string {
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

/** A random client nonce (hex). */
export function clientNonce(): string {
  return hex(crypto.getRandomValues(new Uint8Array(8)));
}

/**
 * The `Authorization: Digest …` value for `method` and `uri` (path + query) answering
 * `challenge` (fields set in the auth win over the challenge's, like Postman).
 */
export async function digestAuthorization(
  auth: DigestAuth,
  challenge: DigestChallenge,
  method: string,
  uri: string,
  cnonce = auth.clientNonce || clientNonce(),
): Promise<string> {
  const realm = auth.realm || challenge.realm;
  const nonce = auth.nonce || challenge.nonce;
  const algorithm = auth.algorithm || challenge.algorithm || 'MD5';
  const opaque = auth.opaque || challenge.opaque;
  // `qop=auth` when offered (auth-int is not supported).
  const offered = (auth.qop || challenge.qop || '').split(',').map((q) => q.trim());
  const qop = offered.includes('auth') ? 'auth' : undefined;
  const nc = (auth.nonceCount || '00000001').padStart(8, '0');
  let ha1 = await hash(algorithm, `${auth.username}:${realm}:${auth.password}`);
  if (/-sess$/i.test(algorithm)) ha1 = await hash(algorithm, `${ha1}:${nonce}:${cnonce}`);
  const ha2 = await hash(algorithm, `${method.toUpperCase()}:${uri}`);
  const response = await hash(
    algorithm,
    qop ? `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}` : `${ha1}:${nonce}:${ha2}`,
  );
  return [
    `Digest username=${quote(auth.username)}`,
    `realm=${quote(realm)}`,
    `nonce=${quote(nonce)}`,
    `uri=${quote(uri)}`,
    `algorithm=${algorithm}`,
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`] : []),
    `response=${quote(response)}`,
    ...(opaque ? [`opaque=${quote(opaque)}`] : []),
  ].join(', ');
}
