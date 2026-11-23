import type { PreparedRequest, ProxyRequestEnvelope } from '@pigeon/platform';
import { PickedFileStore, PROXY_TOKEN_HEADER, TransportError } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import {
  detectWebCapabilities,
  fromBase64,
  ProxyTransport,
  proxyModeCapabilities,
  toBase64,
  WebCorsProxy,
} from '../src/index';

const CONFIG = { url: 'http://127.0.0.1:8787/', token: 't0k' };

function prepared(overrides: Partial<PreparedRequest> = {}): PreparedRequest {
  return {
    id: 'r1',
    method: 'POST',
    url: 'http://api.test/x',
    headers: [
      ['Cookie', 'a=1'],
      ['X-Dup', '1'],
      ['X-Dup', '2'],
    ],
    body: { kind: 'bytes', bytes: new Uint8Array([0, 255]) },
    settings: { timeoutMs: 1000, followRedirects: false, maxRedirects: 3, strictSSL: false },
    meta: { protocol: 'http', unresolved: [], secretValues: [] },
    ...overrides,
  };
}

describe('ProxyTransport (PIGN-052)', () => {
  it('posts the request as a JSON envelope with the token and decodes the reply', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const transport = new ProxyTransport({
      config: () => CONFIG,
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init! });
        return Response.json({
          ok: true,
          status: 201,
          statusText: 'Created',
          headers: [
            ['set-cookie', 's=1'],
            ['x-hidden', 'yes'],
          ],
          base64: toBase64(new TextEncoder().encode('done')),
          url: 'http://api.test/x',
          redirects: [],
          timings: { totalMs: 12 },
        });
      },
    });
    const raw = await transport.send(prepared(), { signal: new AbortController().signal });
    expect(seen[0]!.url).toBe('http://127.0.0.1:8787/v1/forward');
    expect((seen[0]!.init.headers as Record<string, string>)[PROXY_TOKEN_HEADER]).toBe('t0k');
    const envelope = JSON.parse(seen[0]!.init.body as string) as ProxyRequestEnvelope;
    expect(envelope).toMatchObject({
      method: 'POST',
      headers: [
        ['Cookie', 'a=1'],
        ['X-Dup', '1'],
        ['X-Dup', '2'],
      ],
      body: { kind: 'bytes', base64: 'AP8=' },
      settings: { followRedirects: false, strictSSL: false },
    });
    expect(raw).toMatchObject({ status: 201, headersRestricted: false });
    expect(raw.headers).toContainEqual(['set-cookie', 's=1']);
    expect(new TextDecoder().decode(raw.body)).toBe('done');
  });

  it('reads picked files into multipart parts', async () => {
    const files = new PickedFileStore();
    const ref = files.add({ name: 'a.txt', bytes: new TextEncoder().encode('hi') });
    let envelope: ProxyRequestEnvelope | undefined;
    const transport = new ProxyTransport({
      config: () => CONFIG,
      pickedFiles: files,
      fetch: async (_url, init) => {
        envelope = JSON.parse(init!.body as string) as ProxyRequestEnvelope;
        return Response.json({ ok: false, error: { kind: 'timeout', message: 'slow' } });
      },
    });
    const sent = transport.send(
      prepared({
        body: {
          kind: 'multipart',
          parts: [{ name: 'doc', kind: 'file', file: ref, filename: 'a.txt' }],
        },
      }),
      { signal: new AbortController().signal },
    );
    await expect(sent).rejects.toMatchObject({ kind: 'timeout', message: 'slow' });
    expect(envelope?.body).toEqual({
      kind: 'multipart',
      parts: [{ name: 'doc', kind: 'file', filename: 'a.txt', base64: 'aGk=' }],
    });
  });

  it('explains an unreachable proxy and a rejected token', async () => {
    const down = new ProxyTransport({
      config: () => CONFIG,
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(
      down.send(prepared(), { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(TransportError);
    const rejected = new ProxyTransport({
      config: () => CONFIG,
      fetch: async () => new Response('Missing or wrong proxy token.', { status: 401 }),
    });
    await expect(
      rejected.send(prepared(), { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ message: 'The CORS proxy rejected the token.' });
  });

  it('proxy mode capabilities; the control notifies on change only', () => {
    const web = detectWebCapabilities({ indexedDB: {} });
    expect(proxyModeCapabilities(web)).toMatchObject({
      transport: 'proxy',
      bypassesCors: true,
      canSetAnyHeader: true,
      canReadAllResponseHeaders: true,
      projectFolders: web.projectFolders,
    });
    const control = new WebCorsProxy();
    let changes = 0;
    control.subscribe(() => (changes += 1));
    control.use(CONFIG);
    control.use({ ...CONFIG });
    control.use({ url: ' ', token: 'x' });
    expect(control.config).toBeNull();
    expect(changes).toBe(2);
    expect(fromBase64(toBase64(new Uint8Array([1, 2, 3])))).toEqual(new Uint8Array([1, 2, 3]));
  });
});
