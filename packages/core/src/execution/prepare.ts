/**
 * Request → `PreparedRequest` (docs/api-execution.md §1 steps 3–4). Pure: no I/O, no platform
 * APIs. Variables (PIGN-023), params (PIGN-008), more body modes (PIGN-009) and auth (PIGN-026)
 * plug in here.
 */

import type { PreparedBody, PreparedRequest } from '@pigeon/platform';

import type { Body, RawLanguage, Request } from '../model/request';
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

  const url = normalizeUrl(request.url.raw);
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

  addDefault(headers, 'User-Agent', `Pigeon/${PIGEON_VERSION}`);
  addDefault(headers, 'Accept', '*/*');
  if (encoded?.contentType) addDefault(headers, 'Content-Type', encoded.contentType);

  const { preferences } = ctx;
  const { settings } = request;
  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      method,
      url: url.value,
      headers,
      ...(encoded ? { body: encoded.body } : {}),
      settings: {
        timeoutMs: settings.timeoutMs ?? preferences.timeoutMs,
        followRedirects: settings.followRedirects ?? preferences.followRedirects,
        maxRedirects: settings.maxRedirects ?? preferences.maxRedirects,
        strictSSL: settings.strictSSL ?? preferences.strictSSL,
      },
      meta: { requestId: request.id, protocol: 'http', unresolved: [], secretValues: [] },
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

function encodeBody(body: Body): { body: PreparedBody; contentType?: string } | undefined {
  if (body.disabled) return undefined;
  switch (body.mode) {
    case 'none':
      return undefined;
    case 'raw':
      return {
        body: { kind: 'bytes', bytes: encoder.encode(body.raw) },
        contentType: RAW_CONTENT_TYPES[body.language],
      };
  }
}

/** Appends a header unless the user already set one with that name (case-insensitive). */
function addDefault(headers: Array<[string, string]>, name: string, value: string): void {
  const lower = name.toLowerCase();
  if (!headers.some(([existing]) => existing.toLowerCase() === lower)) headers.push([name, value]);
}

function invalid(
  kind: ExecutionError['kind'],
  message: string,
  hint?: string,
): { ok: false; error: ExecutionError } {
  return { ok: false, error: hint === undefined ? { kind, message } : { kind, message, hint } };
}
