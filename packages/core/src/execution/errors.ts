/**
 * Turns a transport failure into the `ExecutionError` the UI shows (docs/api-execution.md §2,
 * §7.2). Transports only report a coarse kind plus raw detail; the titles and hints live here so
 * the web and desktop apps word every failure the same way.
 */

import { TransportError } from '@pigeon/platform';

import type { ExecutionError, ExecutionErrorKind } from './types';

/** What classification needs to know besides the failure itself. */
export interface ErrorContext {
  /** The URL that was requested. */
  url?: string;
  /**
   * Origin of the page the request was sent from (web only), e.g. `https://pigeon.example`.
   * Tells mixed content apart from CORS.
   */
  pageOrigin?: string;
  /** The timeout that applied, in ms (`0` = none). */
  timeoutMs?: number;
}

/** A short heading per kind, for the error card. */
export const ERROR_TITLES: Readonly<Record<ExecutionErrorKind, string>> = Object.freeze({
  network: 'Network error',
  timeout: 'Request timed out',
  aborted: 'Cancelled',
  'cors-suspected': 'Blocked by the browser (CORS?)',
  'mixed-content': 'Blocked: mixed content',
  tls: 'TLS / certificate error',
  dns: 'Host not found',
  'connection-refused': 'Connection refused',
  'invalid-url': 'Invalid URL',
  'invalid-request': 'Invalid request',
  'file-unavailable': 'File unavailable',
  unknown: 'Request failed',
});

/** Default message per kind, used when the transport gave none worth showing. */
const MESSAGES: Readonly<Record<ExecutionErrorKind, string>> = {
  network: 'The request failed.',
  timeout: 'The request timed out.',
  aborted: 'The request was cancelled.',
  'cors-suspected': 'The request was blocked or could not reach the server.',
  'mixed-content': 'The browser blocked an http:// request from this https:// page.',
  tls: 'The TLS connection could not be established.',
  dns: 'The host name could not be resolved.',
  'connection-refused': 'The server refused the connection.',
  'invalid-url': 'The URL is not valid.',
  'invalid-request': 'The request is not valid.',
  'file-unavailable': 'A file in the request body could not be read.',
  unknown: 'The request failed.',
};

export const CORS_HINT =
  'Browsers only let a web page read responses from another origin when the server allows it ' +
  'with CORS headers such as Access-Control-Allow-Origin. ' +
  'The browser does not say why a request failed, so this can also be the network being down, ' +
  'a host name that does not resolve, or an untrusted TLS certificate. ' +
  'Use the Pigeon desktop app, which is not subject to CORS, or enable CORS for this origin on ' +
  'the server.';

export const MIXED_CONTENT_HINT =
  'Browsers block plain http:// requests from pages served over https://, except to localhost. ' +
  'Run Pigeon web locally (http://localhost), use the desktop app, or call the API over https://.';

const HINTS: Readonly<Partial<Record<ExecutionErrorKind, string>>> = {
  network:
    'Check that the server is running and reachable, and that no proxy or firewall is in the way.',
  timeout:
    'The server did not answer in time. Increase the timeout in the Settings tab (0 = no timeout).',
  'cors-suspected': CORS_HINT,
  'mixed-content': MIXED_CONTENT_HINT,
  tls:
    'The certificate may be self-signed, expired or issued for another host. If you trust this ' +
    'server, turn off "Verify TLS certificates" in the Settings tab.',
  dns: 'Check the host name for typos, and that you are connected to the right network or VPN.',
  'connection-refused':
    'Nothing is listening on that host and port. Check that the server is running and the port is right.',
};

/** Hosts a browser treats as potentially trustworthy even over http:// (no mixed-content block). */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/** An `https:` page requesting a non-loopback `http:` URL, which browsers block. */
export function isMixedContent(pageOrigin: string | undefined, url: string | undefined): boolean {
  if (pageOrigin === undefined || url === undefined) return false;
  if (!URL.canParse(pageOrigin) || !URL.canParse(url)) return false;
  const target = new URL(url);
  return (
    new URL(pageOrigin).protocol === 'https:' &&
    target.protocol === 'http:' &&
    !isLoopbackHost(target.hostname)
  );
}

/** A failure as transports report it (`TransportError` or the same shape). */
export interface RawFailure {
  kind: ExecutionErrorKind;
  message?: string;
  detail?: string;
  hint?: string;
}

/**
 * Refines a transport failure with its context and adds the shared wording: `cors-suspected`
 * from an https page to an http URL becomes `mixed-content`; timeouts name their limit; every
 * kind gets its standard hint unless the transport gave a more specific one.
 */
export function classifyError(failure: RawFailure, ctx: ErrorContext = {}): ExecutionError {
  let { kind } = failure;
  let message = failure.message?.trim() || MESSAGES[kind];
  let hint = failure.hint;

  if (kind === 'cors-suspected' && isMixedContent(ctx.pageOrigin, ctx.url)) {
    kind = 'mixed-content';
    message = MESSAGES['mixed-content'];
    hint = undefined;
  }
  if (kind === 'timeout' && ctx.timeoutMs !== undefined && ctx.timeoutMs > 0) {
    message = `The request timed out after ${formatTimeout(ctx.timeoutMs)}.`;
  }
  hint ??= HINTS[kind];

  return {
    kind,
    message,
    ...(failure.detail === undefined ? {} : { detail: failure.detail }),
    ...(hint === undefined ? {} : { hint }),
  };
}

/** Any thrown value → `ExecutionError`. An aborted `signal` always means cancelled. */
export function toExecutionError(
  error: unknown,
  signal?: AbortSignal,
  ctx: ErrorContext = {},
): ExecutionError {
  if (signal?.aborted) return { kind: 'aborted', message: MESSAGES.aborted };
  if (error instanceof TransportError) {
    return classifyError(
      {
        kind: error.kind,
        message: error.message,
        ...(error.detail === undefined ? {} : { detail: error.detail }),
        ...(error.hint === undefined ? {} : { hint: error.hint }),
      },
      ctx,
    );
  }
  const detail = error instanceof Error ? error.message : String(error);
  return classifyError({ kind: 'unknown', detail }, ctx);
}

function formatTimeout(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}
