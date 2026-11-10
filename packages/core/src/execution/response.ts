/** `RawResponse` → `NormalizedResponse`: content type, text decoding, JSON, size. */

import type { RawResponse } from '@pigeon/platform';

import type { NormalizedResponse } from './types';

export interface MediaType {
  /** Lowercased, without parameters, e.g. `application/json`. */
  type: string;
  /** Lowercased `charset` parameter, unquoted. */
  charset?: string;
}

/** Parses a `Content-Type` header value; `undefined` when empty. */
export function parseMediaType(value: string | undefined): MediaType | undefined {
  if (value === undefined) return undefined;
  const [rawType = '', ...params] = value.split(';');
  const type = rawType.trim().toLowerCase();
  if (type === '') return undefined;
  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq === -1 || param.slice(0, eq).trim().toLowerCase() !== 'charset') continue;
    const charset = param
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .toLowerCase();
    if (charset !== '') return { type, charset };
  }
  return { type };
}

export function isJsonMediaType(type: string): boolean {
  return type === 'application/json' || type === 'text/json' || type.endsWith('+json');
}

function isTextualMediaType(type: string): boolean {
  return (
    type.startsWith('text/') ||
    isJsonMediaType(type) ||
    type.endsWith('+xml') ||
    [
      'application/xml',
      'application/javascript',
      'application/ecmascript',
      'application/x-www-form-urlencoded',
      'application/graphql',
      'application/x-ndjson',
      'application/yaml',
      'application/x-yaml',
    ].includes(type)
  );
}

function headerValue(headers: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([key]) => key.toLowerCase() === lower)?.[1];
}

/** Decodes with `label`, falling back to UTF-8 for labels the runtime doesn't know. */
function decode(bytes: Uint8Array, label: string): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label);
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(bytes);
}

/** Text when `bytes` are valid UTF-8, otherwise `undefined` (treated as binary). */
function decodeIfUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function normalizeResponse(raw: RawResponse): NormalizedResponse {
  const media = parseMediaType(headerValue(raw.headers, 'content-type'));
  let bodyText: string | undefined;
  if (media && isTextualMediaType(media.type)) {
    bodyText = decode(raw.body, media.charset ?? 'utf-8');
  } else if (media?.charset) {
    bodyText = decode(raw.body, media.charset);
  } else {
    // Unknown or missing type: show it as text when it is valid UTF-8.
    bodyText = decodeIfUtf8(raw.body);
  }

  let json: unknown;
  let hasJson = false;
  if (media && isJsonMediaType(media.type) && bodyText !== undefined && bodyText.trim() !== '') {
    try {
      json = JSON.parse(bodyText);
      hasJson = true;
    } catch {
      // Invalid JSON stays text; the viewer shows it raw.
    }
  }

  return {
    ...raw,
    ...(media ? { contentType: media.type } : {}),
    ...(bodyText === undefined ? {} : { bodyText }),
    ...(hasJson ? { json } : {}),
    sizeBytes: raw.body.byteLength,
  };
}
