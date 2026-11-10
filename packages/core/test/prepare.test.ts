import type { Capabilities } from '@pigeon/platform';
import { MEMORY_CAPABILITIES } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { RequestInit } from '../src/index';
import {
  createExecutionContext,
  createRequest,
  normalizeUrl,
  PIGEON_VERSION,
  prepareRequest,
} from '../src/index';

function ctx(capabilities: Partial<Capabilities> = {}) {
  return createExecutionContext({ capabilities: { ...MEMORY_CAPABILITIES, ...capabilities } });
}

async function prepare(init: RequestInit, capabilities?: Partial<Capabilities>) {
  return prepareRequest(createRequest(init), ctx(capabilities));
}

async function prepared(init: RequestInit, capabilities?: Partial<Capabilities>) {
  const result = await prepare(init, capabilities);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('prepareRequest', () => {
  it('uppercases and trims the method', async () => {
    const request = createRequest({ url: 'http://localhost/' });
    request.method = ' patch ';
    const result = await prepareRequest(request, ctx());
    expect(result.ok && result.value.method).toBe('PATCH');
  });

  it('rejects methods that are not HTTP tokens', async () => {
    const result = await prepare({ method: 'GE T', url: 'http://localhost/' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
  });

  it('keeps the typed URL and adds http:// when no scheme was given', async () => {
    expect((await prepared({ url: ' http://localhost:4010/json/user?a=1 ' })).url).toBe(
      'http://localhost:4010/json/user?a=1',
    );
    expect((await prepared({ url: 'localhost:4010/echo' })).url).toBe('http://localhost:4010/echo');
  });

  it.each([
    ['', 'Enter a URL.'],
    ['   ', 'Enter a URL.'],
    ['http://', 'not a valid URL'],
    ['http://exa mple.com', 'not a valid URL'],
    ['ftp://example.com/file', 'Unsupported protocol'],
  ])('rejects invalid URL %j', async (url, message) => {
    const result = await prepare({ url });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-url');
      expect(result.error.message).toContain(message);
    }
  });

  it('passes enabled headers through in order, skipping disabled and blank ones', async () => {
    const { headers } = await prepared({
      url: 'http://localhost/',
      headers: [
        { key: 'X-One', value: '1' },
        { key: 'X-Off', value: 'no', disabled: true },
        { key: '  ', value: 'blank' },
        { key: 'X-Dup', value: 'a' },
        { key: 'X-Dup', value: 'b' },
      ],
    });
    expect(headers.slice(0, 3)).toEqual([
      ['X-One', '1'],
      ['X-Dup', 'a'],
      ['X-Dup', 'b'],
    ]);
  });

  it('rejects invalid header names and values', async () => {
    const badName = await prepare({ url: 'http://x/', headers: [{ key: 'Bad Name', value: '' }] });
    expect(badName).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
    const badValue = await prepare({ url: 'http://x/', headers: [{ key: 'X', value: 'a\r\nb' }] });
    expect(badValue).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
  });

  it('adds default User-Agent and Accept headers unless the user set them', async () => {
    const defaults = await prepared({ url: 'http://localhost/' });
    expect(defaults.headers).toEqual([
      ['User-Agent', `Pigeon/${PIGEON_VERSION}`],
      ['Accept', '*/*'],
    ]);
    const custom = await prepared({
      url: 'http://localhost/',
      headers: [{ key: 'accept', value: 'application/json' }],
    });
    expect(custom.headers).toEqual([
      ['accept', 'application/json'],
      ['User-Agent', `Pigeon/${PIGEON_VERSION}`],
    ]);
  });

  it('encodes a raw body as UTF-8 bytes with a default Content-Type', async () => {
    const req = await prepared({
      method: 'POST',
      url: 'http://localhost/echo',
      body: { mode: 'raw', raw: 'héllo', language: 'text' },
    });
    expect(req.body).toEqual({ kind: 'bytes', bytes: new TextEncoder().encode('héllo') });
    expect(req.headers).toContainEqual(['Content-Type', 'text/plain']);
  });

  it('keeps a user Content-Type and skips disabled bodies', async () => {
    const custom = await prepared({
      method: 'POST',
      url: 'http://localhost/echo',
      headers: [{ key: 'content-type', value: 'application/x-custom' }],
      body: { mode: 'raw', raw: '{}', language: 'json' },
    });
    expect(custom.headers.filter(([name]) => /content-type/i.test(name))).toEqual([
      ['content-type', 'application/x-custom'],
    ]);
    const disabled = await prepared({
      method: 'POST',
      url: 'http://localhost/echo',
      body: { mode: 'raw', raw: 'x', language: 'text', disabled: true },
    });
    expect(disabled.body).toBeUndefined();
  });

  it('rejects GET with a body when the platform cannot send it', async () => {
    const init: RequestInit = {
      url: 'http://localhost/',
      body: { mode: 'raw', raw: 'x', language: 'text' },
    };
    expect(await prepare(init, { canSendBodyWithGet: false })).toMatchObject({
      ok: false,
      error: { kind: 'invalid-request' },
    });
    expect((await prepare(init, { canSendBodyWithGet: true })).ok).toBe(true);
  });

  it('fills settings from preferences and links back to the request', async () => {
    const request = createRequest({ url: 'http://localhost/', settings: { timeoutMs: 5 } });
    const result = await prepareRequest(request, ctx());
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.settings).toEqual({
      timeoutMs: 5,
      followRedirects: true,
      maxRedirects: 10,
      strictSSL: true,
    });
    expect(result.value.meta).toEqual({
      requestId: request.id,
      protocol: 'http',
      unresolved: [],
      secretValues: [],
    });
  });
});

describe('normalizeUrl', () => {
  it('accepts https and mixed-case schemes', () => {
    expect(normalizeUrl('HTTPS://Example.com')).toEqual({ ok: true, value: 'HTTPS://Example.com' });
  });
});
