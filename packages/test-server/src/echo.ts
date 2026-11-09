import { createHash } from 'node:crypto';

import type { RequestContext } from './reply.ts';

export type EchoPart =
  | { name: string; kind: 'text'; value: string }
  | {
      name: string;
      kind: 'file';
      filename: string;
      contentType: string;
      size: number;
      sha256: string;
    };

export type EchoParsedBody =
  | { kind: 'json'; value: unknown }
  | { kind: 'urlencoded'; fields: Array<[string, string]> }
  | { kind: 'multipart'; parts: EchoPart[] }
  | { kind: 'invalid'; contentType: string; error: string };

/** The `/echo` response body. */
export interface EchoResponse {
  method: string;
  /** Request target exactly as received (path + query). */
  url: string;
  path: string;
  /** Decoded query; repeated names become arrays. */
  query: Record<string, string | string[]>;
  /** Lower-cased names, as Node's `IncomingMessage.headers` combines them. */
  headers: Record<string, string | string[]>;
  /** Original names, order and duplicates. */
  rawHeaders: Array<[string, string]>;
  httpVersion: string;
  body: {
    size: number;
    /** `null` when the bytes are not valid UTF-8. */
    text: string | null;
    base64: string;
  };
  /** Set for non-empty JSON, urlencoded and multipart bodies. */
  parsed: EchoParsedBody | null;
}

export async function echo(ctx: RequestContext): Promise<EchoResponse> {
  const { req, body } = ctx;
  const rawHeaders: Array<[string, string]> = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    rawHeaders.push([req.rawHeaders[i] ?? '', req.rawHeaders[i + 1] ?? '']);
  }
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers[name] = value;
  }
  return {
    method: ctx.method,
    url: req.url ?? '',
    path: ctx.path,
    query: groupQuery(ctx.query),
    headers,
    rawHeaders,
    httpVersion: req.httpVersion,
    body: { size: body.byteLength, text: utf8(body), base64: body.toString('base64') },
    parsed: await parseBody(req.headers['content-type'] ?? '', body),
  };
}

function groupQuery(query: URLSearchParams): Record<string, string | string[]> {
  const grouped: Record<string, string | string[]> = {};
  for (const name of new Set(query.keys())) {
    const values = query.getAll(name);
    grouped[name] = values.length === 1 ? (values[0] ?? '') : values;
  }
  return grouped;
}

function utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function parseBody(contentType: string, body: Buffer): Promise<EchoParsedBody | null> {
  if (body.byteLength === 0) return null;
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  try {
    if (mime === 'application/json' || mime.endsWith('+json')) {
      return { kind: 'json', value: JSON.parse(body.toString('utf8')) };
    }
    if (mime === 'application/x-www-form-urlencoded') {
      return { kind: 'urlencoded', fields: [...new URLSearchParams(body.toString('utf8'))] };
    }
    if (mime === 'multipart/form-data') {
      return { kind: 'multipart', parts: await parseMultipart(contentType, body) };
    }
  } catch (err) {
    return {
      kind: 'invalid',
      contentType,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return null;
}

/** Multipart parsing via undici's `Request.formData()`, so no extra dependency is needed. */
async function parseMultipart(contentType: string, body: Buffer): Promise<EchoPart[]> {
  const form = await new Request('http://test-server.invalid/', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  }).formData();
  const parts: EchoPart[] = [];
  for (const [name, value] of form) {
    if (typeof value === 'string') {
      parts.push({ name, kind: 'text', value });
    } else {
      const bytes = new Uint8Array(await value.arrayBuffer());
      parts.push({
        name,
        kind: 'file',
        filename: value.name,
        contentType: value.type,
        size: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  return parts;
}
