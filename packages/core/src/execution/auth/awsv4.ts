/**
 * AWS Signature Version 4 (PIGN-046): signs the final method, URL, headers and body hash with
 * WebCrypto HMAC-SHA256 (browser, Tauri webview and Node). Signed headers: `host`, `x-amz-*` and
 * `content-type`, never headers a transport or browser may change. With `addAuthDataToQuery`
 * the signature goes into the query string (presigned URL style) instead of `Authorization`.
 */

import type { Auth } from '../../model/auth';

export type AwsV4Auth = Extract<Auth, { type: 'awsv4' }>;

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

async function hmac(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const raw = typeof key === 'string' ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey(
    'raw',
    raw as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(data)));
}

/** RFC 3986 encoding as AWS wants it (`~` kept, everything else outside unreserved encoded). */
function awsEncode(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(pathname: string, service: string): string {
  if (service === 's3') return pathname || '/';
  // Other services: normalize, then encode each segment (AWS double-encodes the path).
  const segments: string[] = [];
  for (const segment of pathname.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '.' && segment !== '') segments.push(segment);
  }
  const trailing = pathname.length > 1 && pathname.endsWith('/') ? '/' : '';
  const path = segments.map((s) => awsEncode(decodeURIComponent(s))).join('/');
  return `/${path}${path ? trailing : ''}`.replace(/\/+/g, '/');
}

function canonicalQuery(params: ReadonlyArray<[string, string]>): string {
  return params
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** `20150830T123600Z` */
function amzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export interface AwsSigningInput {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  /** The body bytes, or `null` when they aren't known here (multipart, files): unsigned. */
  body: Uint8Array | null;
  now: Date;
}

export interface AwsSigned {
  url: string;
  headers: Array<[string, string]>;
  /** The signature and secrets, to mask in results. */
  credentials: string[];
}

export async function signAwsV4(auth: AwsV4Auth, input: AwsSigningInput): Promise<AwsSigned> {
  const url = new URL(input.url);
  const service = auth.service.trim() || 'execute-api';
  const region = auth.region.trim() || 'us-east-1';
  const date = amzDate(input.now);
  const day = date.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const payloadHash =
    input.body === null ? 'UNSIGNED-PAYLOAD' : await sha256(input.body ?? new Uint8Array());
  const headers = input.headers.filter(([name]) => {
    const lower = name.toLowerCase();
    // Anything a previous signature added is replaced.
    return ![
      'authorization',
      'x-amz-date',
      'x-amz-security-token',
      'x-amz-content-sha256',
    ].includes(lower);
  });
  const query: Array<[string, string]> = [...url.searchParams.entries()].filter(
    ([k]) => !k.startsWith('X-Amz-'),
  );
  const extra: Array<[string, string]> = [];
  if (!auth.addAuthDataToQuery) {
    extra.push(['X-Amz-Date', date]);
    if (auth.sessionToken) extra.push(['X-Amz-Security-Token', auth.sessionToken]);
    if (service === 's3') extra.push(['X-Amz-Content-Sha256', payloadHash]);
  }
  // Signed: host, x-amz-*, content-type (lowercased, values trimmed, sorted).
  const signable = new Map<string, string[]>();
  signable.set('host', [url.host]);
  for (const [name, value] of [...headers, ...extra]) {
    const lower = name.toLowerCase();
    if (lower === 'host') continue;
    if (lower === 'content-type' || lower.startsWith('x-amz-')) {
      signable.set(lower, [...(signable.get(lower) ?? []), value.trim().replace(/\s+/g, ' ')]);
    }
  }
  const names = [...signable.keys()].sort();
  const signedHeaders = names.join(';');
  if (auth.addAuthDataToQuery) {
    query.push(
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${auth.accessKey}/${scope}`],
      ['X-Amz-Date', date],
      ['X-Amz-SignedHeaders', signedHeaders],
      ...(auth.sessionToken
        ? ([['X-Amz-Security-Token', auth.sessionToken]] as Array<[string, string]>)
        : []),
    );
  }
  const canonical = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname, service),
    canonicalQuery(query),
    names.map((name) => `${name}:${signable.get(name)!.join(',')}\n`).join(''),
    signedHeaders,
    auth.addAuthDataToQuery ? 'UNSIGNED-PAYLOAD' : payloadHash,
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', date, scope, await sha256(canonical)].join('\n');
  let key = await hmac(`AWS4${auth.secretKey}`, day);
  for (const part of [region, service, 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  const credentials = [
    auth.secretKey,
    signature,
    ...(auth.sessionToken ? [auth.sessionToken] : []),
  ];
  if (auth.addAuthDataToQuery) {
    const signedUrl = new URL(url);
    signedUrl.search = `?${canonicalQuery([...query, ['X-Amz-Signature', signature]])}`;
    return { url: signedUrl.toString(), headers, credentials };
  }
  return {
    url: input.url,
    headers: [
      ...headers,
      ...extra,
      [
        'Authorization',
        `AWS4-HMAC-SHA256 Credential=${auth.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ],
    ],
    credentials,
  };
}
