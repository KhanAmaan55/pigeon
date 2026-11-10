import type { RawResponse } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import { normalizeResponse, parseMediaType } from '../src/index';

function raw(headers: Array<[string, string]>, body: Uint8Array | string): RawResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers,
    body: typeof body === 'string' ? new TextEncoder().encode(body) : body,
    url: 'http://localhost/',
    redirects: [],
    timings: { startedAt: 0, totalMs: 1 },
    headersRestricted: false,
  };
}

describe('parseMediaType', () => {
  it.each([
    ['application/json', { type: 'application/json' }],
    ['Text/HTML; Charset="ISO-8859-1"', { type: 'text/html', charset: 'iso-8859-1' }],
    ['text/plain;foo=bar; charset=utf-8', { type: 'text/plain', charset: 'utf-8' }],
    ['', undefined],
    [undefined, undefined],
  ])('%j', (value, expected) => {
    expect(parseMediaType(value)).toEqual(expected);
  });
});

describe('normalizeResponse', () => {
  it('parses JSON and reports the size in bytes', () => {
    const body = '{"name":"Ada","emoji":"🐦"}';
    const res = normalizeResponse(raw([['Content-Type', 'application/json; charset=utf-8']], body));
    expect(res.contentType).toBe('application/json');
    expect(res.bodyText).toBe(body);
    expect(res.json).toEqual({ name: 'Ada', emoji: '🐦' });
    expect(res.sizeBytes).toBe(new TextEncoder().encode(body).byteLength);
    expect(res.sizeBytes).toBeGreaterThan(body.length);
  });

  it('detects +json media types', () => {
    const res = normalizeResponse(raw([['content-type', 'application/problem+json']], '{"a":1}'));
    expect(res.json).toEqual({ a: 1 });
  });

  it('keeps invalid JSON as text without json', () => {
    const res = normalizeResponse(raw([['content-type', 'application/json']], '{oops'));
    expect(res.bodyText).toBe('{oops');
    expect('json' in res).toBe(false);
  });

  it('does not parse JSON-looking text of other types', () => {
    const res = normalizeResponse(raw([['content-type', 'text/plain']], '{"a":1}'));
    expect('json' in res).toBe(false);
  });

  it('decodes using the charset from Content-Type', () => {
    // "café" in ISO-8859-1: é is the single byte 0xE9.
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    const res = normalizeResponse(raw([['Content-Type', 'text/plain; charset=iso-8859-1']], bytes));
    expect(res.bodyText).toBe('café');
  });

  it('falls back to UTF-8 for unknown charsets', () => {
    const res = normalizeResponse(raw([['content-type', 'text/plain; charset=nope']], 'héllo'));
    expect(res.bodyText).toBe('héllo');
  });

  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')]);
    const res = normalizeResponse(raw([['content-type', 'application/json']], bytes));
    expect(res.json).toEqual({ a: 1 });
  });

  it('treats non-UTF-8 bytes of unknown type as binary', () => {
    const res = normalizeResponse(
      raw([['content-type', 'image/png']], new Uint8Array([0x89, 0xff])),
    );
    expect(res.bodyText).toBeUndefined();
    expect(res.sizeBytes).toBe(2);
  });

  it('shows valid UTF-8 without a Content-Type as text', () => {
    const res = normalizeResponse(raw([], 'plain'));
    expect(res.contentType).toBeUndefined();
    expect(res.bodyText).toBe('plain');
  });

  it('keeps the raw response fields', () => {
    const res = normalizeResponse(raw([['X-A', '1']], ''));
    expect(res).toMatchObject({ status: 200, statusText: 'OK', headers: [['X-A', '1']] });
    expect(res.sizeBytes).toBe(0);
    expect('json' in res).toBe(false);
  });
});
