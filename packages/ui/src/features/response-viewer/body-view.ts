/**
 * What the response body viewer shows for a response (docs/ui-ux.md §3.5): which views exist,
 * which one opens first, and the large-body thresholds. Pure, so it is unit tested directly.
 */

import type { NormalizedResponse } from '@pigeon/core';
import { isJsonMediaType } from '@pigeon/core';

const MIB = 1024 * 1024;

/** Larger bodies open in Raw; Pretty needs "Format anyway". */
export const PRETTY_LIMIT = 2 * MIB;
/** Larger bodies show only their first `TRUNCATED_BYTES` until "Show all". */
export const DISPLAY_LIMIT = 20 * MIB;
export const TRUNCATED_BYTES = 2 * MIB;

export type BodyMode = 'pretty' | 'raw' | 'preview';
export type BodyLanguage = 'json' | 'xml' | 'html' | 'javascript' | 'text';

export interface BodyInfo {
  kind: 'empty' | 'text' | 'binary';
  language: BodyLanguage;
  preview?: 'html' | 'image';
  /** Views offered, in tab order; empty for binary bodies without a preview. */
  modes: BodyMode[];
  defaultMode: BodyMode | undefined;
  /** Over `PRETTY_LIMIT`. */
  large: boolean;
  /** Over `DISPLAY_LIMIT`. */
  huge: boolean;
}

type BodyFacts = Pick<NormalizedResponse, 'sizeBytes' | 'contentType' | 'bodyText' | 'json'>;

export function bodyLanguage(contentType: string | undefined, bodyText?: string): BodyLanguage {
  const type = contentType ?? '';
  if (isJsonMediaType(type)) return 'json';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'application/xml' || type === 'text/xml' || type.endsWith('+xml')) return 'xml';
  if (/^(application|text)\/(javascript|ecmascript|x-javascript)$/.test(type)) {
    return 'javascript';
  }
  if (contentType === undefined && bodyText !== undefined) {
    // No Content-Type: sniff the obvious cases; the formatter falls back to the text as is.
    const start = bodyText.trimStart().slice(0, 1);
    if (start === '{' || start === '[') return 'json';
    if (start === '<') return /^\s*<!doctype html|^\s*<html/i.test(bodyText) ? 'html' : 'xml';
  }
  return 'text';
}

export function describeBody(response: BodyFacts): BodyInfo {
  const large = response.sizeBytes > PRETTY_LIMIT;
  const huge = response.sizeBytes > DISPLAY_LIMIT;
  const language = bodyLanguage(response.contentType, response.bodyText);
  const image = response.contentType?.startsWith('image/') === true;
  const base = { language, large, huge };

  if (response.sizeBytes === 0) {
    return { ...base, kind: 'empty', modes: [], defaultMode: undefined };
  }
  if (response.bodyText === undefined) {
    return image
      ? { ...base, kind: 'binary', preview: 'image', modes: ['preview'], defaultMode: 'preview' }
      : { ...base, kind: 'binary', modes: [], defaultMode: undefined };
  }

  const preview = image ? 'image' : language === 'html' ? 'html' : undefined;
  const modes: BodyMode[] = [];
  if (language !== 'text') modes.push('pretty');
  modes.push('raw');
  if (preview) modes.push('preview');
  const defaultMode: BodyMode =
    preview === 'image' ? 'preview' : modes.includes('pretty') && !large ? 'pretty' : 'raw';
  return { ...base, kind: 'text', ...(preview ? { preview } : {}), modes, defaultMode };
}

/**
 * The first `limit` UTF-16 code units of `text` (about `limit` bytes for mostly-ASCII bodies),
 * never splitting a surrogate pair, and whether anything was cut.
 */
export function truncateText(
  text: string,
  limit = TRUNCATED_BYTES,
): { text: string; cut: boolean } {
  if (text.length <= limit) return { text, cut: false };
  let end = limit;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return { text: text.slice(0, end), cut: true };
}

const EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/css': 'css',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/octet-stream': 'bin',
};

/** Characters no OS accepts in a file name, plus control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * A file name for "Save body": the `Content-Disposition` file name (RFC 6266 `filename*` first),
 * else the URL's last path segment, else `response`; with an extension from the media type
 * when it has none.
 */
export function suggestFileName(
  response: Pick<NormalizedResponse, 'headers' | 'contentType' | 'url'>,
): string {
  const ext = extensionFor(response.contentType);
  const fromHeader = dispositionFileName(
    response.headers.find(([name]) => name.toLowerCase() === 'content-disposition')?.[1],
  );
  let name = fromHeader ?? lastPathSegment(response.url) ?? 'response';
  name = name.replace(UNSAFE, '_').trim().replace(/^\.+/, '');
  if (name === '') name = 'response';
  if (fromHeader === undefined && !/\.[A-Za-z0-9]{1,8}$/.test(name) && ext) name += `.${ext}`;
  return name;
}

function extensionFor(contentType: string | undefined): string | undefined {
  if (contentType === undefined) return undefined;
  if (EXTENSIONS[contentType]) return EXTENSIONS[contentType];
  if (contentType.endsWith('+json')) return 'json';
  if (contentType.endsWith('+xml')) return 'xml';
  if (contentType.startsWith('text/')) return 'txt';
  return undefined;
}

function dispositionFileName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(value);
  if (extended) {
    try {
      const decoded = decodeURIComponent(extended[2]!.trim());
      if (decoded !== '') return decoded;
    } catch {
      // Malformed percent-encoding: fall back to `filename`.
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(value);
  const name = plain?.[1]?.replace(/\\(.)/g, '$1') ?? plain?.[2]?.trim();
  return name === undefined || name === '' ? undefined : name;
}

function lastPathSegment(url: string): string | undefined {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
    return segment === undefined ? undefined : decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** `hexdump -C` style lines for the first `limit` bytes. */
export function hexDump(bytes: Uint8Array, limit = 256): string[] {
  const lines: string[] = [];
  const end = Math.min(bytes.byteLength, limit);
  for (let offset = 0; offset < end; offset += 16) {
    const row = bytes.subarray(offset, Math.min(offset + 16, end));
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0'));
    const left = hex.slice(0, 8).join(' ');
    const right = hex.slice(8).join(' ');
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'));
    lines.push(
      `${offset.toString(16).padStart(8, '0')}  ${left.padEnd(23)}  ${right.padEnd(23)}  |${ascii.join('')}|`,
    );
  }
  return lines;
}
