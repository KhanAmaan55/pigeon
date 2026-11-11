import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';

import { TEST_SERVER_CERT, TEST_SERVER_KEY } from './https.ts';
import type { Reply, RequestContext } from './reply.ts';
import { error } from './reply.ts';
import type { CorsMode, Route } from './routes.ts';
import { routes } from './routes.ts';

/** Port used by the CLI (E2E and Rust tests); unit tests use an ephemeral port. */
export const DEFAULT_PORT = 4010;
export const DEFAULT_HOST = '127.0.0.1';

export interface TestServerOptions {
  /** `0` (the default) picks a free port. */
  port?: number;
  host?: string;
  /**
   * Serve over HTTPS with the committed self-signed certificate (`TEST_SERVER_CERT`), for TLS
   * tests. Same endpoints; the URL starts with `https://`.
   */
  https?: boolean;
}

export interface TestServer {
  /** Base URL without a trailing slash, e.g. `http://127.0.0.1:51234` (`https://` with `https`). */
  url: string;
  port: number;
  /** Stops listening and drops open connections (including pending `/delay` requests). */
  close(): Promise<void>;
}

export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const host = options.host ?? DEFAULT_HOST;
  const listener = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent && !res.destroyed) {
        write(req, res, 'permissive', error(500, err instanceof Error ? err.message : String(err)));
      }
    });
  };
  const server = options.https
    ? createHttpsServer({ cert: TEST_SERVER_CERT, key: TEST_SERVER_KEY }, listener)
    : createServer(listener);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `${options.https ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Responses must be deterministic, so no `Date` header.
  res.sendDate = false;

  const target = req.url ?? '/';
  const queryStart = target.indexOf('?');
  const path = queryStart < 0 ? target : target.slice(0, queryStart);
  const query = new URLSearchParams(queryStart < 0 ? '' : target.slice(queryStart + 1));

  let route: Route | undefined;
  let params: string[] = [];
  for (const candidate of routes) {
    const match = candidate.pattern.exec(path);
    if (match) {
      route = candidate;
      params = match.slice(1).map((group) => group ?? '');
      break;
    }
  }
  const cors = route?.cors ?? 'permissive';

  if (isPreflight(req)) {
    write(req, res, cors, { status: 204 }, true);
    return;
  }

  const body = await readBody(req);
  if (!route) {
    write(req, res, cors, error(404, `No test endpoint at ${path}`));
    return;
  }

  const controller = new AbortController();
  res.once('close', () => controller.abort());
  const ctx: RequestContext = {
    req,
    method: req.method ?? 'GET',
    path,
    query,
    params,
    body,
    signal: controller.signal,
  };
  let reply: Reply;
  try {
    reply = await route.handle(ctx);
  } catch (err) {
    if (controller.signal.aborted) return; // client went away mid-`/delay`
    throw err;
  }
  write(req, res, cors, reply);
}

const isPreflight = (req: IncomingMessage) =>
  req.method === 'OPTIONS' &&
  req.headers.origin !== undefined &&
  req.headers['access-control-request-method'] !== undefined;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function write(
  req: IncomingMessage,
  res: ServerResponse,
  cors: CorsMode,
  reply: Reply,
  preflight = false,
): void {
  const status = reply.status ?? 200;
  for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
  const body = typeof reply.body === 'string' ? Buffer.from(reply.body) : reply.body;
  const bodyless = status === 204 || status === 304;
  if (!bodyless) res.setHeader('Content-Length', body?.byteLength ?? 0);
  applyCors(req, res, cors, preflight);
  res.writeHead(status);
  res.end(bodyless ? undefined : body);
}

function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  cors: CorsMode,
  preflight: boolean,
): void {
  if (cors === 'none') return;
  // Reflect the origin (rather than `*`) so credentialed requests work too.
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  res.setHeader('Vary', 'Origin');
  if (origin !== undefined) res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (preflight) {
    if (cors === 'permissive') {
      res.setHeader('Access-Control-Allow-Methods', req.headers['access-control-request-method']!);
      const requested = req.headers['access-control-request-headers'];
      if (requested) res.setHeader('Access-Control-Allow-Headers', requested);
    } else {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST');
    }
    return;
  }

  // `*` is not a wildcard for credentialed requests, so list the actual header names.
  const exposed = res
    .getHeaderNames()
    .filter((name) => !name.startsWith('access-control-') && name !== 'set-cookie');
  if (exposed.length) res.setHeader('Access-Control-Expose-Headers', exposed.join(', '));
}
