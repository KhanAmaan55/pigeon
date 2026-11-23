/**
 * Web requests through a self-hosted CORS proxy (PIGN-052, docs/platform.md §6.2.1): each request
 * becomes one `POST <proxy>/v1/forward` carrying the request as JSON (headers verbatim, body as
 * base64), with the proxy's token. The proxy performs it natively, so CORS and forbidden headers
 * no longer apply, and answers with the full response (`Set-Cookie` and every header included).
 */

import type {
  CorsProxyConfig,
  CorsProxyControl,
  PickedFileStore,
  PreparedRequest,
  ProxyBody,
  ProxyRequestEnvelope,
  ProxyResponseEnvelope,
  RawResponse,
  Transport,
  TransportErrorKind,
} from '@pigeon/platform';
import {
  PROXY_FORWARD_PATH,
  PROXY_HEALTH_PATH,
  PROXY_TOKEN_HEADER,
  TransportError,
} from '@pigeon/platform';

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const KINDS: readonly TransportErrorKind[] = [
  'network',
  'timeout',
  'tls',
  'dns',
  'connection-refused',
  'invalid-url',
  'invalid-request',
  'file-unavailable',
];

function endpoint(config: CorsProxyConfig, path: string): string {
  return `${config.url.replace(/\/+$/, '')}${path}`;
}

export interface ProxyTransportOptions {
  config: () => CorsProxyConfig | null;
  pickedFiles?: PickedFileStore;
  fetch?: typeof fetch;
}

export class ProxyTransport implements Transport {
  readonly #config: () => CorsProxyConfig | null;
  readonly #pickedFiles: PickedFileStore | undefined;
  readonly #fetch: typeof fetch;

  constructor(opts: ProxyTransportOptions) {
    this.#config = opts.config;
    this.#pickedFiles = opts.pickedFiles;
    this.#fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  #fileBytes(ref: { kind: string; id?: string; path?: string }, name: string): Uint8Array {
    if (ref.kind === 'picked' && ref.id) {
      const file = this.#pickedFiles?.get(ref.id);
      if (file) return file.bytes;
    }
    throw new TransportError(
      'file-unavailable',
      `The file "${name}" is no longer available. Select it again.`,
    );
  }

  #body(req: PreparedRequest): ProxyBody | undefined {
    const body = req.body;
    switch (body?.kind) {
      case undefined:
        return undefined;
      case 'bytes':
        return { kind: 'bytes', base64: toBase64(body.bytes) };
      case 'file':
        return { kind: 'bytes', base64: toBase64(this.#fileBytes(body.ref, 'body')) };
      case 'multipart':
        return {
          kind: 'multipart',
          parts: body.parts.map((part) =>
            part.kind === 'text'
              ? {
                  name: part.name,
                  kind: 'text' as const,
                  value: part.value,
                  ...(part.contentType ? { contentType: part.contentType } : {}),
                }
              : {
                  name: part.name,
                  kind: 'file' as const,
                  filename: part.filename,
                  ...(part.contentType ? { contentType: part.contentType } : {}),
                  base64: toBase64(this.#fileBytes(part.file, part.filename)),
                },
          ),
        };
    }
  }

  async send(req: PreparedRequest, { signal }: { signal: AbortSignal }): Promise<RawResponse> {
    signal.throwIfAborted();
    const config = this.#config();
    if (!config) throw new TransportError('network', 'The CORS proxy is not configured.');
    const body = this.#body(req);
    const envelope: ProxyRequestEnvelope = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      ...(body ? { body } : {}),
      settings: {
        timeoutMs: req.settings.timeoutMs,
        followRedirects: req.settings.followRedirects,
        maxRedirects: req.settings.maxRedirects,
        strictSSL: req.settings.strictSSL,
      },
    };
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.#fetch(endpoint(config, PROXY_FORWARD_PATH), {
        method: 'POST',
        headers: { 'content-type': 'application/json', [PROXY_TOKEN_HEADER]: config.token },
        body: JSON.stringify(envelope),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new TransportError('network', `The CORS proxy at ${config.url} is not reachable.`, {
        detail: error instanceof Error ? error.message : String(error),
        hint: 'Start it with `pnpm --filter @pigeon/cors-proxy start` (or turn proxy mode off in Settings).',
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw new TransportError(
        'network',
        response.status === 401
          ? 'The CORS proxy rejected the token.'
          : 'The CORS proxy does not allow this origin.',
        {
          detail: await response.text().catch(() => ''),
          hint: 'Check the URL and token in Settings → CORS proxy (the proxy prints them on start).',
        },
      );
    }
    let reply: ProxyResponseEnvelope;
    try {
      reply = (await response.json()) as ProxyResponseEnvelope;
    } catch {
      throw new TransportError(
        'network',
        `The CORS proxy answered ${response.status} without JSON.`,
      );
    }
    if (!reply.ok) {
      const kind = (KINDS as readonly string[]).includes(reply.error.kind)
        ? (reply.error.kind as TransportErrorKind)
        : 'network';
      throw new TransportError(kind, reply.error.message, {
        ...(reply.error.detail ? { detail: reply.error.detail } : {}),
      });
    }
    return {
      status: reply.status,
      statusText: reply.statusText,
      headers: reply.headers,
      body: fromBase64(reply.base64),
      url: reply.url,
      redirects: reply.redirects,
      ...(reply.httpVersion ? { httpVersion: reply.httpVersion } : {}),
      timings: {
        startedAt,
        totalMs: reply.timings.totalMs,
        ...(reply.timings.ttfbMs === undefined ? {} : { ttfbMs: reply.timings.ttfbMs }),
      },
      headersRestricted: false,
    };
  }
}

/** `null` when the proxy is up and accepts the token, else a reason. */
export async function checkProxy(
  config: CorsProxyConfig,
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<string | null> {
  try {
    const response = await fetcher(endpoint(config, PROXY_HEALTH_PATH), {
      headers: { [PROXY_TOKEN_HEADER]: config.token },
    });
    if (response.ok) return null;
    if (response.status === 401) return 'The proxy rejected the token.';
    if (response.status === 403)
      return 'The proxy does not allow this origin (see --allow-origin).';
    return `The proxy answered ${response.status}.`;
  } catch {
    return `No proxy answers at ${config.url}.`;
  }
}

/** Proxy on/off for the web platform: the transport and capabilities follow it. */
export class WebCorsProxy implements CorsProxyControl {
  #config: CorsProxyConfig | null = null;
  readonly #listeners = new Set<() => void>();
  readonly #fetch: typeof fetch | undefined;

  constructor(opts: { fetch?: typeof fetch } = {}) {
    this.#fetch = opts.fetch;
  }

  get config(): CorsProxyConfig | null {
    return this.#config;
  }

  use(config: CorsProxyConfig | null): void {
    const next = config && config.url.trim() !== '' ? { ...config } : null;
    if (JSON.stringify(next) === JSON.stringify(this.#config)) return;
    this.#config = next;
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  check(config: CorsProxyConfig): Promise<string | null> {
    return checkProxy(config, this.#fetch);
  }
}
