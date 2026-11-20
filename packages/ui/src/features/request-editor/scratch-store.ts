import type {
  Body,
  BodyMode,
  ExecutionPreferences,
  ExecutionResult,
  KeyValue,
  Request,
  RequestSettings,
} from '@pigeon/core';
import {
  createExecutionContext,
  createRequest,
  DEFAULT_PREFERENCES,
  emptyBody,
  RequestExecutor,
  syncQueryIntoRaw,
  syncUrlFromRaw,
} from '@pigeon/core';
import type { ProjectRequest } from '@pigeon/core';
import type { Platform, ProjectFileSystem } from '@pigeon/platform';
import { createStore } from 'zustand';

/** Where the request in the editor came from, when it was opened from a project. */
export interface RequestSource {
  projectId: string;
  projectName: string;
  /** Project path of the request file. */
  filePath: string;
}

export interface ScratchRequestState {
  /**
   * The request in the editor: the ad-hoc scratch request, or a copy of a project request
   * (`source`). Edits stay in memory until tabs and saving land (PIGN-016/018).
   */
  request: Request;
  source: RequestSource | null;
  /** Shows a copy of a project request; sends resolve project file references through `fs`. */
  openProjectRequest: (
    request: ProjectRequest,
    source: RequestSource,
    fs: ProjectFileSystem,
  ) => void;
  /** Back to a fresh scratch request (e.g. when the project closes). */
  openScratch: () => void;
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
) {
  const executor = new RequestExecutor(
    platform.transport,
    platform.pickedFiles ? { pickedFiles: platform.pickedFiles } : {},
  );
  let inFlight: AbortController | null = null;
  let projectFs: ProjectFileSystem | undefined;
  const fresh = () => {
    inFlight?.abort();
    inFlight = null;
    return { status: 'idle' as const, result: null, bodyDrafts: {} };
  };

  return createStore<ScratchRequestState>()((set, get) => {
    const update = (patch: Partial<Request>) => set({ request: { ...get().request, ...patch } });

    return {
      request: createRequest({ name: 'Scratch request' }),
      source: null,
      openProjectRequest: (projectRequest, source, fs) => {
        projectFs = fs;
        // The editor model has no auth/scripts yet (PIGN-026/031); they stay in the file.
        const { auth: _auth, events: _events, broken: _broken, ...request } = projectRequest;
        set({ ...fresh(), request: structuredClone(request), source });
      },
      openScratch: () => {
        projectFs = undefined;
        set({ ...fresh(), request: createRequest({ name: 'Scratch request' }), source: null });
      },
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
      bodyDrafts: {},
      setBody: (body) => update({ body }),
      setBodyMode: (mode) => {
        const { request, bodyDrafts } = get();
        const current = request.body;
        if (current.mode === mode) return;
        set({
          bodyDrafts: { ...bodyDrafts, [current.mode]: current },
          request: { ...request, body: bodyDrafts[mode] ?? emptyBody(mode) },
        });
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
        const ctx = createExecutionContext({
          capabilities: platform.capabilities,
          preferences: { ...(env.preferences?.() ?? DEFAULT_PREFERENCES) },
          ...(pageOrigin === undefined ? {} : { pageOrigin }),
          ...(projectFs === undefined
            ? {}
            : { projectFs, projectId: get().source?.projectId ?? null }),
        });
        const result = await executor.execute(get().request, ctx, { signal: controller.signal });
        if (inFlight !== controller) return; // superseded by a newer send
        inFlight = null;
        set({ status: 'idle', result });
      },
      cancel: () => {
        inFlight?.abort(new DOMException('The request was cancelled.', 'AbortError'));
      },
    };
  });
}
