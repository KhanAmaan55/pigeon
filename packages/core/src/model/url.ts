/**
 * Raw URL ↔ query table ↔ path variables (docs/api-execution.md §3, PIGN-008).
 *
 * `URL` can't parse what users type (`{{baseUrl}}/users/:id?q={{term}}`), so this is a tolerant
 * splitter on `?`, `&`, `=`, `#` and `/` that never looks inside `{{…}}`. The editor keeps values
 * exactly as typed; percent-encoding happens only on send (`buildRequestUrl`).
 */

import type { KeyValue, QueryParam, Url } from './request';

export interface ParsedUrlRaw {
  /** Enabled params in `raw`, in order, values as typed (not decoded). */
  query: QueryParam[];
  /** `:name` path segments, in order, without duplicates. */
  pathVariableNames: string[];
}

export interface UrlRawParts {
  /** Scheme, host and path: everything before `?` and `#`. */
  base: string;
  /** Text after `?` (without it); `undefined` when the URL has no `?`. */
  query: string | undefined;
  /** `#` and everything after it; `undefined` when there is none. */
  hash: string | undefined;
}

const VARIABLE = /\{\{[\s\S]*?\}\}/g;
const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/**
 * `text` with every `{{…}}` replaced by `_` of the same length, so delimiters can be searched
 * in the mask and the original sliced at the same offsets.
 */
function maskVariables(text: string): string {
  return text.replace(VARIABLE, (match) => '_'.repeat(match.length));
}

/** Splits `text` on `separator` outside `{{…}}`. */
function splitOutsideVariables(text: string, separator: string): string[] {
  const mask = maskVariables(text);
  const parts: string[] = [];
  let start = 0;
  for (let i = mask.indexOf(separator); i !== -1; i = mask.indexOf(separator, start)) {
    parts.push(text.slice(start, i));
    start = i + separator.length;
  }
  parts.push(text.slice(start));
  return parts;
}

export function splitUrlRaw(raw: string): UrlRawParts {
  const mask = maskVariables(raw);
  const hashAt = mask.indexOf('#');
  const end = hashAt === -1 ? raw.length : hashAt;
  const queryAt = mask.slice(0, end).indexOf('?');
  return {
    base: raw.slice(0, queryAt === -1 ? end : queryAt),
    query: queryAt === -1 ? undefined : raw.slice(queryAt + 1, end),
    hash: hashAt === -1 ? undefined : raw.slice(hashAt),
  };
}

/**
 * Splits the base into authority (`https://host:8080`, `{{baseUrl}}`, …) and path (from the first
 * `/` after it). A port is never mistaken for a path variable.
 */
export function splitBase(base: string): { authority: string; path: string } {
  const start = SCHEME.exec(base)?.[0].length ?? 0;
  const slash = maskVariables(base).indexOf('/', start);
  if (slash === -1) return { authority: base, path: '' };
  return { authority: base.slice(0, slash), path: base.slice(slash) };
}

/** `a=1&flag&b=` → rows; empty pieces (`a=1&&b=2`, a trailing `&`) are skipped. */
export function parseQueryString(query: string): QueryParam[] {
  const params: QueryParam[] = [];
  for (const piece of splitOutsideVariables(query, '&')) {
    if (piece === '') continue;
    const equals = maskVariables(piece).indexOf('=');
    params.push(
      equals === -1
        ? { key: piece, value: '', extra: { valueNull: true } }
        : { key: piece.slice(0, equals), value: piece.slice(equals + 1) },
    );
  }
  return params;
}

function pathVariableName(segment: string): string | undefined {
  return segment.length > 1 && segment.startsWith(':') ? segment.slice(1) : undefined;
}

