/** `Transport` over the browser's `fetch` (docs/api-execution.md §7.2). */

import type { PreparedRequest, RawResponse, Transport } from '@pigeon/platform';
import { isForbiddenHeader, isForbiddenMethod, TransportError } from '@pigeon/platform';

const CORS_HINT =
  'The browser blocked the request or could not reach the server, and does not say why. ' +
  'Likely causes: the server does not allow cross-origin requests (CORS), the network or ' +
  'server is down, the host name does not resolve, or the TLS certificate is not trusted. ' +
  'The desktop app is not subject to CORS.';

export interface FetchTransportOptions {
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Monotonic clock in ms; defaults to `performance.now()`. */
  now?: () => number;
}

export class FetchTransport implements Transport {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(opts: FetchTransportOptions = {}) {
    // Unbound `fetch` throws "Illegal invocation" in browsers.
    this.#fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#now = opts.now ?? (() => performance.now());
  }

  async send(req: PreparedRequest, { signal }: { signal: AbortSignal }): Promise<RawResponse> {
    signal.throwIfAborted();
    const warnings: string[] = [];
    const fail = (kind: TransportError['kind'], message: string, opts = {}) =>
      new TransportError(kind, message, { ...opts, warnings });

    if (isForbiddenMethod(req.method)) {
      throw fail('invalid-request', `Browsers cannot send ${req.method} requests.`);
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && req.body) {
      throw fail('invalid-request', `Browsers cannot send a body with ${req.method} requests.`);
    }

    const headers = new Headers();
    for (const [name, value] of req.headers) {
      if (isForbiddenHeader(name, value)) {
        warnings.push(`Header "${name}" was not sent: browsers do not allow setting it.`);
        continue;
      }
      try {
        headers.append(name, value);
      } catch (error) {
        throw fail('invalid-request', `Header "${name}" is not valid.`, {
          detail: String(error),
          cause: error,
        });
      }
    }

    let body: BodyInit | undefined;
    if (req.body?.kind === 'bytes') {
      body = req.body.bytes as Uint8Array<ArrayBuffer>;
    } else if (req.body) {
      throw fail('invalid-request', 'This body type is not supported yet.');
    }

    const startedAt = Date.now();
    const start = this.#now();
    let response: Response;
    let bytes: Uint8Array;
    try {
      response = await this.#fetch(req.url, {
        method: req.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal,
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit',
      });
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      // fetch reports every network-level failure as a bare TypeError (PIGN-011 refines this).
      if (error instanceof TypeError) {
        throw fail('cors-suspected', 'The request was blocked or could not reach the server.', {
          detail: error.message,
          hint: CORS_HINT,
          cause: error,
        });
      }
      throw fail('unknown', 'The request failed.', { detail: String(error), cause: error });
    }
    const totalMs = Math.max(0, this.#now() - start);

    const responseHeaders: Array<[string, string]> = [];
    response.headers.forEach((value, name) => responseHeaders.push([name, value]));

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bytes,
      url: response.url || req.url,
      redirects: [],
      timings: { startedAt, totalMs },
      headersRestricted: true,
      warnings,
    };
  }
}
