/**
 * Behaviour every `Transport` must share (docs/platform.md §8), as plain async functions against
 * `@pigeon/test-server`. No test-framework imports, so both Vitest (`transportConformance`) and
 * Playwright (FetchTransport in a real browser) can run them. Assertions are capability-aware:
 * e.g. forbidden headers are only expected to arrive when `canSetAnyHeader`.
 *
 * The Rust transport mirrors these cases in `apps/desktop/src-tauri/src/http/tests.rs`.
 */

import type { Capabilities } from '../capabilities';
import type { PreparedRequest, RawResponse, Transport } from '../transport';

export interface TransportConformanceContext {
  transport: Transport;
  /** `@pigeon/test-server` base URL without a trailing slash, e.g. `http://127.0.0.1:4010`. */
  baseUrl: string;
}

export interface TransportConformanceCase {
  /** Stable id, used to mark cases as expected failures until a story lands. */
  id: string;
  title: string;
  /** Set when the capabilities make the case meaningless; the reason is shown as the skip. */
  skip?: string;
  run(ctx: TransportConformanceContext): Promise<void>;
}

/** The parts of `/echo`'s JSON these cases read. */
interface Echo {
  method: string;
  rawHeaders: Array<[string, string]>;
  body: { size: number; text: string | null };
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();
let nextId = 0;

class ConformanceError extends Error {
  override readonly name = 'ConformanceError';
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ConformanceError(message);
}

function checkEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, `${label}: expected ${e}, got ${a}`);
}

function request(
  baseUrl: string,
  method: string,
  path: string,
  overrides: Partial<Omit<PreparedRequest, 'body'>> & { body?: string } = {},
): PreparedRequest {
  const { body, ...rest } = overrides;
  return {
    id: `conformance-${++nextId}`,
    method,
    url: path.startsWith('http') ? path : `${baseUrl}${path}`,
    headers: [],
    ...(body === undefined ? {} : { body: { kind: 'bytes', bytes: encoder.encode(body) } }),
    settings: { timeoutMs: 30_000, followRedirects: true, maxRedirects: 10, strictSSL: true },
    meta: { protocol: 'http', unresolved: [], secretValues: [] },
    ...rest,
  };
}

function send(transport: Transport, req: PreparedRequest): Promise<RawResponse> {
  return transport.send(req, { signal: new AbortController().signal });
}

/** Resolves with the rejection reason; fails if the promise resolves. */
async function rejection(promise: Promise<unknown>, label: string): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new ConformanceError(`${label}: expected a rejection, but it resolved`);
}

/** Duck-typed so it works across module instances (e.g. Playwright bundles). */
function checkTransportError(error: unknown, kinds: readonly string[], label: string): void {
  const { name, kind } = (error ?? {}) as { name?: unknown; kind?: unknown };
  check(name === 'TransportError', `${label}: expected a TransportError, got ${String(error)}`);
  check(
    typeof kind === 'string' && kinds.includes(kind),
    `${label}: expected kind ${kinds.join(' | ')}, got ${String(kind)}`,
  );
}

function text(res: RawResponse): string {
  return decoder.decode(res.body);
}

function json<T = Record<string, unknown>>(res: RawResponse): T {
  return JSON.parse(text(res)) as T;
}

function headerValues(headers: Array<[string, string]>, name: string): string[] {
  const lower = name.toLowerCase();
  return headers.filter(([key]) => key.toLowerCase() === lower).map(([, value]) => value);
}

