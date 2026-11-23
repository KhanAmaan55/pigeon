import type {
  Auth,
  Body,
  BodyMode,
  ComparisonOutcome,
  ConsoleEntry,
  CookieJar,
  CurrentValueWrite,
  OAuthTokenStore,
  EffectiveAuth,
  ExecutionPreferences,
  NewExample,
  ProjectComparisonConfig,
  ProjectExample,
  ProjectFieldRule,
  ExecutionResult,
  KeyValue,
  Request,
  RequestSettings,
  ScriptRunner,
  ScriptSource,
  SkippedScriptsReason,
  VariableScopes,
} from '@pigeon/core';
import {
  createExecutionContext,
  createRequest,
  DEFAULT_PREFERENCES,
  acceptedExamplePatch,
  emptyBody,
  exampleFromResponse,
  requestFromCurl,
  RequestExecutor,
  syncQueryIntoRaw,
  syncUrlFromRaw,
} from '@pigeon/core';
import type { Platform, ProjectFileSystem } from '@pigeon/platform';
import { parseCurl } from '@pigeon/formats';
import { createStore } from 'zustand';

import { workerScriptRunner } from '../scripts/run-script';

/**
 * Ties an editor to a project request (PIGN-016): edits go to `ProjectSession.apply`, and the
 * editor follows the session's working model. Without a binding the editor owns its request
 * (the scratch request).
 */
export interface RequestBinding {
  /** The request as the working model has it now. */
  read(): Request;
  /** Applies an edited request (an in-memory edit; the entity becomes unsaved). */
  commit(request: Request): void;
  /** Called on every working-model change. */
  subscribe(listener: () => void): () => void;
  projectId: string;
  /** For project-relative file references. */
  projectFs: ProjectFileSystem;
  /** Variables of the selected environment etc., built at send time (PIGN-023). */
  scopes?: () => VariableScopes;
  /**
   * "Move to a secret variable" (PIGN-025): creates a secret variable holding `value` as its
   * (local) current value and returns its name, or `null` when the project can't.
   */
  moveToSecret?: (suggestedName: string, value: string) => string | null;
  /** The auth the request inherits from its folders and collection now (PIGN-026). */
  inheritedAuth?: () => EffectiveAuth;
  /** Adds an example to the request (PIGN-027). */
  createExample?: (example: NewExample) => void;
  /** The request's scripts (`event[]`) and their editing (PIGN-031). */
  events?: () => unknown[];
  setEvents?: (events: unknown[]) => void;
  /** Where scripts exist that a send skips (the request, its folders, its collection), and why. */
  skippedScripts?: () => string[];
  skippedScriptsReason?: () => SkippedScriptsReason;
  /**
   * Pre-request scripts to run on send (PIGN-043), `null` when none run; their variable writes
   * go to `onScriptWrites` (current values) and console output to `onScriptLogs`.
   */
  preRequest?: () => { scripts: ScriptSource[]; requestName: string } | null;
  /** The project's OAuth 2.0 token cache (PIGN-047). */
  oauth2?: () => OAuthTokenStore;
  /** The project's cookie jar (PIGN-045) and how to save it after a response changed it. */
  cookies?: () => { jar: CookieJar; onChange: () => void };
  /** Test scripts to run after the response (PIGN-044), `null` when none run. */
  tests?: () => { scripts: ScriptSource[]; requestName: string } | null;
  onScriptWrites?: (writes: CurrentValueWrite[]) => void;
  onScriptLogs?: (entries: ConsoleEntry[]) => void;
  /** Compares a result with the request's baseline example (PIGN-034). */
  compare?: (result: ExecutionResult) => Promise<ComparisonOutcome | undefined>;
  /** Adds (or merges) a field rule in the request's `compare.json` (PIGN-035). */
  addRule?: (rule: ProjectFieldRule) => void;
  /** The request's rules and the project's (read-only here), and replacing the request's. */
  rules?: () => { request: ProjectFieldRule[]; project: ProjectFieldRule[] };
  setRules?: (rules: ProjectFieldRule[]) => void;
  /** Replaces an example's response with the actual one ("Accept as new baseline", PIGN-037). */
  acceptBaseline?: (exampleId: string, patch: Pick<ProjectExample, 'request' | 'response'>) => void;
  /** The request's baseline mode, and setting it (`compare.json` `baseline`). */
  baseline?: () => BaselineMode;
  setBaseline?: (baseline: BaselineMode) => void;
  /** The request's own status / headers / body comparison settings (PIGN-036). */
  overrides?: () => ComparisonOverrides;
  setOverrides?: (patch: ComparisonOverrides) => void;
}

