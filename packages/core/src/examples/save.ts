/**
 * "Save as example" (PIGN-027, file-format.md §2.6): a live response becomes a Postman-shaped
 * example. The request half is the request *definition* (variables unresolved), volatile
 * response headers are dropped, the body is stored as received (JSON pretty-printed), and the
 * secret values the send resolved are masked in the stored headers and text body.
 */

import type { ExampleBody, ExampleBodyFormat, ProjectExample } from '@pigeon/formats';
import { beautifyJson, encodeBase64 } from '@pigeon/formats';

import type { Request } from '../model/request';
import { maskSecrets } from '../execution/mask';
import { isJsonMediaType } from '../execution/response';
import { statusText } from '../execution/status';
import type { NormalizedResponse } from '../execution/types';
import type { NewExample } from '../workspace/commands';

/**
 * Response headers not stored by default (they change on every call and make noisy diffs).
 * `Content-Length` / `Content-Encoding` describe the wire bytes, not the stored (decoded,
 * reformatted) body. Editable in preferences.
 */
export const DEFAULT_VOLATILE_HEADERS: readonly string[] = [
  'Date',
  'Age',
  'Expires',
  'ETag',
  'Last-Modified',
  'Set-Cookie',
  'X-Request-Id',
  'X-Correlation-Id',
  'X-Amzn-Trace-Id',
  'X-Amz-Request-Id',
  'X-Amz-Cf-Id',
  'CF-Ray',
  'X-Runtime',
  'X-Response-Time',
  'Server-Timing',
  'Report-To',
  'NEL',
  'Via',
  'X-Cache',
  'X-Served-By',
  'X-Timer',
  'Connection',
  'Keep-Alive',
  'Transfer-Encoding',
  'Content-Length',
  'Content-Encoding',
];

/** `200 OK`: the default example name (standard phrase when the server sent none). */
export function defaultExampleName(response: Pick<NormalizedResponse, 'status' | 'statusText'>) {
  return `${response.status} ${statusText(response.status, response.statusText)}`.trim();
}

/** The sidecar format of a text body, from the media type. */
export function exampleFormat(contentType: string | undefined): ExampleBodyFormat {
  if (contentType === undefined) return 'text';
  if (isJsonMediaType(contentType)) return 'json';
  if (
    contentType === 'application/xml' ||
    contentType === 'text/xml' ||
    contentType.endsWith('+xml')
  )
    return 'xml';
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') return 'html';
  if (contentType === 'application/javascript' || contentType === 'text/javascript')
    return 'javascript';
  return 'text';
}

/**
 * The example body: none when empty; text (JSON re-indented with 2 spaces, keys and numbers as
 * received, final newline; invalid JSON stays text as `.body.txt`); otherwise the exact bytes.
 */
export function exampleBody(
  response: Pick<NormalizedResponse, 'body' | 'bodyText' | 'contentType' | 'json'>,
  secrets: readonly string[] = [],
): ExampleBody {
  if (response.body.byteLength === 0) return { kind: 'none' };
  if (response.bodyText === undefined)
    return { kind: 'binary', base64: encodeBase64(response.body) };
  let format = exampleFormat(response.contentType);
  let text = response.bodyText;
  if (format === 'json') {
    const pretty = beautifyJson(text, '  ', response.json !== undefined);
    if (pretty === null) format = 'text';
    else text = `${pretty}\n`;
  }
  return { kind: 'text', text: maskSecrets(text, secrets), format };
}

export interface ExampleFromResponseOptions {
  id?: string;
  name?: string;
  /** Header names (any case) to leave out; `DEFAULT_VOLATILE_HEADERS` by default. */
  volatileHeaders?: readonly string[];
  /** Values to mask (the secrets the send resolved). */
  secretValues?: readonly string[];
}

/** A new example (no file key yet) for `definition`'s live `response`. */
export function exampleFromResponse(
  definition: Pick<Request, 'method' | 'url' | 'headers' | 'body' | 'auth'>,
  response: NormalizedResponse,
  options: ExampleFromResponseOptions = {},
): NewExample {
  const volatile = new Set(
    (options.volatileHeaders ?? DEFAULT_VOLATILE_HEADERS).map((name) => name.toLowerCase()),
  );
  const secrets = options.secretValues ?? [];
  const body = exampleBody(response, secrets);
  return {
    id: options.id ?? crypto.randomUUID(),
    name: options.name?.trim() || defaultExampleName(response),
    request: structuredClone({
      method: definition.method,
      url: definition.url,
      headers: definition.headers,
      body: definition.body,
      ...(definition.auth === undefined ? {} : { auth: definition.auth }),
      extra: {},
    }),
    response: {
      code: response.status,
      status: statusText(response.status, response.statusText),
      headers: response.headers
        .filter(([name]) => !volatile.has(name.toLowerCase()))
        .map(([key, value]) => ({ key, value: maskSecrets(value, secrets) })),
      cookies: [],
      body,
      ...(body.kind === 'text' ? { previewLanguage: body.format } : {}),
    },
    extra: {},
  };
}

/** Example lookup helpers for the UI. */
export type { ProjectExample };