export function transportConformanceCases(
  caps: Readonly<Capabilities>,
): TransportConformanceCase[] {
  const cases: TransportConformanceCase[] = [
    {
      id: 'get',
      title: 'GET resolves with status, headers, body, final URL and timings',
      async run({ transport, baseUrl }) {
        const res = await send(transport, request(baseUrl, 'GET', '/json/user'));
        checkEqual(res.status, 200, 'status');
        check(
          headerValues(res.headers, 'content-type')[0]?.startsWith('application/json'),
          'content-type header',
        );
        checkEqual(json(res)['name'], 'Ada Lovelace', 'body.name');
        checkEqual(res.url, `${baseUrl}/json/user`, 'url');
        checkEqual(res.redirects, [], 'redirects');
        checkEqual(res.headersRestricted, !caps.canReadAllResponseHeaders, 'headersRestricted');
        check(typeof res.timings.startedAt === 'number', 'timings.startedAt');
        check(res.timings.totalMs >= 0, 'timings.totalMs');
        if (caps.detailedTimings) {
          const { ttfbMs, totalMs } = res.timings;
          check(ttfbMs !== undefined && ttfbMs <= totalMs, `ttfbMs ${ttfbMs} ≤ totalMs ${totalMs}`);
        }
      },
    },
    {
      id: 'status',
      title: 'non-2xx statuses resolve as responses, bodyless ones with an empty body',
      async run({ transport, baseUrl }) {
        checkEqual(
          (await send(transport, request(baseUrl, 'GET', '/status/404'))).status,
          404,
          '404',
        );
        checkEqual(
          (await send(transport, request(baseUrl, 'GET', '/status/500'))).status,
          500,
          '500',
        );
        const noContent = await send(transport, request(baseUrl, 'GET', '/status/204'));
        checkEqual([noContent.status, noContent.body.byteLength], [204, 0], '204');
      },
    },
    {
      id: 'post-body',
      title: 'POST sends the body bytes',
      async run({ transport, baseUrl }) {
        const body = 'héllo pigeon ✓';
        const res = await send(
          transport,
          request(baseUrl, 'POST', '/echo', { headers: [['Content-Type', 'text/plain']], body }),
        );
        const echo = json<Echo>(res);
        checkEqual(echo.method, 'POST', 'method');
        checkEqual(echo.body.text, body, 'body.text');
        checkEqual(echo.body.size, encoder.encode(body).byteLength, 'body.size');
      },
    },
    {
      id: 'head',
      title: 'HEAD resolves with headers and no body',
      async run({ transport, baseUrl }) {
        const res = await send(transport, request(baseUrl, 'HEAD', '/json/user'));
        checkEqual(res.status, 200, 'status');
        checkEqual(res.body.byteLength, 0, 'body size');
      },
    },
    {
      id: 'get-body',
      title: caps.canSendBodyWithGet
        ? 'GET can carry a body'
        : 'GET with a body is rejected before sending',
      async run({ transport, baseUrl }) {
        const req = request(baseUrl, 'GET', '/echo', { body: 'on a GET' });
        if (caps.canSendBodyWithGet) {
          checkEqual(json<Echo>(await send(transport, req)).body.text, 'on a GET', 'body.text');
        } else {
          checkTransportError(
            await rejection(send(transport, req), 'GET body'),
            ['invalid-request'],
            'GET body',
          );
        }
      },
    },
    {
      id: 'binary',
      title: 'binary bodies arrive byte for byte',
      async run({ transport, baseUrl }) {
        const res = await send(transport, request(baseUrl, 'GET', '/bytes/1000'));
        checkEqual(res.body.byteLength, 1000, 'size');
        check(
          res.body.every((byte, i) => byte === i % 256),
          'bytes differ from i % 256',
        );
      },
    },
    {
      id: 'gzip',
      title: 'gzip bodies are decoded and sized decoded',
      async run({ transport, baseUrl }) {
        const res = await send(transport, request(baseUrl, 'GET', '/gzip'));
        const body = json(res);
        checkEqual([body['gzipped'], body['method']], [true, 'GET'], 'decoded JSON');
        checkEqual(res.body.byteLength, encoder.encode(text(res)).byteLength, 'decoded size');
      },
    },
    {
      id: 'large',
      title: 'large bodies complete',
      async run({ transport, baseUrl }) {
        const res = await send(transport, request(baseUrl, 'GET', '/large/5'));
        checkEqual(res.status, 200, 'status');
        check(res.body.byteLength >= 5 * 1024 * 1024, `size ${res.body.byteLength} ≥ 5 MiB`);
      },
    },
    {
      id: 'duplicate-request-headers',
      title: caps.canSetAnyHeader
        ? 'duplicate request headers are sent separately, in order'
        : 'duplicate request headers arrive combined, in order',
      async run({ transport, baseUrl }) {
        const headers: Array<[string, string]> = [
          ['X-Dup', '1'],
          ['X-Other', 'x'],
          ['X-Dup', '2'],
        ];
        const echo = json<Echo>(
          await send(transport, request(baseUrl, 'GET', '/echo', { headers })),
        );
        const values = headerValues(echo.rawHeaders, 'x-dup');
        checkEqual(values.join(', '), '1, 2', 'x-dup values');
        if (caps.canSetAnyHeader) checkEqual(values, ['1', '2'], 'separate x-dup headers');
      },
    },
    {
      id: 'forbidden-headers',
      title: caps.canSetAnyHeader
        ? 'Host and Cookie headers reach the server unchanged'
        : 'Host and Cookie headers are dropped with a warning each',
      async run({ transport, baseUrl }) {
        const headers: Array<[string, string]> = [
          ['Host', 'api.example.test'],
          ['Cookie', 'a=1; b=two'],
        ];
        const res = await send(transport, request(baseUrl, 'GET', '/echo', { headers }));
        const echo = json<Echo>(res);
        if (caps.canSetAnyHeader) {
          checkEqual(headerValues(echo.rawHeaders, 'host'), ['api.example.test'], 'host');
          checkEqual(headerValues(echo.rawHeaders, 'cookie'), ['a=1; b=two'], 'cookie');
        } else {
          checkEqual(headerValues(echo.rawHeaders, 'host'), [new URL(baseUrl).host], 'host');
          checkEqual(headerValues(echo.rawHeaders, 'cookie'), [], 'cookie');
          const warnings = res.warnings ?? [];
          check(
            warnings.some((w) => w.includes('"Host"')),
            `warning for Host in ${String(warnings)}`,
          );
          check(
            warnings.some((w) => w.includes('"Cookie"')),
            `warning for Cookie in ${String(warnings)}`,
          );
        }
      },
    },
    {
      id: 'duplicate-response-headers',
      title: caps.canReadAllResponseHeaders
        ? 'duplicate response headers (two Set-Cookie) are all visible'
        : 'Set-Cookie is invisible and the response says headers are restricted',
      async run({ transport, baseUrl }) {
        const res = await send(transport, request(baseUrl, 'GET', '/cookies/set?a=1&b=2'));
        const cookies = headerValues(res.headers, 'set-cookie');
        if (caps.canReadAllResponseHeaders) {
          checkEqual(cookies, ['a=1; Path=/', 'b=2; Path=/'], 'set-cookie');
        } else {
          checkEqual(cookies, [], 'set-cookie');
          checkEqual(res.headersRestricted, true, 'headersRestricted');
        }
      },
    },
    {
      id: 'cors',
      title: caps.bypassesCors
        ? 'servers without CORS headers answer normally'
        : 'servers without CORS headers fail as cors-suspected',
      async run({ transport, baseUrl }) {
        const req = request(baseUrl, 'GET', '/cors/none');
        if (caps.bypassesCors) {
          const res = await send(transport, req);
          checkEqual([res.status, json(res)['cors']], [200, 'none'], 'response');
        } else {
          checkTransportError(
            await rejection(send(transport, req), 'CORS'),
            ['cors-suspected'],
            'CORS',
          );
        }
      },
    },
    {
      id: 'redirects',
      title: caps.canControlRedirects
        ? 'redirects are followed and every hop is recorded'
        : 'redirects are followed to the final response',
      async run({ transport, baseUrl }) {
        const res = await send(transport, request(baseUrl, 'GET', '/redirect/3'));
        checkEqual([res.status, res.url], [200, `${baseUrl}/echo`], 'final response');
        checkEqual(
          res.redirects,
          caps.canControlRedirects
            ? [
                { status: 302, url: `${baseUrl}/redirect/3`, location: '/redirect/2' },
                { status: 302, url: `${baseUrl}/redirect/2`, location: '/redirect/1' },
                { status: 302, url: `${baseUrl}/redirect/1`, location: '/echo' },
              ]
            : [],
          'redirects',
        );
      },
    },
    {
      id: 'redirect-303',
      title: 'a 303 turns POST into GET without a body',
      async run({ transport, baseUrl }) {
        const req = request(baseUrl, 'POST', '/redirect/1?status=303', {
          headers: [['Content-Type', 'text/plain']],
          body: 'payload',
        });
        const echo = json<Echo>(await send(transport, req));
        checkEqual([echo.method, echo.body.size], ['GET', 0], 'method and body size');
        checkEqual(headerValues(echo.rawHeaders, 'content-type'), [], 'content-type');
      },
    },
    {
      id: 'redirect-307',
      title: 'a 307 keeps the method and the body',
      async run({ transport, baseUrl }) {
        const req = request(baseUrl, 'POST', '/redirect/1?status=307', {
          headers: [['Content-Type', 'text/plain']],
          body: 'payload',
        });
        const echo = json<Echo>(await send(transport, req));
        checkEqual([echo.method, echo.body.text], ['POST', 'payload'], 'method and body');
      },
    },
    {
      id: 'redirect-manual',
      title: 'followRedirects=false returns the redirect itself',
      ...(caps.canControlRedirects ? {} : { skip: 'redirects cannot be controlled' }),
      async run({ transport, baseUrl }) {
        const req = request(baseUrl, 'GET', '/redirect/1');
        req.settings.followRedirects = false;
        const res = await send(transport, req);
        checkEqual(res.status, 302, 'status');
        checkEqual(headerValues(res.headers, 'location'), ['/echo'], 'location');
        checkEqual(res.redirects, [], 'redirects');
      },
    },
    {
      id: 'redirect-limit',
      title: 'more than maxRedirects redirects fail',
      ...(caps.canControlRedirects ? {} : { skip: 'redirects cannot be controlled' }),
      async run({ transport, baseUrl }) {
        const req = request(baseUrl, 'GET', '/redirect/5');
        req.settings.maxRedirects = 2;
        const error = await rejection(send(transport, req), 'redirect limit');
        checkTransportError(error, ['network'], 'redirect limit');
        check(/redirect/i.test((error as Error).message), 'message mentions redirects');
      },
    },
    {
      id: 'timeout',
      title: 'settings.timeoutMs fails a slow request as timeout',
      async run({ transport, baseUrl }) {
        const req = request(baseUrl, 'GET', '/delay/3000');
        req.settings.timeoutMs = 300;
        const started = Date.now();
        checkTransportError(
          await rejection(send(transport, req), 'timeout'),
          ['timeout'],
          'timeout',
        );
        check(Date.now() - started < 2500, 'timed out well before the response');
      },
    },
    {
      id: 'abort',
      title: 'aborting rejects promptly with signal.reason',
      async run({ transport, baseUrl }) {
        const controller = new AbortController();
        const reason = new Error('stop');
        const started = Date.now();
        const pending = transport.send(request(baseUrl, 'GET', '/delay/5000'), {
          signal: controller.signal,
        });
        // No setTimeout in this package's globals (types/web-globals.d.ts).
        AbortSignal.timeout(100).addEventListener('abort', () => controller.abort(reason), {
          once: true,
        });
        check((await rejection(pending, 'abort')) === reason, 'rejected with signal.reason');
        check(Date.now() - started < 2500, 'rejected well before the response');
      },
    },
    {
      id: 'aborted-before',
      title: 'an already-aborted signal rejects with its reason',
      async run({ transport, baseUrl }) {
        const controller = new AbortController();
        const reason = new Error('never');
        controller.abort(reason);
        const pending = transport.send(request(baseUrl, 'GET', '/json/user'), {
          signal: controller.signal,
        });
        check((await rejection(pending, 'aborted')) === reason, 'rejected with signal.reason');
      },
    },
    {
      id: 'unreachable',
      title: 'an unreachable server fails with a TransportError',
      async run({ transport }) {
        // Port 1 is closed everywhere and on every browser's blocked-port list.
        const error = await rejection(
          send(transport, request('', 'GET', 'http://127.0.0.1:1/')),
          'unreachable',
        );
        checkTransportError(
          error,
          caps.bypassesCors ? ['connection-refused'] : ['cors-suspected', 'network'],
          'unreachable',
        );
      },
    },
  ];
  return cases;
}