export type BaselineMode = NonNullable<ProjectComparisonConfig['baseline']>;

/** What `compare.json` overrides besides rules; `undefined` removes a section. */
export interface ComparisonOverrides {
  status?: string | undefined;
  headers?: Record<string, unknown> | undefined;
  body?: Record<string, unknown> | undefined;
}

/** The comparison of the latest result. */
export type ComparisonState =
  { status: 'running' } | { status: 'done'; outcome: ComparisonOutcome } | null;

export interface ScratchRequestState {
  /** The request in the editor: the scratch request, or a project request (see `RequestBinding`). */
  request: Request;
  /** The open project's files when the request belongs to one ("Pick from project folder"). */
  projectFs: ProjectFileSystem | null;
  /** See `RequestBinding.moveToSecret`; `null` for the scratch request. */
  moveToSecret: ((suggestedName: string, value: string) => string | null) | null;
  /** See `RequestBinding.inheritedAuth`; `null` for the scratch request (nothing to inherit). */
  inheritedAuth: (() => EffectiveAuth) | null;
  /** Scripts of a project request (`null` for the scratch request, which has none). */
  scripts: { read: () => unknown[]; write: (events: unknown[]) => void } | null;
  status: 'idle' | 'sending';
  /** Latest finished execution. */
  result: ExecutionResult | null;
  setMethod: (method: string) => void;
  /**
   * Replaces method, URL, headers, body and settings (and auth, when it has `-u`) with a cURL
   * command's (PIGN-050). Returns the parser's warnings, or `null` when it is not cURL.
   */
  applyCurl: (text: string) => string[] | null;
  /** Typed URL; query and path variable rows follow it. */
  setUrl: (raw: string) => void;
  /** Query table edit; the URL follows (disabled rows stay out of it). */
  setQuery: (query: KeyValue[]) => void;
  setPathVariables: (pathVariables: KeyValue[]) => void;
  setHeaders: (headers: KeyValue[]) => void;
  /** `undefined` = inherit from the parent (project requests) or no auth (scratch). */
  setAuth: (auth: Auth | undefined) => void;
  /**
   * Bodies of the modes the user switched away from, so switching back restores them (Postman
   * behaviour). Editor state only: the request holds just the active mode.
   */
  bodyDrafts: Partial<Record<BodyMode, Body>>;
  setBody: (body: Body) => void;
  /** Switches the body mode, keeping the current mode's content in `bodyDrafts`. */
  setBodyMode: (mode: BodyMode) => void;
  /** `undefined` resets a setting to the preference default. */
  setSettings: (patch: Partial<RequestSettings>) => void;
  /**
   * Saves the latest response as an example of the request (project requests only): the
   * request definition, the response without `volatileHeaders`, with the secrets the send
   * resolved masked. Returns the new example's id, or `null` when there is nothing to save.
   */
  saveAsExample: ((options: { volatileHeaders: readonly string[] }) => string | null) | null;
  comparison: ComparisonState;
  /** Re-runs the comparison of the latest result (project requests only). */
  compare: (() => Promise<void>) | null;
  /**
   * Accepts the latest response as the new baseline (the example the comparison used), with
   * the volatile headers left out and the send's secrets masked; compares again.
   */
  acceptBaseline: ((options: { volatileHeaders: readonly string[] }) => boolean) | null;
  /** The baseline mode (auto / pinned example / disabled) and changing it; compares again. */
  baselineMode: { read: () => BaselineMode; write: (baseline: BaselineMode) => void } | null;
  /** Adds a field rule (from a finding's action), then compares again. */
  addRule: ((rule: ProjectFieldRule) => void) | null;
  /** The rules panel: request rules (editable) and project rules; edits compare again. */
  rules: {
    read: () => { request: ProjectFieldRule[]; project: ProjectFieldRule[] };
    write: (rules: ProjectFieldRule[]) => void;
    overrides: () => ComparisonOverrides;
    setOverrides: (patch: ComparisonOverrides) => void;
  } | null;
  /** Shows a result produced elsewhere (a run) as the latest one, with its comparison. */
  showResult: (
    result: ExecutionResult,
    comparison: ComparisonOutcome | undefined,
    secrets: readonly string[],
  ) => void;
  /** Sends the request; a send while one is in flight cancels and supersedes it. */
  send: () => Promise<void>;
  /** Cancels the in-flight request; its result becomes a quiet "Cancelled". */
  cancel: () => void;
}

export type ScratchRequestStore = ReturnType<typeof createScratchRequestStore>;

