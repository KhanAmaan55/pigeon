/**
 * The self-hosted CORS proxy (PIGN-052, docs/platform.md §6.2.1). The Pigeon web app posts each
 * request to `/v1/forward`; the proxy sends it with `NodeTransport` (the same native semantics as
 * the CLI and tests) and answers with the full response in JSON.
 *
 * Safety: binds to 127.0.0.1 unless told otherwise, requires the random token printed on start
 * (`x-pigeon-proxy-token`), answers only allow-listed origins, and never logs request or
 * response bodies. Anyone who has the token can make requests from this machine's network
 * position (SSRF) — keep it local and private.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  MultipartPart,
  PreparedBody,
  PreparedRequest,
  ProxyRequestEnvelope,
  ProxyResponseEnvelope,
  Transport,
} from '@pigeon/platform';
import {
  PickedFileStore,
  PROXY_FORWARD_PATH,
  PROXY_HEALTH_PATH,
  PROXY_TOKEN_HEADER,
  TransportError,
} from '@pigeon/platform';
import { NodeTransport } from '@pigeon/platform-node';

export const DEFAULT_PROXY_HOST = '127.0.0.1';
export const DEFAULT_PROXY_PORT = 8787;
/** Where the Pigeon web app runs in development and `vite preview`. */
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];
/** Request envelopes larger than this are refused (bodies are base64 inside). */
export const MAX_ENVELOPE_BYTES = 64 * 1024 * 1024;

export interface ProxyOptions {
  token?: string;
  host?: string;
  port?: number;
  /** Exact origins (scheme://host[:port]) allowed to use the proxy. */
  allowedOrigins?: readonly string[];
  /** Defaults to a `NodeTransport` per request. */
  transport?: (files: PickedFileStore) => Transport;
  /** One line per request (method, URL, status); bodies are never logged. */
  log?: (line: string) => void;
}

