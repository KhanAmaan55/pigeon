/** Execution types shared by every platform (docs/api-execution.md §2). */

import type {
  Capabilities,
  Id,
  RawResponse,
  RequestSettings,
  TransportErrorKind,
} from '@pigeon/platform';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type ExecutionPreferences = RequestSettings;

export const DEFAULT_PREFERENCES: Readonly<ExecutionPreferences> = Object.freeze({
  timeoutMs: 30_000,
  followRedirects: true,
  maxRedirects: 10,
  strictSSL: true,
});

/**
 * Everything a request needs from its surroundings. Variable scopes join with PIGN-023;
 * `projectId` is `null` for scratch requests that belong to no project.
 */
export interface ExecutionContext {
  projectId: Id | null;
  environmentId: Id | null;
  preferences: ExecutionPreferences;
  capabilities: Readonly<Capabilities>;
}

export function createExecutionContext(
  init: Partial<ExecutionContext> & { capabilities: Readonly<Capabilities> },
): ExecutionContext {
  return {
    projectId: init.projectId ?? null,
    environmentId: init.environmentId ?? null,
    preferences: init.preferences ?? { ...DEFAULT_PREFERENCES },
    capabilities: init.capabilities,
  };
}

export type ExecutionErrorKind = TransportErrorKind;

export interface ExecutionError {
  kind: ExecutionErrorKind;
  message: string;
  /** Raw transport error. */
  detail?: string;
  /** User-facing guidance. */
  hint?: string;
}

/** Cookies (`cookies: ParsedSetCookie[]`) join with the cookie jar in PIGN-045. */
export interface NormalizedResponse extends RawResponse {
  /** Media type, lowercased, without parameters. */
  contentType?: string;
  /** Set when the body is textual (charset from the header, UTF-8 by default). */
  bodyText?: string;
  /** Parsed when the media type is JSON (or `+json`) and parsing succeeds. */
  json?: unknown;
  sizeBytes: number;
}

export interface ExecutionResult {
  id: Id;
  requestId?: Id;
  environmentId: Id | null;
  /** ISO timestamp. */
  startedAt: string;
  transport: Capabilities['transport'];
  /** What was (or would have been) sent; secrets masked. */
  request: {
    method: string;
    url: string;
    headers: Array<[string, string]>;
    bodyPreview?: string;
  };
  /** Absent on error. */
  response?: NormalizedResponse;
  error?: ExecutionError;
  /** Unresolved variables, dropped forbidden headers, … */
  warnings: string[];
}
