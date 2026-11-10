import type {
  Body,
  BodyMode,
  ExecutionResult,
  KeyValue,
  Request,
  RequestSettings,
} from '@pigeon/core';
import {
  createExecutionContext,
  createRequest,
  emptyBody,
  RequestExecutor,
  syncQueryIntoRaw,
  syncUrlFromRaw,
} from '@pigeon/core';
import type { Platform } from '@pigeon/platform';
import { createStore } from 'zustand';

export interface ScratchRequestState {
  /** The one ad-hoc request; in memory only until projects and tabs land (PIGN-016). */
  request: Request;
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
  /** Sends the request; a send while one is in flight supersedes it. */
  send: () => Promise<void>;
}

export type ScratchRequestStore = ReturnType<typeof createScratchRequestStore>;

export function createScratchRequestStore(platform: Pick<Platform, 'transport' | 'capabilities'>) {
  const executor = new RequestExecutor(platform.transport);
  let inFlight: AbortController | null = null;

  return createStore<ScratchRequestState>()((set, get) => {
    const update = (patch: Partial<Request>) => set({ request: { ...get().request, ...patch } });

    return {
      request: createRequest({ name: 'Scratch request' }),
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
        const ctx = createExecutionContext({ capabilities: platform.capabilities });
        const result = await executor.execute(get().request, ctx, { signal: controller.signal });
        if (inFlight !== controller) return; // superseded by a newer send
        inFlight = null;
        set({ status: 'idle', result });
      },
    };
  });
}
