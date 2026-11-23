/**
 * Optional self-hosted CORS proxy for the web version (PIGN-052, docs/platform.md §6.2.1): the
 * browser sends each request to a proxy the user runs (`@pigeon/cors-proxy`, `127.0.0.1` by
 * default), which performs it natively and answers with everything it got. Never a hosted service.
 */

/** Where the proxy listens and the token it printed on start. */
export interface CorsProxyConfig {
  /** Base URL, e.g. `http://127.0.0.1:8787`. */
  url: string;
  token: string;
}

/** Switches the web transport between `fetch` and a proxy (the active project's setting). */
export interface CorsProxyControl {
  readonly config: CorsProxyConfig | null;
  /** `null` turns proxy mode off. Capabilities follow. */
  use(config: CorsProxyConfig | null): void;
  subscribe(listener: () => void): () => void;
  /** `null` when the proxy answers and accepts the token; otherwise why not. */
  check(config: CorsProxyConfig): Promise<string | null>;
}

export const PROXY_TOKEN_HEADER = 'x-pigeon-proxy-token';
export const PROXY_FORWARD_PATH = '/v1/forward';
export const PROXY_HEALTH_PATH = '/v1/health';

/** Bodies cross as base64 so any bytes (and forbidden headers) survive the JSON envelope. */
export type ProxyBody =
  | { kind: 'bytes'; base64: string }
  | {
      kind: 'multipart';
      parts: Array<
        | { name: string; kind: 'text'; value: string; contentType?: string }
        | { name: string; kind: 'file'; filename: string; contentType?: string; base64: string }
      >;
    };

/** `POST /v1/forward` request body. */
export interface ProxyRequestEnvelope {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?: ProxyBody;
  settings: {
    timeoutMs: number;
    followRedirects: boolean;
    maxRedirects: number;
    strictSSL: boolean;
  };
}

/** `POST /v1/forward` answer: the response as received (`Set-Cookie` included), or an error. */
export type ProxyResponseEnvelope =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers: Array<[string, string]>;
      base64: string;
      url: string;
      redirects: Array<{ status: number; url: string; location: string }>;
      httpVersion?: string;
      timings: { totalMs: number; ttfbMs?: number };
    }
  | { ok: false; error: { kind: string; message: string; detail?: string } };
