/**
 * `Transport` on Node's `http`/`https` (docs/platform.md §7, PIGN-040): the reference native
 * transport for tests and the CLI runner (PIGN-054). Like the desktop transport it sends every
 * header as given (duplicates, `Host`, `Cookie`), follows redirects by hand recording each hop,
 * decodes gzip/deflate/br, and honours timeouts, TLS verification and aborts.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';

import type {
  FileRef,
  PickedFileStore,
  PreparedBody,
  PreparedRequest,
  ProjectFileSystem,
  RawResponse,
  Transport,
} from '@pigeon/platform';
import { defineCapabilities, TransportError } from '@pigeon/platform';

/** What a Node process can do (no browser restrictions; no folders UI). */
export const NODE_CAPABILITIES = defineCapabilities({
  transport: 'node',
  bypassesCors: true,
  canSetAnyHeader: true,
  canReadAllResponseHeaders: true,
  canControlRedirects: true,
  canDisableTlsVerification: true,
  canSendBodyWithGet: true,
  detailedTimings: true,
  projectFolders: 'native',
  browserWorkspace: false,
  fileWatch: true,
  persistentFolderAccess: true,
  fileReferencesByPath: true,
  secretStorage: 'local-state',
  multiWindow: false,
  offline: true,
});

export interface NodeTransportOptions {
  /** Where `picked` file refs come from. */
  pickedFiles?: PickedFileStore;
  /** Where `project` file refs come from. */
  projectFs?: ProjectFileSystem;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const encoder = new TextEncoder();

interface Hop {
  method: string;
  url: URL;
  headers: Array<[string, string]>;
  body: Uint8Array | undefined;
}

export class NodeTransport implements Transport {
  readonly #options: NodeTransportOptions;

  constructor(options: NodeTransportOptions = {}) {
    this.#options = options;
  }

  async send(req: PreparedRequest, { signal }: { signal: AbortSignal }): Promise<RawResponse> {
    signal.throwIfAborted();
    const startedAt = Date.now();
    const started = performance.now();
    let url: URL;
    try {
      url = new URL(req.url);
    } catch (cause) {
      throw new TransportError('invalid-url', `The URL is not valid: ${req.url}`, { cause });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new TransportError('invalid-url', `Unsupported protocol ${url.protocol}`);
    }
    const encoded = await this.#encodeBody(req.body);
    let hop: Hop = {
      method: req.method.toUpperCase(),
      url,
      headers: withContentType(req.headers, encoded?.contentType),
      body: encoded?.bytes,
    };

    // One deadline for the whole exchange, redirects included.
    const timeout =
      req.settings.timeoutMs > 0 ? AbortSignal.timeout(req.settings.timeoutMs) : undefined;
    const redirects: RawResponse['redirects'] = [];
    for (;;) {
      const response = await exchange(hop, req.settings.strictSSL, signal, timeout, started);
      const location = response.headers.find(([name]) => name.toLowerCase() === 'location')?.[1];
      if (
        !req.settings.followRedirects ||
        !REDIRECT_STATUSES.has(response.status) ||
        location === undefined
      ) {
        return {
          ...response,
          url: hop.url.toString(),
          redirects,
          timings: {
            startedAt,
            totalMs: performance.now() - started,
            ttfbMs: response.ttfbMs,
          },
          headersRestricted: false,
        };
      }
      if (redirects.length >= req.settings.maxRedirects) {
        throw new TransportError(
          'network',
          `Too many redirects (more than ${req.settings.maxRedirects}).`,
        );
      }
      redirects.push({ status: response.status, url: hop.url.toString(), location });
      hop = nextHop(hop, response.status, new URL(location, hop.url));
    }
  }

