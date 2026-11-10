import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import type { MockResponseInit, PreparedRequest, RawResponse } from '../src/index';
import { MEMORY_CAPABILITIES, MockTransport, TransportError } from '../src/index';
import { transportConformance, transportConformanceCases } from '../src/conformance/index';

/**
 * A MockTransport programmed as the part of `@pigeon/test-server` the conformance cases use,
 * behaving like a native transport (MEMORY_CAPABILITIES): redirects followed by hand with every
 * hop recorded, all headers visible, timeouts honoured. It shows that tests written against
 * MockTransport model the real transport contract.
 */
const BASE_URL = 'http://test-server.mock';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const decoder = new TextDecoder();

type Headers = Array<[string, string]>;
interface Exchange {
  method: string;
  url: URL;
  headers: Headers;
  body: Uint8Array | undefined;
  settings: PreparedRequest['settings'];
}

const json = (value: unknown, status = 200, headers: Headers = []): MockResponseInit => ({
  status,
  headers: [['content-type', 'application/json; charset=utf-8'], ...headers],
  body: `${JSON.stringify(value, null, 2)}\n`,
});

const header = (headers: Headers, name: string) =>
  headers.find(([key]) => key.toLowerCase() === name)?.[1];

async function route({
  method,
  url,
  headers,
  body,
  settings,
}: Exchange): Promise<MockResponseInit> {
  if (url.origin !== BASE_URL) {
    throw new TransportError('connection-refused', 'The server refused the connection.');
  }
  const path = url.pathname;
  let match: RegExpMatchArray | null;
  if (path === '/json/user') return json({ id: 1, name: 'Ada Lovelace' });
  if (path === '/echo') {
    const size = body?.byteLength ?? 0;
    return json({ method, rawHeaders: headers, body: { size, text: decoder.decode(body) } });
  }
  if ((match = /^\/status\/(\d+)$/.exec(path))) {
    const status = Number(match[1]);
    return status === 204 ? { status } : json({ status }, status);
  }
  if ((match = /^\/bytes\/(\d+)$/.exec(path))) {
    return { body: Uint8Array.from({ length: Number(match[1]) }, (_, i) => i % 256) };
  }
  if (path === '/gzip') {
    // The transport already decoded it; the header stays as the server sent it.
    return { ...json({ gzipped: true, method }), headers: [['content-encoding', 'gzip']] };
  }
  if ((match = /^\/large\/(\d+)$/.exec(path))) {
    return json(['x'.repeat(Number(match[1]) * 1024 * 1024)]);
  }
  if (path === '/cookies/set') {
    const setCookie = [...url.searchParams].map(([k, v]): [string, string] => [
      'set-cookie',
      `${k}=${v}; Path=/`,
    ]);
    return json({ cookies: Object.fromEntries(url.searchParams) }, 200, setCookie);
  }
  if (path === '/cors/none') return json({ cors: 'none', method });
  if ((match = /^\/redirect\/(\d+)$/.exec(path))) {
    const n = Number(match[1]);
    const status = Number(url.searchParams.get('status') ?? 302);
    const query = url.search;
    const location = n > 1 ? `/redirect/${n - 1}${query}` : '/echo';
    return json({ redirect: location }, status, [['location', location]]);
  }
  if ((match = /^\/delay\/(\d+)$/.exec(path))) {
    const ms = Number(match[1]);
    const { timeoutMs } = settings;
    await sleep(timeoutMs > 0 ? Math.min(ms, timeoutMs) : ms);
    if (timeoutMs > 0 && ms > timeoutMs) {
      throw new TransportError('timeout', `The request timed out after ${timeoutMs} ms.`);
    }
    return json({ delayMs: ms });
  }
  return json({ error: `No test endpoint at ${path}` }, 404);
}

async function serve(req: PreparedRequest): Promise<MockResponseInit> {
  const exchange: Exchange = {
    method: req.method,
    url: new URL(req.url),
    headers: req.headers,
    body: req.body?.kind === 'bytes' ? req.body.bytes : undefined,
    settings: req.settings,
  };
  const redirects: RawResponse['redirects'] = [];
  for (;;) {
    const res = await route(exchange);
    const status = res.status ?? 200;
    const location = header(res.headers ?? [], 'location');
    if (!req.settings.followRedirects || !REDIRECTS.has(status) || location === undefined) {
      const body = exchange.method === 'HEAD' ? new Uint8Array() : res.body;
      return {
        ...res,
        ...(body === undefined ? {} : { body }),
        url: exchange.url.href,
        redirects,
        ttfbMs: 0,
      };
    }
    if (redirects.length >= req.settings.maxRedirects) {
      throw new TransportError(
        'network',
        `Too many redirects (more than ${req.settings.maxRedirects}).`,
      );
    }
    redirects.push({ status, url: exchange.url.href, location });
    const toGet =
      status === 303
        ? exchange.method !== 'HEAD'
        : (status === 301 || status === 302) && !['GET', 'HEAD'].includes(exchange.method);
    if (toGet) {
      exchange.method = 'GET';
      exchange.body = undefined;
      exchange.headers = exchange.headers.filter(
        ([name]) => !['content-type', 'content-length'].includes(name.toLowerCase()),
      );
    }
    exchange.url = new URL(location, exchange.url);
  }
}

transportConformance(
  'MockTransport (test-server double)',
  () => new MockTransport().on(() => true, serve),
  MEMORY_CAPABILITIES,
  { baseUrl: BASE_URL },
);

describe('transportConformanceCases', () => {
  it('skips what browsers cannot do and expects their behaviour instead', () => {
    const browser = {
      ...MEMORY_CAPABILITIES,
      transport: 'fetch',
      bypassesCors: false,
      canSetAnyHeader: false,
      canReadAllResponseHeaders: false,
      canControlRedirects: false,
      canSendBodyWithGet: false,
      detailedTimings: false,
    } as const;
    const cases = transportConformanceCases(browser);
    expect(cases.filter((c) => c.skip).map((c) => c.id)).toEqual([
      'redirect-manual',
      'redirect-limit',
    ]);
    expect(cases.find((c) => c.id === 'cors')?.title).toContain('cors-suspected');
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });
});
