/**
 * The script host contract (api-execution.md §9, PIGN-043): what a sandbox gets and returns.
 * Only JSON crosses the boundary (a Worker on the web and desktop, plain calls in Node), so the
 * sandbox never sees host objects.
 */

/** Variable scopes a script can read and write (values as strings, like Postman). */
export interface ScriptVariables {
  /** `null` when no environment is selected. */
  environment: Record<string, string> | null;
  collection: Record<string, string>;
  /** Folder variables (a Pigeon extension), merged outermost first; read-only for scripts. */
  folders: Record<string, string>;
  globals: Record<string, string>;
  /** Request-local variables (`pm.variables.set`): this send only. */
  local: Record<string, string>;
}

export interface ScriptHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

/** The request as a script sees and changes it. */
export interface ScriptRequest {
  method: string;
  url: string;
  headers: ScriptHeader[];
  /** The body mode, and its text for `raw` (other modes are read-only). */
  body: { mode: string; raw?: string };
}

export type ScriptScope = 'environment' | 'collection' | 'globals';

/** A variable change a script made (`value: null` = unset). */
export interface ScriptWrite {
  scope: ScriptScope;
  key: string;
  value: string | null;
}

export interface ScriptState {
  request: ScriptRequest;
  variables: ScriptVariables;
  info: { requestName: string; requestId: string; eventName: 'prerequest' | 'test' };
  /** Writes so far, in order (persisted as current values after the scripts ran). */
  writes: ScriptWrite[];
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

export interface ConsoleEntry {
  level: ConsoleLevel;
  /** Each argument, JSON-ish formatted. */
  message: string;
  /** Where the script runs, e.g. "folder Admin". */
  source: string;
  /** Epoch ms. */
  at: number;
}

export interface ScriptRunInput {
  code: string;
  state: ScriptState;
  /** Default `SCRIPT_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export type ScriptRunOutput =
  | { ok: true; state: ScriptState; logs: Array<Omit<ConsoleEntry, 'source'>> }
  | {
      ok: false;
      /** `timeout` when the script ran out of time; `error` for a thrown error. */
      reason: 'error' | 'timeout' | 'memory';
      message: string;
      logs: Array<Omit<ConsoleEntry, 'source'>>;
    };

/** Runs one script. Implementations: QuickJS in Node (`createQuickJsRunner`) or in a Worker. */
export interface ScriptRunner {
  run(input: ScriptRunInput): Promise<ScriptRunOutput>;
}

export const SCRIPT_TIMEOUT_MS = 5000;
/** QuickJS heap per script run. */
export const SCRIPT_MEMORY_BYTES = 64 * 1024 * 1024;
