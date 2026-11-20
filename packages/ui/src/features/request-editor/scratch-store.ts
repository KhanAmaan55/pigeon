import type {
  Auth,
  Body,
  BodyMode,
  EffectiveAuth,
  ExecutionPreferences,
  NewExample,
  ExecutionResult,
  KeyValue,
  Request,
  RequestSettings,
  VariableScopes,
} from '@pigeon/core';
import {
  createExecutionContext,
  createRequest,
  DEFAULT_PREFERENCES,
  emptyBody,
  exampleFromResponse,
  RequestExecutor,
  syncQueryIntoRaw,
  syncUrlFromRaw,
} from '@pigeon/core';
import type { Platform, ProjectFileSystem } from '@pigeon/platform';
import { createStore } from 'zustand';

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
}

export interface ScratchRequestState {
  /** The request in the editor: the scratch request, or a project request (see `RequestBinding`). */
  request: Request;
  /** The open project's files when the request belongs to one ("Pick from project folder"). */
  projectFs: ProjectFileSystem | null;
  /** See `RequestBinding.moveToSecret`; `null` for the scratch request. */
  moveToSecret: ((suggestedName: string, value: string) => string | null) | null;
  /** See `RequestBinding.inheritedAuth`; `null` for the scratch request (nothing to inherit). */
  inheritedAuth: (() => EffectiveAuth) | null;
  status: 'idle' | 'sending';
  /** Latest finished execution. */
  result: ExecutionResult | null;
  setMethod: (method: string) => void;
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
      saveAsExample: binding?.createExample
        ? ({ volatileHeaders }) => {
            const response = get().result?.response;
            if (!response || !binding.createExample) return null;
            const example = exampleFromResponse(get().request, response, {
              volatileHeaders,
              secretValues: lastSecrets,
            });
            binding.createExample(example);
            return example.id;
          }
        : null,
      status: 'idle',
      result: null,
      setMethod: (method) => update({ method: method.toUpperCase() }),
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
      send: async () => {
        inFlight?.abort();
        const controller = new AbortController();
        inFlight = controller;
        set({ status: 'sending' });
        const pageOrigin =
          platform.capabilities.transport === 'fetch' ? env.pageOrigin?.() : undefined;
        const inherited = get().request.auth ? undefined : binding?.inheritedAuth?.().auth;
        const ctx = createExecutionContext({
          capabilities: platform.capabilities,
          preferences: { ...(env.preferences?.() ?? DEFAULT_PREFERENCES) },
          ...(pageOrigin === undefined ? {} : { pageOrigin }),
          ...(binding ? { projectFs: binding.projectFs, projectId: binding.projectId } : {}),
          ...(binding?.scopes ? { scopes: binding.scopes() } : {}),
          ...(inherited === undefined ? {} : { inheritedAuth: inherited }),
        });
        let secrets: readonly string[] = [];
        const result = await executor.execute(get().request, ctx, {
          signal: controller.signal,
          onPrepared: (prepared) => (secrets = prepared.meta.secretValues),
        });
        if (inFlight !== controller) return; // superseded by a newer send
        inFlight = null;
        lastSecrets = secrets;
        set({ status: 'idle', result });
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
