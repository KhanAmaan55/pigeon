import type { TransportErrorKind } from '@pigeon/platform';
import { MEMORY_CAPABILITIES, MockTransport, TransportError } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import {
  classifyError,
  CORS_HINT,
  createExecutionContext,
  createRequest,
  ERROR_TITLES,
  isMixedContent,
  maskHeaders,
  maskSecrets,
  MIXED_CONTENT_HINT,
  RequestExecutor,
  SECRET_MASK,
  toExecutionError,
} from '../src/index';

const HTTPS_PAGE = 'https://pigeon.example';
const HTTP_PAGE = 'http://localhost:5173';

describe('isMixedContent', () => {
  it.each([
    [HTTPS_PAGE, 'http://api.example.com/users', true],
    [HTTPS_PAGE, 'http://10.0.0.5:8080/', true],
    [HTTPS_PAGE, 'https://api.example.com/users', false],
    [HTTPS_PAGE, 'http://localhost:4010/echo', false],
    [HTTPS_PAGE, 'http://app.localhost/echo', false],
    [HTTPS_PAGE, 'http://127.0.0.1:4010/echo', false],
    [HTTPS_PAGE, 'http://127.5.6.7/', false],
    [HTTPS_PAGE, 'http://[::1]:4010/', false],
    [HTTP_PAGE, 'http://api.example.com/users', false],
    ['tauri://localhost', 'http://api.example.com/users', false],
    [undefined, 'http://api.example.com/users', false],
    [HTTPS_PAGE, undefined, false],
    [HTTPS_PAGE, 'not a url', false],
  ] as const)('page %s → %s: %s', (page, url, expected) => {
    expect(isMixedContent(page, url)).toBe(expected);
  });
});

describe('classifyError', () => {
  /** Every kind a transport can report: what it becomes, and whether a hint is added. */
  const MATRIX: Array<[TransportErrorKind, RegExp | undefined]> = [
    ['network', /server is running/],
    ['timeout', /Settings tab/],
    ['aborted', undefined],
    ['cors-suspected', /CORS/],
    ['mixed-content', /locally/],
    ['tls', /Verify TLS certificates/],
    ['dns', /host name/],
    ['connection-refused', /Nothing is listening/],
    ['invalid-url', undefined],
    ['invalid-request', undefined],
    ['file-unavailable', undefined],
    ['unknown', undefined],
  ];

  it.each(MATRIX)('%s keeps its kind and gets the standard hint', (kind, hint) => {
    const error = classifyError({ kind, message: 'Transport says so.', detail: 'raw' });
    expect(error.kind).toBe(kind);
    expect(error.message).toBe('Transport says so.');
    expect(error.detail).toBe('raw');
    if (hint) expect(error.hint).toMatch(hint);
    else expect(error.hint).toBeUndefined();
    expect(ERROR_TITLES[kind]).toBeTruthy();
  });

  it('fills in a message when the transport gave none', () => {
    expect(classifyError({ kind: 'dns' }).message).toBe('The host name could not be resolved.');
    expect(classifyError({ kind: 'tls', message: '  ' }).message).toMatch(/TLS/);
  });

  it('keeps a transport hint over the standard one', () => {
    expect(classifyError({ kind: 'network', hint: 'Specific.' }).hint).toBe('Specific.');
  });

  it('explains CORS in three sentences and suggests the desktop app or enabling CORS', () => {
    const { hint } = classifyError({ kind: 'cors-suspected' }, { url: 'https://api.example' });
    expect(hint).toBe(CORS_HINT);
    expect(CORS_HINT.split(/(?<=\.) /)).toHaveLength(3);
    expect(CORS_HINT).toMatch(/desktop app/);
    expect(CORS_HINT).toMatch(/enable CORS/);
  });

  it('turns cors-suspected from an https page to an http URL into mixed-content', () => {
    const error = classifyError(
      { kind: 'cors-suspected', message: 'Blocked.', detail: 'Failed to fetch' },
      { url: 'http://api.example.com/users', pageOrigin: HTTPS_PAGE },
    );
    expect(error).toEqual({
      kind: 'mixed-content',
      message: 'The browser blocked an http:// request from this https:// page.',
      detail: 'Failed to fetch',
      hint: MIXED_CONTENT_HINT,
    });
    expect(MIXED_CONTENT_HINT).toMatch(/locally/);
    expect(MIXED_CONTENT_HINT).toMatch(/desktop app/);
  });

  it('keeps cors-suspected for loopback targets and http pages', () => {
    for (const ctx of [
      { url: 'http://localhost:4010/cors/none', pageOrigin: HTTPS_PAGE },
      { url: 'http://api.example.com/', pageOrigin: HTTP_PAGE },
      { url: 'http://api.example.com/' },
    ]) {
      expect(classifyError({ kind: 'cors-suspected' }, ctx).kind).toBe('cors-suspected');
    }
  });

  it('never reclassifies other kinds as mixed content', () => {
    const ctx = { url: 'http://api.example.com/', pageOrigin: HTTPS_PAGE };
    expect(classifyError({ kind: 'timeout' }, ctx).kind).toBe('timeout');
  });

  it('names the timeout that applied', () => {
    expect(classifyError({ kind: 'timeout' }, { timeoutMs: 1000 }).message).toBe(
      'The request timed out after 1 s.',
    );
    expect(classifyError({ kind: 'timeout' }, { timeoutMs: 1500 }).message).toBe(
      'The request timed out after 1500 ms.',
    );
  });
});

