/** Execution types shared by every platform (docs/api-execution.md §2). */

import type { Auth } from '../model/auth';
import type { DynamicGenerators, VariableScopes } from '../variables/index';
import type {
  Capabilities,
  Id,
  ProjectFileSystem,
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
  /**
   * Origin of the page requests are sent from, when that matters (web: an https page cannot
   * call http APIs). Used to classify errors only.
   */
  pageOrigin?: string;
  /** The open project's files, for project-relative file references in bodies. */
  projectFs?: ProjectFileSystem;
  /** Variables (PIGN-023); none for the scratch request. */
  scopes?: VariableScopes;
  /** Dynamic variable generators (tests make them deterministic). */
  generators?: DynamicGenerators;
  /** Auth from the request's ancestors, used when the request has none (PIGN-026). */
  inheritedAuth?: Auth;
  /** Where scripts exist that this send does not run (PIGN-031): a warning on the result. */
  skippedScripts?: string[];
}

export function createExecutionContext(
  init: Partial<ExecutionContext> & { capabilities: Readonly<Capabilities> },
): ExecutionContext {
  return {
    projectId: init.projectId ?? null,
    environmentId: init.environmentId ?? null,
    preferences: init.preferences ?? { ...DEFAULT_PREFERENCES },
    capabilities: init.capabilities,
    ...(init.pageOrigin === undefined ? {} : { pageOrigin: init.pageOrigin }),
    ...(init.projectFs === undefined ? {} : { projectFs: init.projectFs }),
    ...(init.scopes === undefined ? {} : { scopes: init.scopes }),
    ...(init.generators === undefined ? {} : { generators: init.generators }),
    ...(init.inheritedAuth === undefined ? {} : { inheritedAuth: init.inheritedAuth }),
    ...(init.skippedScripts === undefined ? {} : { skippedScripts: init.skippedScripts }),
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
  /** A secret too short to mask was sent: never store this result (PIGN-025). */
  containsUnmaskedSecrets?: boolean;
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
