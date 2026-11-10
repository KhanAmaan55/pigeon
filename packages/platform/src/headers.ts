/**
 * Request headers and methods browsers refuse to send (Fetch spec "forbidden request-header" and
 * "forbidden method"). FetchTransport drops these headers; the header editor flags them when
 * `!capabilities.canSetAnyHeader` (docs/platform.md §6).
 */

const FORBIDDEN_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  // No longer forbidden by the spec, but Chromium still drops it silently.
  'user-agent',
]);
const FORBIDDEN_PREFIXES = ['proxy-', 'sec-'];
const METHOD_OVERRIDE_HEADERS = new Set([
  'x-http-method',
  'x-http-method-override',
  'x-method-override',
]);
const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK']);

/** Whether browsers refuse to send `method` (uppercase). */
export function isForbiddenMethod(method: string): boolean {
  return FORBIDDEN_METHODS.has(method);
}

/** Whether browsers refuse to send this header (method overrides depend on the value). */
export function isForbiddenHeader(name: string, value: string): boolean {
  const lower = name.trim().toLowerCase();
  if (FORBIDDEN_HEADERS.has(lower)) return true;
  if (FORBIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  return (
    METHOD_OVERRIDE_HEADERS.has(lower) &&
    value.split(',').some((method) => isForbiddenMethod(method.trim().toUpperCase()))
  );
}