describe('toExecutionError', () => {
  it('is aborted whenever the signal aborted, whatever was thrown', () => {
    const controller = new AbortController();
    controller.abort();
    expect(toExecutionError(new TransportError('timeout', 'late'), controller.signal)).toEqual({
      kind: 'aborted',
      message: 'The request was cancelled.',
    });
  });

  it('classifies TransportErrors with the context', () => {
    const error = toExecutionError(new TransportError('cors-suspected', 'Blocked'), undefined, {
      url: 'http://api.example.com/',
      pageOrigin: HTTPS_PAGE,
    });
    expect(error.kind).toBe('mixed-content');
  });

  it('maps anything else to unknown with the raw text as detail', () => {
    expect(toExecutionError(new Error('boom'))).toMatchObject({ kind: 'unknown', detail: 'boom' });
  });
});

describe('RequestExecutor error classification', () => {
  const blocked = () =>
    new MockTransport().on({ url: /./ }, () => {
      throw new TransportError('cors-suspected', 'Blocked');
    });

  it('uses the page origin from the context (simulated mixed content)', async () => {
    const ctx = createExecutionContext({
      capabilities: { ...MEMORY_CAPABILITIES, transport: 'fetch' },
      pageOrigin: HTTPS_PAGE,
    });
    const result = await new RequestExecutor(blocked()).execute(
      createRequest({ url: 'http://api.example.com/users' }),
      ctx,
    );
    expect(result.error?.kind).toBe('mixed-content');
    expect(result.error?.hint).toBe(MIXED_CONTENT_HINT);
  });

  it('reports cors-suspected with the CORS hint without a page origin', async () => {
    const ctx = createExecutionContext({ capabilities: MEMORY_CAPABILITIES });
    const result = await new RequestExecutor(blocked()).execute(
      createRequest({ url: 'http://api.example.com/users' }),
      ctx,
    );
    expect(result.error).toMatchObject({ kind: 'cors-suspected', hint: CORS_HINT });
  });

  it('names the request timeout in timeout errors', async () => {
    const transport = new MockTransport().on({ url: /./ }, () => {
      throw new TransportError('timeout', 'timed out');
    });
    const ctx = createExecutionContext({ capabilities: MEMORY_CAPABILITIES });
    const result = await new RequestExecutor(transport).execute(
      createRequest({ url: 'http://localhost/delay/3000', settings: { timeoutMs: 1000 } }),
      ctx,
    );
    expect(result.error?.message).toBe('The request timed out after 1 s.');
  });
});

describe('maskSecrets', () => {
  it('masks every occurrence of every non-empty secret', () => {
    expect(maskSecrets('Bearer abc abc', ['abc', ''])).toBe(`Bearer ${SECRET_MASK} ${SECRET_MASK}`);
    expect(maskHeaders([['Authorization', 'Bearer t0k']], ['t0k'])).toEqual([
      ['Authorization', `Bearer ${SECRET_MASK}`],
    ]);
  });
});
