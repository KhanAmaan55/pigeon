import type { PreparedRequest, RawResponse, Transport } from '../transport';

/** What a route answers with; everything except the body defaults sensibly. */
export interface MockResponseInit {
  status?: number;
  statusText?: string;
  headers?: Array<[string, string]>;
  body?: Uint8Array | string;
  /** Final URL; defaults to the request URL. */
  url?: string;
  redirects?: RawResponse['redirects'];
  httpVersion?: string;
  headersRestricted?: boolean;
  ttfbMs?: number;
}

/** A fixed response, or a handler that may be async (to test cancellation) or throw (network errors). */
export type MockReply =
  MockResponseInit | ((req: PreparedRequest) => MockResponseInit | Promise<MockResponseInit>);

export type MockMatcher =
  { method?: string; url: string | RegExp } | ((req: PreparedRequest) => boolean);

const encoder = new TextEncoder();

/** Programmable `Transport`: first matching route wins; unmatched requests reject. */
export class MockTransport implements Transport {
  /** Every request sent, in order. */
  readonly requests: PreparedRequest[] = [];
  readonly #routes: Array<{ matches: (req: PreparedRequest) => boolean; reply: MockReply }> = [];

  on(matcher: MockMatcher, reply: MockReply): this {
    this.#routes.push({ matches: toPredicate(matcher), reply });
    return this;
  }

  async send(req: PreparedRequest, { signal }: { signal: AbortSignal }): Promise<RawResponse> {
    signal.throwIfAborted();
    this.requests.push(req);
    const route = this.#routes.find((candidate) => candidate.matches(req));
    if (!route) throw new Error(`MockTransport: no route for ${req.method} ${req.url}`);

    const startedAt = Date.now();
    const { reply } = route;
    const init = await abortable(
      Promise.resolve().then(() => (typeof reply === 'function' ? reply(req) : reply)),
      signal,
    );
    const body = init.body ?? new Uint8Array();
    return {
      status: init.status ?? 200,
      statusText: init.statusText ?? '',
      headers: init.headers ?? [],
      body: typeof body === 'string' ? encoder.encode(body) : body,
      url: init.url ?? req.url,
      redirects: init.redirects ?? [],
      ...(init.httpVersion === undefined ? {} : { httpVersion: init.httpVersion }),
      timings: {
        startedAt,
        totalMs: Date.now() - startedAt,
        ...(init.ttfbMs === undefined ? {} : { ttfbMs: init.ttfbMs }),
      },
      headersRestricted: init.headersRestricted ?? false,
    };
  }
}

function toPredicate(matcher: MockMatcher): (req: PreparedRequest) => boolean {
  if (typeof matcher === 'function') return matcher;
  const { method, url } = matcher;
  return (req) =>
    (method === undefined || method.toUpperCase() === req.method.toUpperCase()) &&
    // A fresh copy per check: `/g` and `/y` regexes keep `lastIndex` between `test` calls.
    (typeof url === 'string' ? url === req.url : new RegExp(url).test(req.url));
}

/** Settles like `promise`, or rejects with `signal.reason` as soon as the signal aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
