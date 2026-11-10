import type { PreparedRequest } from '@pigeon/platform';
import { TransportError } from '@pigeon/platform';
import { describe, expect, it, vi } from 'vitest';

import { FetchTransport, isForbiddenHeader } from '../src/index';

function prepared(overrides: Partial<PreparedRequest> = {}): PreparedRequest {
  return {
    id: 'exec-1',
    method: 'GET',
    url: 'http://localhost:4010/json/user',
    headers: [],
    settings: { timeoutMs: 30_000, followRedirects: true, maxRedirects: 10, strictSSL: true },
    meta: { protocol: 'http', unresolved: [], secretValues: [] },
    ...overrides,
  };
}

const signal = () => new AbortController().signal;

function fakeFetch(response: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async () => response());
}

describe('FetchTransport', () => {
  it('calls fetch with method, headers, body and fixed options', async () => {
    const fetchFn = fakeFetch(() => new Response('ok'));
    const body = new TextEncoder().encode('hello');
    await new FetchTransport({ fetch: fetchFn }).send(
      prepared({
        method: 'POST',
        url: 'http://localhost:4010/echo',
        headers: [
          ['X-A', '1'],
          ['X-A', '2'],
          ['Content-Type', 'text/plain'],
        ],
        body: { kind: 'bytes', bytes: body },
      }),
      { signal: signal() },
    );

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:4010/echo');
    expect(init).toMatchObject({
      method: 'POST',
      body,
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
    });
    const headers = init?.headers as Headers;
    expect(headers.get('x-a')).toBe('1, 2');
    expect(headers.get('content-type')).toBe('text/plain');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns the raw response with total time and restricted headers', async () => {
    const times = [100, 142.5];
    const transport = new FetchTransport({
      fetch: fakeFetch(
        () =>
          new Response('{"id":1}', {
            status: 201,
            statusText: 'Created',
            headers: { 'Content-Type': 'application/json', 'X-B': 'b' },
          }),
      ),
      now: () => times.shift() ?? 0,
    });
    const res = await transport.send(prepared(), { signal: signal() });
    expect(res).toMatchObject({
      status: 201,
      statusText: 'Created',
      url: 'http://localhost:4010/json/user',
      redirects: [],
      headersRestricted: true,
      warnings: [],
    });
    expect(res.headers).toEqual([
      ['content-type', 'application/json'],
      ['x-b', 'b'],
    ]);
    expect(new TextDecoder().decode(res.body)).toBe('{"id":1}');
    expect(res.timings.totalMs).toBe(42.5);
    expect(res.timings.ttfbMs).toBeUndefined();
  });

  it('drops forbidden headers, including User-Agent, with a warning each', async () => {
    const fetchFn = fakeFetch(() => new Response(''));
    const res = await new FetchTransport({ fetch: fetchFn }).send(
      prepared({
        headers: [
          ['User-Agent', 'Pigeon/0.0.0'],
          ['Host', 'example.com'],
          ['Sec-Fetch-Mode', 'cors'],
          ['X-Ok', 'yes'],
        ],
      }),
      { signal: signal() },
    );
    const headers = fetchFn.mock.calls[0]?.[1]?.headers as Headers;
    expect([...headers.keys()]).toEqual(['x-ok']);
    expect(res.warnings).toEqual([
      'Header "User-Agent" was not sent: browsers do not allow setting it.',
      'Header "Host" was not sent: browsers do not allow setting it.',
      'Header "Sec-Fetch-Mode" was not sent: browsers do not allow setting it.',
    ]);
  });

  it('classifies a fetch TypeError as cors-suspected, keeping warnings', async () => {
    const transport = new FetchTransport({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    const error = await transport
      .send(prepared({ headers: [['Cookie', 'a=1']] }), { signal: signal() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({
      kind: 'cors-suspected',
      detail: 'Failed to fetch',
      warnings: ['Header "Cookie" was not sent: browsers do not allow setting it.'],
    });
    expect((error as TransportError).hint).toContain('CORS');
  });

  it('rejects with the abort reason when aborted', async () => {
    const controller = new AbortController();
    const transport = new FetchTransport({
      fetch: vi.fn<typeof fetch>(async () => {
        controller.abort(new Error('stop'));
        throw new DOMException('aborted', 'AbortError');
      }),
    });
    await expect(transport.send(prepared(), { signal: controller.signal })).rejects.toThrow('stop');
  });

  it('refuses GET with a body and forbidden methods before calling fetch', async () => {
    const fetchFn = fakeFetch(() => new Response(''));
    const transport = new FetchTransport({ fetch: fetchFn });
    await expect(
      transport.send(prepared({ body: { kind: 'bytes', bytes: new Uint8Array([1]) } }), {
        signal: signal(),
      }),
    ).rejects.toMatchObject({ kind: 'invalid-request' });
    await expect(
      transport.send(prepared({ method: 'TRACE' }), { signal: signal() }),
    ).rejects.toMatchObject({ kind: 'invalid-request' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports invalid header values as invalid-request, not CORS', async () => {
    const transport = new FetchTransport({ fetch: fakeFetch(() => new Response('')) });
    await expect(
      transport.send(prepared({ headers: [['X-Bad', 'é\u0000']] }), { signal: signal() }),
    ).rejects.toMatchObject({ kind: 'invalid-request' });
  });
});

describe('isForbiddenHeader', () => {
  it.each([
    ['Content-Length', '1', true],
    ['proxy-authorization', 'x', true],
    ['X-HTTP-Method-Override', 'trace', true],
    ['X-HTTP-Method-Override', 'PATCH', false],
    ['Authorization', 'Bearer x', false],
  ])('%s: %s → %s', (name, value, forbidden) => {
    expect(isForbiddenHeader(name, value)).toBe(forbidden);
  });
});
