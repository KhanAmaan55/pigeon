import { describe, expect, it } from 'vitest';

import type { PreparedRequest } from '../src/index';
import { MockTransport } from '../src/index';

function request(overrides: Partial<PreparedRequest> = {}): PreparedRequest {
  return {
    id: 'exec-1',
    method: 'GET',
    url: 'https://api.example.test/users',
    headers: [],
    settings: { timeoutMs: 30_000, followRedirects: true, maxRedirects: 10, strictSSL: true },
    meta: { protocol: 'http', unresolved: [], secretValues: [] },
    ...overrides,
  };
}

const send = (transport: MockTransport, req = request(), signal = new AbortController().signal) =>
  transport.send(req, { signal });

describe('MockTransport', () => {
  it('answers a fixed response and fills defaults', async () => {
    const transport = new MockTransport().on(
      { method: 'get', url: 'https://api.example.test/users' },
      { body: '[]', headers: [['content-type', 'application/json']] },
    );

    const response = await send(transport);
    expect(response).toMatchObject({
      status: 200,
      statusText: '',
      headers: [['content-type', 'application/json']],
      url: 'https://api.example.test/users',
      redirects: [],
      headersRestricted: false,
    });
    expect(new TextDecoder().decode(response.body)).toBe('[]');
    expect(response.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(transport.requests).toHaveLength(1);
  });

  it('uses the first matching route, by method, URL regex or predicate', async () => {
    const transport = new MockTransport()
      .on({ method: 'POST', url: /\/users$/ }, { status: 201 })
      .on({ url: /\/users$/ }, { status: 200 })
      .on((req) => req.headers.some(([name]) => name === 'x-fail'), { status: 500 });

    expect((await send(transport, request({ method: 'POST' }))).status).toBe(201);
    expect((await send(transport)).status).toBe(200);
    const flagged = request({ url: 'https://other.test/', headers: [['x-fail', '1']] });
    expect((await send(transport, flagged)).status).toBe(500);
  });

  it('passes the request to handlers and propagates their errors', async () => {
    const transport = new MockTransport()
      .on({ url: /echo/ }, (req) => ({ body: `${req.method} ${req.url}` }))
      .on({ url: /down/ }, () => {
        throw new TypeError('Failed to fetch');
      });

    const echoed = await send(transport, request({ url: 'https://x.test/echo' }));
    expect(new TextDecoder().decode(echoed.body)).toBe('GET https://x.test/echo');
    await expect(send(transport, request({ url: 'https://x.test/down' }))).rejects.toThrow(
      'Failed to fetch',
    );
  });

  it('rejects unmatched requests', async () => {
    await expect(send(new MockTransport())).rejects.toThrow(
      'MockTransport: no route for GET https://api.example.test/users',
    );
  });

  it('rejects with the abort reason while a handler is pending', async () => {
    const transport = new MockTransport().on({ url: /users/ }, () => new Promise(() => {}));
    const controller = new AbortController();
    const pending = send(transport, request(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately when already aborted, without recording the request', async () => {
    const transport = new MockTransport().on({ url: /users/ }, { status: 200 });
    await expect(send(transport, request(), AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(transport.requests).toEqual([]);
  });
});