export interface ScratchRequestEnvironment {
  /** Current app preferences (default timeout, …); `DEFAULT_PREFERENCES` when absent. */
  preferences?: () => ExecutionPreferences | undefined;
  /** Origin of the page requests are sent from, for error classification (mixed content). */
  pageOrigin?: () => string | undefined;
  /** Compare with the baseline after every send (default on). */
  autoCompare?: () => boolean;
  /** Runs pre-request scripts (PIGN-043); the Worker-based runner by default. */
  scriptRunner?: ScriptRunner;
}

export function createScratchRequestStore(
  platform: Pick<Platform, 'transport' | 'capabilities'> & Partial<Pick<Platform, 'pickedFiles'>>,
  env: ScratchRequestEnvironment = {},
  binding?: RequestBinding,
) {
  const executor = new RequestExecutor(
    platform.transport,
    platform.pickedFiles ? { pickedFiles: platform.pickedFiles } : {},
  );
  let inFlight: AbortController | null = null;
  /** Secret values the latest send resolved: in memory only, for masking saved examples. */
  let lastSecrets: readonly string[] = [];

  const store = createStore<ScratchRequestState>()((set, get) => {
    const setRequest = (request: Request, extra: Partial<ScratchRequestState> = {}) => {
      set({ ...extra, request });
      binding?.commit(request);
    };
    const update = (patch: Partial<Request>) => setRequest({ ...get().request, ...patch });

    return {
      request: binding ? binding.read() : createRequest({ name: 'Scratch request' }),
      projectFs: binding?.projectFs ?? null,
      moveToSecret: binding?.moveToSecret ?? null,
      inheritedAuth: binding?.inheritedAuth ?? null,
      scripts:
        binding?.events && binding.setEvents
          ? { read: binding.events, write: binding.setEvents }
          : null,
      saveAsExample: binding?.createExample
        ? ({ volatileHeaders }) => {
            const response = get().result?.response;
            if (!response || !binding.createExample) return null;
            const example = exampleFromResponse(get().request, response, {
              volatileHeaders,
              secretValues: lastSecrets,
            });
            binding.createExample(example);
            // The new example may be the baseline now.
            void get().compare?.();
            return example.id;
          }
        : null,
      status: 'idle',
      result: null,
      comparison: null,
      acceptBaseline: binding?.acceptBaseline
        ? ({ volatileHeaders }) => {
            const { comparison, result, request } = get();
            if (
              comparison?.status !== 'done' ||
              comparison.outcome.kind !== 'compared' ||
              !result?.response
            ) {
              return false;
            }
            binding.acceptBaseline!(
              comparison.outcome.result.exampleId,
              acceptedExamplePatch(request, result.response, {
                volatileHeaders,
                secretValues: lastSecrets,
              }),
            );
            void get().compare?.();
            return true;
          }
        : null,
      baselineMode:
        binding?.baseline && binding.setBaseline
          ? {
              read: binding.baseline,
              write: (baseline) => {
                binding.setBaseline!(baseline);
                void get().compare?.();
              },
            }
          : null,
      addRule: binding?.addRule
        ? (rule) => {
            binding.addRule!(rule);
            void get().compare?.();
          }
        : null,
      rules:
        binding?.rules && binding.setRules
          ? {
              read: binding.rules,
              write: (rules) => {
                binding.setRules!(rules);
                void get().compare?.();
              },
              overrides: binding.overrides ?? (() => ({})),
              setOverrides: (patch) => {
                binding.setOverrides?.(patch);
                void get().compare?.();
              },
            }
          : null,
      compare: binding?.compare
        ? async () => {
            const result = get().result;
            if (!result?.response || !binding.compare) return;
            set({ comparison: { status: 'running' } });
            const outcome = await binding.compare(result);
            // A newer send replaced the result meanwhile: its own comparison wins.
            if (get().result !== result) return;
            set({ comparison: outcome ? { status: 'done', outcome } : null });
          }
        : null,
      setMethod: (method) => update({ method: method.toUpperCase() }),
      applyCurl: (text) => {
        const parsed = parseCurl(text);
        if (!parsed.ok) return null;
        const fields = requestFromCurl(parsed.request);
        const { auth: _previous, ...rest } = get().request;
        setRequest(
          {
            ...rest,
            method: fields.method,
            url: fields.url,
            headers: fields.headers,
            body: fields.body,
            settings: fields.settings,
            ...(fields.auth ? { auth: fields.auth } : _previous ? { auth: _previous } : {}),
          },
          { bodyDrafts: {} },
        );
        return parsed.request.warnings;
      },
      setUrl: (raw) => update({ url: syncUrlFromRaw(get().request.url, raw) }),
      setQuery: (query) => {
        const { url } = get().request;
        update({ url: { ...url, raw: syncQueryIntoRaw(url.raw, query), query } });
      },
      setPathVariables: (pathVariables) => update({ url: { ...get().request.url, pathVariables } }),
      setHeaders: (headers) => update({ headers }),
      setAuth: (auth) => {
        const { auth: _previous, ...rest } = get().request;
        setRequest(auth === undefined ? rest : { ...rest, auth });
      },
      bodyDrafts: {},
      setBody: (body) => update({ body }),
      setBodyMode: (mode) => {
        const { request, bodyDrafts } = get();
        const current = request.body;
        if (current.mode === mode) return;
        setRequest(
          { ...request, body: bodyDrafts[mode] ?? emptyBody(mode) },
          { bodyDrafts: { ...bodyDrafts, [current.mode]: current } },
        );
      },
      setSettings: (patch) => {
        const settings: Record<string, unknown> = { ...get().request.settings, ...patch };
        for (const [key, value] of Object.entries(settings)) {
          if (value === undefined) delete settings[key];
        }
        update({ settings: settings as RequestSettings });
      },
      showResult: (result, comparison, secrets) => {
        lastSecrets = secrets;
        set({ result, comparison: comparison ? { status: 'done', outcome: comparison } : null });
      },
      send: async () => {
        inFlight?.abort();
        const controller = new AbortController();
        inFlight = controller;
        set({ status: 'sending' });
        const pageOrigin =
          platform.capabilities.transport === 'fetch' ? env.pageOrigin?.() : undefined;
        const inherited = get().request.auth ? undefined : binding?.inheritedAuth?.().auth;
        const preRequest = binding?.preRequest?.();
        const tests = binding?.tests?.();
        const cookies = binding?.cookies?.();
        const ctx = createExecutionContext({
          capabilities: platform.capabilities,
          preferences: { ...(env.preferences?.() ?? DEFAULT_PREFERENCES) },
          ...(pageOrigin === undefined ? {} : { pageOrigin }),
          ...(binding ? { projectFs: binding.projectFs, projectId: binding.projectId } : {}),
          ...(binding?.scopes ? { scopes: binding.scopes() } : {}),
          ...(inherited === undefined ? {} : { inheritedAuth: inherited }),
          ...(binding?.skippedScripts ? { skippedScripts: binding.skippedScripts() } : {}),
          ...(binding?.skippedScriptsReason
            ? { skippedScriptsReason: binding.skippedScriptsReason() }
            : {}),
          ...(preRequest
            ? {
                preRequest: {
                  runner: env.scriptRunner ?? workerScriptRunner,
                  scripts: preRequest.scripts,
                  requestName: preRequest.requestName,
                  ...(binding?.onScriptWrites ? { onWrites: binding.onScriptWrites } : {}),
                  ...(binding?.onScriptLogs ? { onLogs: binding.onScriptLogs } : {}),
                },
              }
            : {}),
          ...(cookies ? { cookies } : {}),
          ...(binding?.oauth2 ? { oauth2: binding.oauth2() } : {}),
          ...(tests
            ? {
                tests: {
                  runner: env.scriptRunner ?? workerScriptRunner,
                  scripts: tests.scripts,
                  requestName: tests.requestName,
                  ...(binding?.onScriptWrites ? { onWrites: binding.onScriptWrites } : {}),
                  ...(binding?.onScriptLogs ? { onLogs: binding.onScriptLogs } : {}),
                },
              }
            : {}),
        });
        let secrets: readonly string[] = [];
        const result = await executor.execute(get().request, ctx, {
          signal: controller.signal,
          onPrepared: (prepared) => (secrets = prepared.meta.secretValues),
        });
        if (inFlight !== controller) return; // superseded by a newer send
        inFlight = null;
        lastSecrets = secrets;
        set({ status: 'idle', result, comparison: null });
        if (env.autoCompare?.() !== false) void get().compare?.();
      },
      cancel: () => {
        inFlight?.abort(new DOMException('The request was cancelled.', 'AbortError'));
      },
    };
  });

  // Follow the working model (e.g. after Discard or a reload).
  const unsubscribe = binding?.subscribe(() => {
    const next = binding.read();
    if (next !== store.getState().request) store.setState({ request: next });
  });
  return Object.assign(store, {
    /** Stops following the session and cancels an in-flight send. */
    dispose: () => {
      unsubscribe?.();
      inFlight?.abort();
    },
  });
}