  async #encodeBody(
    body: PreparedBody | undefined,
  ): Promise<{ bytes: Uint8Array; contentType?: string } | undefined> {
    if (!body) return undefined;
    switch (body.kind) {
      case 'bytes':
        return { bytes: body.bytes };
      case 'file':
        return { bytes: await this.#readFile(body.ref) };
      case 'multipart': {
        const boundary = `----PigeonBoundary${randomUUID().replaceAll('-', '')}`;
        const chunks: Uint8Array[] = [];
        for (const part of body.parts) {
          const name = quote(part.name);
          let head = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`;
          let content: Uint8Array;
          if (part.kind === 'text') {
            if (part.contentType) head += `\r\nContent-Type: ${part.contentType}`;
            content = encoder.encode(part.value);
          } else {
            head += `; filename="${quote(part.filename)}"\r\nContent-Type: ${part.contentType ?? 'application/octet-stream'}`;
            content = await this.#readFile(part.file);
          }
          chunks.push(encoder.encode(`${head}\r\n\r\n`), content, encoder.encode('\r\n'));
        }
        chunks.push(encoder.encode(`--${boundary}--\r\n`));
        return {
          bytes: concat(chunks),
          contentType: `multipart/form-data; boundary=${boundary}`,
        };
      }
    }
  }

  async #readFile(ref: FileRef): Promise<Uint8Array> {
    try {
      switch (ref.kind) {
        case 'picked': {
          const file = this.#options.pickedFiles?.get(ref.id);
          if (!file) throw new Error('The picked file is no longer available.');
          return file.bytes;
        }
        case 'project': {
          if (!this.#options.projectFs) throw new Error('No project to read the file from.');
          return await this.#options.projectFs.readFile(ref.path);
        }
        case 'absolute':
          return new Uint8Array(await readFile(ref.path));
      }
    } catch (cause) {
      throw new TransportError(
        'file-unavailable',
        `A file in the request body could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }
}

function quote(value: string): string {
  return value.replace(/["\r\n]/g, (c) => (c === '"' ? '%22' : c === '\r' ? '%0D' : '%0A'));
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function hasHeader(headers: ReadonlyArray<[string, string]>, name: string): boolean {
  return headers.some(([key]) => key.toLowerCase() === name);
}

function withContentType(
  headers: ReadonlyArray<[string, string]>,
  contentType: string | undefined,
): Array<[string, string]> {
  return contentType && !hasHeader(headers, 'content-type')
    ? [...headers, ['Content-Type', contentType]]
    : [...headers];
}

/** The request after a redirect (fetch spec semantics, like the desktop transport). */
function nextHop(hop: Hop, status: number, url: URL): Hop {
  const toGet =
    (status === 303 && hop.method !== 'HEAD') ||
    ((status === 301 || status === 302) && hop.method === 'POST');
  let headers = hop.headers;
  if (toGet) {
    headers = headers.filter(
      ([name]) => !['content-type', 'content-length'].includes(name.toLowerCase()),
    );
  }
  if (url.origin !== hop.url.origin) {
    // Credentials and the explicit Host never follow a redirect to another origin.
    headers = headers.filter(
      ([name]) => !['authorization', 'cookie', 'host'].includes(name.toLowerCase()),
    );
  }
  return {
    method: toGet ? 'GET' : hop.method,
    url,
    headers,
    body: toGet ? undefined : hop.body,
  };
}

interface Exchanged {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: Uint8Array;
  httpVersion: string;
  ttfbMs: number;
}

function exchange(
  hop: Hop,
  strictSSL: boolean,
  signal: AbortSignal,
  timeout: AbortSignal | undefined,
  started: number,
): Promise<Exchanged> {
  return new Promise<Exchanged>((resolve, reject) => {
    const headers = [...hop.headers];
    if (hop.body && !hasHeader(headers, 'content-length')) {
      headers.push(['Content-Length', String(hop.body.byteLength)]);
    }
    if (!hasHeader(headers, 'host')) headers.unshift(['Host', hop.url.host]);
    const send = hop.url.protocol === 'https:' ? httpsRequest : httpRequest;
    let ttfbMs = 0;
    let settled = false;
    const finish = (error: unknown, value?: Exchanged) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      timeout?.removeEventListener('abort', onTimeout);
      if (error) reject(error);
      else resolve(value!);
    };
    const client = send(
      hop.url,
      {
        method: hop.method,
        // Raw header list: order, case and duplicates are kept.
        headers: headers.flat(),
        setHost: false,
        rejectUnauthorized: strictSSL,
      },
      (response: IncomingMessage) => {
        ttfbMs = performance.now() - started;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', (error) => finish(classify(error)));
        response.on('end', () => {
          const raw: Array<[string, string]> = [];
          for (let i = 0; i < response.rawHeaders.length; i += 2) {
            raw.push([response.rawHeaders[i]!, response.rawHeaders[i + 1]!]);
          }
          try {
            finish(null, {
              status: response.statusCode ?? 0,
              statusText: response.statusMessage ?? '',
              headers: raw,
              body: decode(Buffer.concat(chunks), response.headers['content-encoding']),
              httpVersion: response.httpVersion,
              ttfbMs,
            });
          } catch (error) {
            finish(
              new TransportError('network', 'The response body could not be decoded.', {
                detail: String(error),
                cause: error,
              }),
            );
          }
        });
      },
    );
    const onAbort = () => {
      client.destroy();
      finish(signal.reason);
    };
    const onTimeout = () => {
      client.destroy();
      finish(new TransportError('timeout', 'The request timed out.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    timeout?.addEventListener('abort', onTimeout, { once: true });
    if (timeout?.aborted) onTimeout();
    client.on('error', (error) => finish(classify(error)));
    client.end(hop.body ? Buffer.from(hop.body) : undefined);
  });
}

function decode(body: Buffer, encoding: string | undefined): Uint8Array {
  if (body.byteLength === 0) return new Uint8Array();
  let bytes: Buffer = body;
  // Encodings apply in order; decode in reverse.
  for (const coding of (encoding ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .reverse()) {
    if (coding === 'gzip' || coding === 'x-gzip') bytes = gunzipSync(bytes);
    else if (coding === 'br') bytes = brotliDecompressSync(bytes);
    else if (coding === 'deflate') {
      // zlib-wrapped per the spec; some servers send raw deflate.
      try {
        bytes = inflateSync(bytes);
      } catch {
        bytes = inflateRawSync(bytes);
      }
    }
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function classify(error: unknown): TransportError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  const detail =
    error instanceof Error ? `${code ? `${code}: ` : ''}${error.message}` : String(error);
  const options = { detail, cause: error };
  if (code === 'ECONNREFUSED') {
    return new TransportError('connection-refused', 'The server refused the connection.', options);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new TransportError('dns', 'The host name could not be resolved.', options);
  }
  if (
    /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(code) ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
  ) {
    return new TransportError('tls', 'The TLS connection could not be established.', options);
  }
  if (code === 'ETIMEDOUT') return new TransportError('timeout', 'The request timed out.', options);
  return new TransportError('network', 'The request failed.', options);
}
