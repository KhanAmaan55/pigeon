import type { FileRef, PreparedRequest } from '@pigeon/platform';
import { PickedFileStore, TransportError } from '@pigeon/platform';
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

describe('FetchTransport bodies', () => {
  const ok = () => fakeFetch(() => new Response('ok'));
  const post = (body: PreparedRequest['body'], headers: Array<[string, string]> = []) =>
    prepared({
      method: 'POST',
      url: 'http://localhost:4010/echo',
      headers,
      ...(body ? { body } : {}),
    });

  it('sends multipart bodies as FormData and lets the browser set the Content-Type', async () => {
    const pickedFiles = new PickedFileStore();
    const png = pickedFiles.add({ name: 'a.png', bytes: new Uint8Array([1, 2, 3]) });
    const fetchFn = ok();
    const res = await new FetchTransport({ fetch: fetchFn, pickedFiles }).send(
      post(
        {
          kind: 'multipart',
          parts: [
            { name: 'name', kind: 'text', value: 'Ada' },
            { name: 'pic', kind: 'file', file: png, filename: 'a.png', contentType: 'image/png' },
          ],
        },
        [['Content-Type', 'multipart/form-data']],
      ),
      { signal: signal() },
    );
    const init = fetchFn.mock.calls[0]?.[1];
    expect((init?.headers as Headers).has('content-type')).toBe(false);
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('name')).toBe('Ada');
    const pic = form.get('pic') as File;
    expect([pic.name, pic.type, pic.size]).toEqual(['a.png', 'image/png', 3]);
    expect(new Uint8Array(await pic.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(res.warnings).toEqual([]);
  });

  it('warns about multipart Content-Types and text part types the browser replaces', async () => {
    const res = await new FetchTransport({ fetch: ok() }).send(
      post(
        {
          kind: 'multipart',
          parts: [{ name: 'meta', kind: 'text', value: '{}', contentType: 'application/json' }],
        },
        [['content-type', 'multipart/mixed; boundary=x']],
      ),
      { signal: signal() },
    );
    expect(res.warnings).toEqual([
      'Header "content-type: multipart/mixed; boundary=x" was replaced by multipart/form-data: browsers set the Content-Type of form-data bodies.',
      'The content type of form field "meta" was not sent: browsers send text fields without one.',
    ]);
  });

  it('sends picked binary files as a Blob, keeping the prepared Content-Type', async () => {
    const pickedFiles = new PickedFileStore();
    const ref = pickedFiles.add({ name: 'x.bin', bytes: new Uint8Array([0, 255, 7]) });
    const fetchFn = ok();
    await new FetchTransport({ fetch: fetchFn, pickedFiles }).send(
      post({ kind: 'file', ref }, [['Content-Type', 'application/octet-stream']]),
      { signal: signal() },
    );
    const init = fetchFn.mock.calls[0]?.[1];
    const blob = init?.body as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 255, 7]));
    expect((init?.headers as Headers).get('content-type')).toBe('application/octet-stream');
  });

  it.each<[string, FileRef]>([
    ['a picked file that is gone', { kind: 'picked', id: 'missing' }],
    ['an absolute path', { kind: 'absolute', path: '/etc/hosts' }],
    ['a project file', { kind: 'project', path: 'files/a.png' }],
  ])('fails %s as file-unavailable without fetching', async (_, ref) => {
    const fetchFn = ok();
    const transport = new FetchTransport({ fetch: fetchFn, pickedFiles: new PickedFileStore() });
    for (const body of [
      { kind: 'file', ref },
      { kind: 'multipart', parts: [{ name: 'f', kind: 'file', file: ref, filename: 'a.png' }] },
    ] satisfies PreparedRequest['body'][]) {
      const error = await transport.send(post(body), { signal: signal() }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TransportError);
      expect(error).toMatchObject({ kind: 'file-unavailable' });
    }
    expect(fetchFn).not.toHaveBeenCalled();
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