export function parseUrlRaw(raw: string): ParsedUrlRaw {
  const { base, query } = splitUrlRaw(raw);
  const { path } = splitBase(base);
  const names: string[] = [];
  for (const segment of splitOutsideVariables(path, '/')) {
    const name = pathVariableName(segment);
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return { query: query === undefined ? [] : parseQueryString(query), pathVariableNames: names };
}

/** Whether a row is written into `raw`: enabled and not completely empty. */
function isActiveParam(param: QueryParam): boolean {
  return !param.disabled && (param.key !== '' || param.value !== '');
}

/**
 * Escapes only what would change how `raw` splits (`&`, `#`, and `=` in keys) so a value typed in
 * the table survives the round trip; everything else is encoded on send.
 */
function escapeQueryPart(text: string, isKey: boolean): string {
  const special = isKey ? /[&#=]/ : /[&#]/;
  const mask = maskVariables(text);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? '';
    out += special.test(mask[i] ?? '') ? encodeAscii(char) : char;
  }
  return out;
}

function encodeAscii(char: string): string {
  return `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
}

function serializeParam(param: QueryParam): string {
  const key = escapeQueryPart(param.key, true);
  if (param.value === '' && param.extra?.['valueNull'] === true) return key;
  return `${key}=${escapeQueryPart(param.value, false)}`;
}

/**
 * Rewrites the query part of `raw` from the table: enabled rows in order, disabled ones left out.
 * Base and `#hash` are kept as typed; the `?` is dropped when no row is enabled.
 */
export function syncQueryIntoRaw(raw: string, query: readonly QueryParam[]): string {
  const { base, hash } = splitUrlRaw(raw);
  const search = query.filter(isActiveParam).map(serializeParam).join('&');
  return `${base}${search === '' ? '' : `?${search}`}${hash ?? ''}`;
}

/**
 * `url` after the user typed `raw`: enabled params re-read from it (disabled rows stay where they
 * were), path variables follow the `:name` segments, keeping values by name.
 */
export function syncUrlFromRaw(url: Url, raw: string): Url {
  const parsed = parseUrlRaw(raw);
  return {
    ...url,
    raw,
    query: mergeQuery(url.query, parsed.query),
    pathVariables: mergePathVariables(url.pathVariables, parsed.pathVariableNames),
  };
}

function mergeQuery(previous: readonly QueryParam[], parsed: QueryParam[]): QueryParam[] {
  const enabledBefore = previous.filter((row) => !row.disabled).length;
  // Same count = keys or values edited in place: keep each row's description by position.
  const inPlace = enabledBefore === parsed.length;
  const merged: QueryParam[] = [];
  let next = 0;
  for (const row of previous) {
    if (row.disabled) {
      merged.push(row);
      continue;
    }
    const param = parsed[next++];
    if (param === undefined) continue;
    merged.push(inPlace || row.key === param.key ? carryOver(row, param) : param);
  }
  merged.push(...parsed.slice(next));
  return merged;
}

/** `param`'s key and value with `row`'s description, type and other extras. */
function carryOver(row: QueryParam, param: QueryParam): QueryParam {
  const extra: Record<string, unknown> = { ...row.extra, ...param.extra };
  if (param.extra?.['valueNull'] === undefined) delete extra['valueNull'];
  const merged: QueryParam = { ...row, key: param.key, value: param.value };
  if (Object.keys(extra).length === 0) delete merged.extra;
  else merged.extra = extra;
  return merged;
}

function mergePathVariables(previous: readonly KeyValue[], names: string[]): KeyValue[] {
  return names.map((name, index) => {
    const byName = previous.find((row) => row.key === name);
    if (byName) return byName;
    // A renamed segment (`:i` → `:id`) keeps the value of the row it replaces.
    const atIndex = previous[index];
    if (atIndex && !names.includes(atIndex.key)) return { ...atIndex, key: name };
    return { key: name, value: '' };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Send-time encoding                                                                         */
/* ------------------------------------------------------------------------------------------ */

const PCT = /^%[\dA-Fa-f]{2}/;
// RFC 3986 pchar plus `/`.
const PATH_SAFE = /[\w.~!$&'()*+,;=:@/-]/;
// RFC 3986 query characters minus the delimiters Pigeon splits on.
const QUERY_VALUE_SAFE = /[\w.~!$'()*+,;=:@/?-]/;
const QUERY_KEY_SAFE = /[\w.~!$'()*+,;:@/?-]/;
const utf8 = new TextEncoder();

/**
 * Percent-encodes every character `safe` does not match (as UTF-8), keeping valid `%XX`
 * sequences as they are; a stray `%` becomes `%25`.
 */
export function percentEncode(text: string, safe: RegExp): string {
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '%' && PCT.test(text.slice(i, i + 3))) {
      out += text.slice(i, i + 3);
      i += 3;
      continue;
    }
    const char = String.fromCodePoint(text.codePointAt(i) ?? 0xfffd);
    i += char.length;
    if (char.length === 1 && safe.test(char)) {
      out += char;
      continue;
    }
    for (const byte of utf8.encode(char)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** Replaces `:name` segments that have a value; unknown or empty ones stay as typed. */
export function substitutePathVariables(path: string, variables: readonly KeyValue[]): string {
  return splitOutsideVariables(path, '/')
    .map((segment) => {
      const name = pathVariableName(segment);
      const value = name === undefined ? undefined : variables.find((v) => v.key === name)?.value;
      return value === undefined || value === '' ? segment : value;
    })
    .join('/');
}

/**
 * The URL to send: path variables substituted, path and query percent-encoded, `#hash` dropped.
 * Host and scheme are left for `normalizeUrl` to check.
 */
export function buildRequestUrl(url: Pick<Url, 'raw' | 'pathVariables'>): string {
  const { base, query } = splitUrlRaw(url.raw.trim());
  const { authority, path } = splitBase(base);
  const encodedPath = percentEncode(substitutePathVariables(path, url.pathVariables), PATH_SAFE);
  const search = parseQueryString(query ?? '')
    .map((param) => {
      const key = percentEncode(param.key, QUERY_KEY_SAFE);
      return param.value === '' && param.extra?.['valueNull'] === true
        ? key
        : `${key}=${percentEncode(param.value, QUERY_VALUE_SAFE)}`;
    })
    .join('&');
  return `${authority}${encodedPath}${search === '' ? '' : `?${search}`}`;
}
