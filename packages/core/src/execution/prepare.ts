/**
 * Request → `PreparedRequest` (docs/api-execution.md §1 steps 3–4). Pure: no I/O, no platform
 * APIs. Variables (PIGN-023), more body modes (PIGN-009) and auth (PIGN-026) plug in here.
 */

import type { Capabilities, PreparedBody, PreparedRequest } from '@pigeon/platform';

import type { Body, RawLanguage, Request } from '../model/request';
import { buildRequestUrl } from '../model/url';
import { PIGEON_VERSION } from '../version';
import type { ExecutionContext, ExecutionError, Result } from './types';

/** RFC 9110 `token`: valid method and header names. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Header values may not contain CR, LF or NUL. */
const INVALID_HEADER_VALUE = /[\r\n\0]/;
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

const RAW_CONTENT_TYPES: Record<RawLanguage, string> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
};

const encoder = new TextEncoder();

export async function prepareRequest(
  request: Request,
  ctx: ExecutionContext,
): Promise<Result<PreparedRequest, ExecutionError>> {
  const method = request.method.trim().toUpperCase();
  if (!TOKEN.test(method)) {
    return invalid('invalid-request', `"${request.method}" is not a valid HTTP method.`);
  }

  const url = normalizeUrl(buildRequestUrl(request.url));
  if (!url.ok) return url;

  const headers: Array<[string, string]> = [];
  for (const header of request.headers) {
    const name = header.key.trim();
    if (header.disabled || name === '') continue;
    if (!TOKEN.test(name)) return invalid('invalid-request', `Invalid header name "${name}".`);
    if (INVALID_HEADER_VALUE.test(header.value)) {
      return invalid('invalid-request', `Header "${name}" contains a line break.`);
    }
    headers.push([name, header.value]);
  }

  const encoded = encodeBody(request.body);
  if (encoded && (method === 'GET' || method === 'HEAD') && !ctx.capabilities.canSendBodyWithGet) {
    return invalid(
      'invalid-request',
      `${method} requests cannot have a body here.`,
      'Remove the body or use another method, e.g. POST. The desktop app can send it.',
    );
  }

  for (const { name, value } of autoHeaders(request, ctx.capabilities)) headers.push([name, value]);

  const { preferences } = ctx;
  const { settings } = request;
  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      method,
      url: url.value,
      headers,
      ...(encoded ? { body: encoded } : {}),
      settings: {
        timeoutMs: settings.timeoutMs ?? preferences.timeoutMs,
        followRedirects: settings.followRedirects ?? preferences.followRedirects,
        maxRedirects: settings.maxRedirects ?? preferences.maxRedirects,
        strictSSL: settings.strictSSL ?? preferences.strictSSL,
      },
      meta: {
        requestId: request.id,
        ...(ctx.projectId === null ? {} : { projectId: ctx.projectId }),
        protocol: 'http',
        unresolved: [],
        secretValues: [],
      },
    },
  };
}

/**
 * Trims the URL, adds `http://` when no scheme was typed (like Postman), and checks it parses as
 * an http(s) URL. Otherwise the typed URL is preserved as is.
 */
export function normalizeUrl(raw: string): Result<string, ExecutionError> {
  const trimmed = raw.trim();
  if (trimmed === '') return invalid('invalid-url', 'Enter a URL.');
  const url = HAS_SCHEME.test(trimmed) ? trimmed : `http://${trimmed}`;
  if (!URL.canParse(url)) return invalid('invalid-url', `"${trimmed}" is not a valid URL.`);
  const { protocol } = new URL(url);
  if (protocol !== 'http:' && protocol !== 'https:') {
    return invalid('invalid-url', `Unsupported protocol "${protocol}". Use http:// or https://.`);
  }
  return { ok: true, value: url };
}

function encodeBody(body: Body): PreparedBody | undefined {
  if (body.disabled) return undefined;
  switch (body.mode) {
    case 'none':
      return undefined;
    case 'raw':
      return { kind: 'bytes', bytes: encoder.encode(body.raw) };
  }
}

/** A header Pigeon adds unless the user set one with the same name (docs/api-execution.md §1). */
export interface AutoHeader {
  name: string;
  value: string;
  /** Why it is added, for the headers tab. */
  reason: string;
}

/**
 * Headers `prepareRequest` appends after the user's enabled headers, skipping any name the user
 * set (case-insensitive). `User-Agent` only where the transport can set it: browsers send their
 * own and would drop Pigeon's with a warning on every request.
 */
export function autoHeaders(
  request: Pick<Request, 'headers' | 'body'>,
  capabilities: Pick<Capabilities, 'canSetAnyHeader'>,
): AutoHeader[] {
  const candidates: AutoHeader[] = [];
  if (capabilities.canSetAnyHeader) {
    candidates.push({
      name: 'User-Agent',
      value: `Pigeon/${PIGEON_VERSION}`,
      reason: 'Identifies Pigeon to the server.',
    });
  }
  candidates.push({ name: 'Accept', value: '*/*', reason: 'Accepts any response type.' });
  const contentType = bodyContentType(request.body);
  if (contentType !== undefined) {
    candidates.push({ name: 'Content-Type', value: contentType, reason: 'From the body type.' });
  }
  const userSet = new Set(
    request.headers
      .filter((header) => !header.disabled && header.key.trim() !== '')
      .map((header) => header.key.trim().toLowerCase()),
  );
  return candidates.filter((header) => !userSet.has(header.name.toLowerCase()));
}

function bodyContentType(body: Body): string | undefined {
  if (body.disabled) return undefined;
  switch (body.mode) {
    case 'none':
      return undefined;
    case 'raw':
      return RAW_CONTENT_TYPES[body.language];
  }
}

function invalid(
  kind: ExecutionError['kind'],
  message: string,
  hint?: string,
): { ok: false; error: ExecutionError } {
  return { ok: false, error: hint === undefined ? { kind, message } : { kind, message, hint } };
}
