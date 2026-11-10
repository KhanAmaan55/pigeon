/**
 * Request → `PreparedRequest` (docs/api-execution.md §1 steps 3–4). Pure: no I/O, no platform
 * APIs (files are referenced, the transport reads them). Variables (PIGN-023) and auth
 * (PIGN-026) plug in here.
 */

import type { Capabilities, PreparedRequest } from '@pigeon/platform';

import type { Request } from '../model/request';
import { buildRequestUrl } from '../model/url';
import { PIGEON_VERSION } from '../version';
import type { EncodedBody } from './body';
import { encodeBody } from './body';
import type { ExecutionContext, ExecutionError, Result } from './types';
import { prunesBody, validateBody } from './validate';

/** RFC 9110 `token`: valid method and header names. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Header values may not contain CR, LF or NUL. */
const INVALID_HEADER_VALUE = /[\r\n\0]/;
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

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

  const encoding = encodeBody(request.body);
  const checked = validateBody(method, encoding.encoded, request.settings, ctx.capabilities);
  if (!checked.ok) return checked;
  const { encoded } = checked.value;
  const warnings = [...encoding.warnings, ...checked.value.warnings];

  for (const header of autoHeadersFor(request.headers, encoded, ctx.capabilities)) {
    if (!header.preview) headers.push([header.name, header.value]);
  }

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
      meta: {
        requestId: request.id,
        ...(ctx.projectId === null ? {} : { projectId: ctx.projectId }),
        protocol: 'http',
        unresolved: [],
        secretValues: [],
        ...(warnings.length > 0 ? { warnings } : {}),
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

/** A header Pigeon adds unless the user set one with the same name (docs/api-execution.md §1). */
export interface AutoHeader {
  name: string;
  value: string;
  /** Why it is added, for the headers tab. */
  reason: string;
  /** Shown in the headers tab only; the transport sets the real value (multipart boundary). */
  preview?: boolean;
}

/** Shown for form-data bodies; the transport sets the real boundary. */
export const MULTIPART_CONTENT_TYPE_PREVIEW =
  'multipart/form-data; boundary=<calculated when the request is sent>';

/**
 * Headers `prepareRequest` appends after the user's enabled headers, skipping any name the user
 * set (case-insensitive). `User-Agent` only where the transport can set it: browsers send their
 * own and would drop Pigeon's with a warning on every request. `Content-Type` only when a body is
 * sent (a GET body Pigeon drops has none); for form-data it is a `preview` entry, set by the
 * transport.
 */
export function autoHeaders(
  request: Pick<Request, 'headers' | 'body'> & Partial<Pick<Request, 'method' | 'settings'>>,
  capabilities: Pick<Capabilities, 'canSetAnyHeader'> &
    Partial<Pick<Capabilities, 'canSendBodyWithGet'>>,
): AutoHeader[] {
  const method = request.method?.trim().toUpperCase();
  let { encoded } = encodeBody(request.body);
  if (
    encoded &&
    method !== undefined &&
    prunesBody(method) &&
    capabilities.canSendBodyWithGet &&
    !request.settings?.disableBodyPruning
  ) {
    encoded = undefined;
  }
  return autoHeadersFor(request.headers, encoded, capabilities);
}

function autoHeadersFor(
  userHeaders: Request['headers'],
  encoded: EncodedBody | undefined,
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
  if (encoded?.contentType !== undefined) {
    candidates.push({
      name: 'Content-Type',
      value: encoded.contentType,
      reason: 'From the body type.',
    });
  } else if (encoded?.body.kind === 'multipart') {
    candidates.push({
      name: 'Content-Type',
      value: MULTIPART_CONTENT_TYPE_PREVIEW,
      reason: 'Set when the request is sent, with the multipart boundary.',
      preview: true,
    });
  }
  const userSet = new Set(
    userHeaders
      .filter((header) => !header.disabled && header.key.trim() !== '')
      .map((header) => header.key.trim().toLowerCase()),
  );
  return candidates.filter((header) => !userSet.has(header.name.toLowerCase()));
}

function invalid(
  kind: ExecutionError['kind'],
  message: string,
  hint?: string,
): { ok: false; error: ExecutionError } {
  return { ok: false, error: hint === undefined ? { kind, message } : { kind, message, hint } };
}
