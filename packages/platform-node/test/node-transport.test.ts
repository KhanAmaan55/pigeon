import type { TestServer } from '@pigeon/test-server';
import { startTestServer } from '@pigeon/test-server';
import { MemoryFs, TransportError } from '@pigeon/platform';
import { transportConformance } from '@pigeon/platform/conformance';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NODE_CAPABILITIES, NodeTransport } from '../src/index';

let server: TestServer;
let tls: TestServer;
beforeAll(async () => {
  [server, tls] = await Promise.all([startTestServer(), startTestServer({ https: true })]);
});
afterAll(async () => {
  await Promise.all([server.close(), tls.close()]);
});

transportConformance(
  'NodeTransport',
  (pickedFiles) => new NodeTransport({ pickedFiles }),
  NODE_CAPABILITIES,
  { baseUrl: () => server.url },
);

const request = (url: string, settings: Partial<{ strictSSL: boolean }> = {}) => ({
  id: 'r',
  method: 'GET',
  url,
  headers: [] as Array<[string, string]>,
  settings: {
    timeoutMs: 10_000,
    followRedirects: true,
    maxRedirects: 10,
    strictSSL: true,
    ...settings,
  },
  meta: { protocol: 'http' as const, unresolved: [], secretValues: [] },
});

describe('NodeTransport (PIGN-040)', () => {
  const signal = new AbortController().signal;

  it('verifies TLS certificates unless strictSSL is off', async () => {
    const transport = new NodeTransport();
    const error = await transport.send(request(`${tls.url}/json/user`), { signal }).catch((e) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).kind).toBe('tls');
    const res = await transport.send(request(`${tls.url}/json/user`, { strictSSL: false }), {
      signal,
    });
    expect(res.status).toBe(200);
    expect(res.httpVersion).toBe('1.1');
  });

  it('reads project file references through the project file system', async () => {
    const projectFs = new MemoryFs();
    await projectFs.writeFileAtomic('fixtures/a.bin', new Uint8Array([1, 2, 3]));
    const transport = new NodeTransport({ projectFs });
    const res = await transport.send(
      {
        ...request(`${server.url}/echo`),
        method: 'POST',
        body: { kind: 'file', ref: { kind: 'project', path: 'fixtures/a.bin' } },
      },
      { signal },
    );
    expect(JSON.parse(new TextDecoder().decode(res.body)).body.size).toBe(3);
  });

  it('rejects URLs it cannot send', async () => {
    const transport = new NodeTransport();
    for (const url of ['not a url', 'ftp://example.test/']) {
      const error = await transport.send(request(url), { signal }).catch((e) => e);
      expect((error as TransportError).kind).toBe('invalid-url');
    }
  });
});