export interface RunningProxy {
  url: string;
  token: string;
  server: Server;
  close(): Promise<void>;
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function sameToken(given: string | undefined, token: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isEnvelope(value: unknown): value is ProxyRequestEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const settings = v['settings'] as Record<string, unknown> | undefined;
  return (
    typeof v['method'] === 'string' &&
    typeof v['url'] === 'string' &&
    Array.isArray(v['headers']) &&
    (v['headers'] as unknown[]).every(
      (h) =>
        Array.isArray(h) && h.length === 2 && typeof h[0] === 'string' && typeof h[1] === 'string',
    ) &&
    typeof settings === 'object' &&
    settings !== null &&
    typeof settings['timeoutMs'] === 'number'
  );
}

function toPrepared(envelope: ProxyRequestEnvelope, files: PickedFileStore): PreparedRequest {
  let body: PreparedBody | undefined;
  if (envelope.body?.kind === 'bytes') {
    body = { kind: 'bytes', bytes: new Uint8Array(Buffer.from(envelope.body.base64, 'base64')) };
  } else if (envelope.body?.kind === 'multipart') {
    const parts: MultipartPart[] = envelope.body.parts.map((part) =>
      part.kind === 'text'
        ? {
            name: part.name,
            kind: 'text',
            value: part.value,
            ...(part.contentType ? { contentType: part.contentType } : {}),
          }
        : {
            name: part.name,
            kind: 'file',
            filename: part.filename,
            ...(part.contentType ? { contentType: part.contentType } : {}),
            file: files.add({
              name: part.filename,
              bytes: new Uint8Array(Buffer.from(part.base64, 'base64')),
            }),
          },
    );
    body = { kind: 'multipart', parts };
  }
  return {
    id: crypto.randomUUID(),
    method: envelope.method,
    url: envelope.url,
    headers: envelope.headers,
    ...(body ? { body } : {}),
    settings: {
      timeoutMs: envelope.settings.timeoutMs,
      followRedirects: envelope.settings.followRedirects,
      maxRedirects: envelope.settings.maxRedirects,
      strictSSL: envelope.settings.strictSSL,
    },
    meta: { protocol: 'http', unresolved: [], secretValues: [] },
  };
}

/** The request handler (exported for tests that bring their own server). */
export function proxyHandler(
  options: Required<Pick<ProxyOptions, 'token' | 'allowedOrigins'>> &
    Pick<ProxyOptions, 'transport' | 'log'>,
) {
  const allowed = new Set(options.allowedOrigins.map((o) => o.replace(/\/+$/, '')));
  const makeTransport =
    options.transport ?? ((files: PickedFileStore) => new NodeTransport({ pickedFiles: files }));

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const origin = req.headers.origin;
    const reply = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(status, {
        'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
        'cache-control': 'no-store',
        ...(origin && allowed.has(origin)
          ? { 'access-control-allow-origin': origin, vary: 'Origin' }
          : {}),
        ...extra,
      });
      res.end(text);
    };
    // Browsers always send Origin on these cross-origin calls; a missing or unknown one is
    // refused, which also keeps other web pages (and plain curl without Origin) out.
    if (!origin || !allowed.has(origin)) {
      reply(
        403,
        `Origin ${origin ?? '(none)'} is not allowed. Start the proxy with --allow-origin.`,
      );
      return;
    }
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': `content-type, ${PROXY_TOKEN_HEADER}`,
        'access-control-max-age': '600',
        vary: 'Origin',
      });
      res.end();
      return;
    }
    const token = req.headers[PROXY_TOKEN_HEADER];
    if (!sameToken(typeof token === 'string' ? token : undefined, options.token)) {
      reply(401, 'Missing or wrong proxy token.');
      return;
    }
    if (req.method === 'GET' && path === PROXY_HEALTH_PATH) {
      reply(200, { ok: true, service: 'pigeon-cors-proxy' });
      return;
    }
    if (req.method !== 'POST' || path !== PROXY_FORWARD_PATH) {
      reply(404, 'Not found.');
      return;
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse((await readBody(req, MAX_ENVELOPE_BYTES)).toString('utf8'));
    } catch (error) {
      reply(
        error instanceof Error && error.message === 'too-large' ? 413 : 400,
        'The request envelope is not valid JSON (or too large).',
      );
      return;
    }
    if (!isEnvelope(envelope)) {
      reply(400, 'The request envelope is malformed.');
      return;
    }
    let target: URL;
    try {
      target = new URL(envelope.url);
    } catch {
      reply(200, { ok: false, error: { kind: 'invalid-url', message: 'Invalid URL.' } });
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reply(200, {
        ok: false,
        error: { kind: 'invalid-url', message: `Unsupported protocol ${target.protocol}` },
      } satisfies ProxyResponseEnvelope);
      return;
    }
    // The browser closing the connection (Cancel) aborts the upstream request.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort(new Error('client closed'));
    });
    const files = new PickedFileStore();
    try {
      const raw = await makeTransport(files).send(toPrepared(envelope, files), {
        signal: controller.signal,
      });
      options.log?.(`${envelope.method} ${target.origin}${target.pathname} → ${raw.status}`);
      reply(200, {
        ok: true,
        status: raw.status,
        statusText: raw.statusText,
        headers: raw.headers,
        base64: Buffer.from(raw.body).toString('base64'),
        url: raw.url,
        redirects: raw.redirects,
        ...(raw.httpVersion ? { httpVersion: raw.httpVersion } : {}),
        timings: {
          totalMs: raw.timings.totalMs,
          ...(raw.timings.ttfbMs === undefined ? {} : { ttfbMs: raw.timings.ttfbMs }),
        },
      } satisfies ProxyResponseEnvelope);
    } catch (error) {
      if (controller.signal.aborted) return;
      const kind = error instanceof TransportError ? error.kind : 'network';
      options.log?.(`${envelope.method} ${target.origin}${target.pathname} → ${kind}`);
      reply(200, {
        ok: false,
        error: {
          kind,
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof TransportError && error.detail ? { detail: error.detail } : {}),
        },
      } satisfies ProxyResponseEnvelope);
    }
  };
}

export async function startProxy(options: ProxyOptions = {}): Promise<RunningProxy> {
  const token = options.token ?? newToken();
  const host = options.host ?? DEFAULT_PROXY_HOST;
  const handler = proxyHandler({
    token,
    allowedOrigins: options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS,
    ...(options.transport ? { transport: options.transport } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_PROXY_PORT, host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const shownHost = host.includes(':') ? `[${host}]` : host;
  return {
    url: `http://${shownHost}:${port}`,
    token,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
