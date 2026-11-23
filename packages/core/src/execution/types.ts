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
import type { CurrentValueWrite, ScriptSource } from '../scripting/prerequest';
import type { CookieJar } from '../cookies/jar';
import type { OAuthTokenStore } from './auth/oauth2';
import type { TestRun } from '../scripting/tests';
import type { ConsoleEntry, ScriptRunner } from '../scripting/types';
import type { SkippedScriptsReason } from './scripts';

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
  skippedScriptsReason?: SkippedScriptsReason;
  /**
   * Pre-request scripts to run before the request is prepared (PIGN-043). Their request and
   * variable changes apply to this send; `onWrites` saves variable writes as current values.
   */
  preRequest?: {
    runner: ScriptRunner;
    scripts: readonly ScriptSource[];
    requestName: string;
    onWrites?: (writes: CurrentValueWrite[]) => void;
    onLogs?: (entries: ConsoleEntry[]) => void;
  };
  /**
   * The project's cookie jar (PIGN-045): a `Cookie` header is added from it (unless the request
   * sets one or has `disableCookies`) and `Set-Cookie` is stored where the platform can read it
   * (`canReadAllResponseHeaders`). `onChange` runs when the jar changed.
   */
  cookies?: { jar: CookieJar; onChange?: () => void };
  /** The project's OAuth 2.0 token cache (PIGN-047); without it tokens last one send. */
  oauth2?: OAuthTokenStore;
  /** Test scripts to run after a response (PIGN-044); same callbacks as `preRequest`. */
  tests?: {
    runner: ScriptRunner;
    scripts: readonly ScriptSource[];
    requestName: string;
    onWrites?: (writes: CurrentValueWrite[]) => void;
    onLogs?: (entries: ConsoleEntry[]) => void;
  };
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
    ...(init.skippedScriptsReason === undefined
      ? {}
      : { skippedScriptsReason: init.skippedScriptsReason }),
    ...(init.preRequest === undefined ? {} : { preRequest: init.preRequest }),
    ...(init.tests === undefined ? {} : { tests: init.tests }),
    ...(init.cookies === undefined ? {} : { cookies: init.cookies }),
    ...(init.oauth2 === undefined ? {} : { oauth2: init.oauth2 }),
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
  /** Results of the test scripts (PIGN-044); absent when none ran. Secrets masked. */
  tests?: TestRun;
}
