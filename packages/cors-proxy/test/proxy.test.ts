import { request } from 'node:http';

import type { ProxyRequestEnvelope, ProxyResponseEnvelope } from '@pigeon/platform';
import { PROXY_TOKEN_HEADER } from '@pigeon/platform';
import type { TestServer } from '@pigeon/test-server';
import { startTestServer } from '@pigeon/test-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RunningProxy } from '../src/index';
import { DEFAULT_PROXY_HOST, startProxy } from '../src/index';

const ORIGIN = 'http://localhost:4173';
let target: TestServer;
let proxy: RunningProxy;
const logs: string[] = [];

beforeAll(async () => {
  target = await startTestServer({ port: 0 });
  proxy = await startProxy({ port: 0, log: (line) => logs.push(line) });
});
afterAll(async () => {
  await proxy.close();
  await target.close();
});

/** A raw HTTP call to the proxy (Node's fetch would refuse to set Origin itself). */
function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
  const url = new URL(path, proxy.url);
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const envelope = (overrides: Partial<ProxyRequestEnvelope> = {}): ProxyRequestEnvelope => ({
  method: 'GET',
  url: `${target.url}/cors/none`,
  headers: [],
  settings: { timeoutMs: 5000, followRedirects: true, maxRedirects: 5, strictSSL: true },
  ...overrides,
});

async function forward(env: ProxyRequestEnvelope): Promise<ProxyResponseEnvelope> {
  const res = await call(
    'POST',
    '/v1/forward',
    { origin: ORIGIN, 'content-type': 'application/json', [PROXY_TOKEN_HEADER]: proxy.token },
    JSON.stringify(env),
  );
  expect(res.status).toBe(200);
  expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  return JSON.parse(res.text) as ProxyResponseEnvelope;
}

describe('CORS proxy (PIGN-052)', () => {
  it('binds to 127.0.0.1 with a random token by default', () => {
    expect(DEFAULT_PROXY_HOST).toBe('127.0.0.1');
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(proxy.token.length).toBeGreaterThanOrEqual(32);
  });

  it('answers the preflight for allowed origins only', async () => {
    const ok = await call('OPTIONS', '/v1/forward', {
      origin: ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': `content-type, ${PROXY_TOKEN_HEADER}`,
    });
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-headers']).toContain(PROXY_TOKEN_HEADER);
    const evil = await call('OPTIONS', '/v1/forward', { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a missing or wrong token, a foreign origin, and no origin', async () => {
    const body = JSON.stringify(envelope());
    const json = { 'content-type': 'application/json' };
    expect((await call('POST', '/v1/forward', { origin: ORIGIN, ...json }, body)).status).toBe(401);
    expect(
      (
        await call(
          'POST',
          '/v1/forward',
          { origin: ORIGIN, ...json, [PROXY_TOKEN_HEADER]: `${proxy.token}x` },
          body,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          'POST',
          '/v1/forward',
          { origin: 'http://localhost:9999', ...json, [PROXY_TOKEN_HEADER]: proxy.token },
          body,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call('POST', '/v1/forward', { ...json, [PROXY_TOKEN_HEADER]: proxy.token }, body))
        .status,
    ).toBe(403);
    const health = await call('GET', '/v1/health', {
      origin: ORIGIN,
      [PROXY_TOKEN_HEADER]: proxy.token,
    });
    expect(health.status).toBe(200);
  });

  it('forwards to an API without CORS and returns every header', async () => {
    const reply = await forward(envelope());
    if (!reply.ok) throw new Error(reply.error.message);
    expect(reply.status).toBe(200);
    expect(JSON.parse(Buffer.from(reply.base64, 'base64').toString())).toMatchObject({
      cors: 'none',
    });
    expect(reply.headers.some(([name]) => name.toLowerCase() === 'content-type')).toBe(true);
  });

  it('sends forbidden headers and bodies as given; Set-Cookie comes back', async () => {
    const reply = await forward(
      envelope({
        method: 'POST',
        url: `${target.url}/echo`,
        headers: [
          ['Cookie', 'a=1'],
          ['Origin', 'https://spoofed.example'],
          ['Content-Type', 'application/octet-stream'],
        ],
        body: { kind: 'bytes', base64: Buffer.from([0, 1, 2, 255]).toString('base64') },
      }),
    );
    if (!reply.ok) throw new Error(reply.error.message);
    const echo = JSON.parse(Buffer.from(reply.base64, 'base64').toString()) as {
      headers: Record<string, string>;
      body: unknown;
    };
    expect(echo.headers['cookie']).toBe('a=1');
    expect(echo.headers['origin']).toBe('https://spoofed.example');
    expect(echo.headers['content-length']).toBe('4');

    const cookies = await forward(envelope({ url: `${target.url}/cookies/set?session=abc` }));
    if (!cookies.ok) throw new Error(cookies.error.message);
    expect(cookies.headers.some(([n]) => n.toLowerCase() === 'set-cookie')).toBe(true);
  });

  it('multipart parts, including files, reach the target', async () => {
    const reply = await forward(
      envelope({
        method: 'POST',
        url: `${target.url}/echo`,
        body: {
          kind: 'multipart',
          parts: [
            { name: 'title', kind: 'text', value: 'Hi' },
            {
              name: 'doc',
              kind: 'file',
              filename: 'a.txt',
              contentType: 'text/plain',
              base64: Buffer.from('file text').toString('base64'),
            },
          ],
        },
      }),
    );
    if (!reply.ok) throw new Error(reply.error.message);
    const text = Buffer.from(reply.base64, 'base64').toString();
    expect(text).toContain('"title"');
    expect(text).toContain('file text');
  });

  it('reports network errors in the envelope and refuses non-http URLs', async () => {
    const refused = await forward(envelope({ url: 'http://127.0.0.1:1/nothing' }));
    expect(refused.ok).toBe(false);
    const file = await forward(envelope({ url: 'file:///etc/passwd' }));
    expect(file).toMatchObject({ ok: false, error: { kind: 'invalid-url' } });
  });

  it('never logs bodies', () => {
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain('file text');
    expect(logs.join('\n')).not.toContain('a=1');
  });
});
