import type { ExecutionResult, Request } from '@pigeon/core';
import { createExecutionContext, createRequest, RequestExecutor } from '@pigeon/core';
import type { Platform } from '@pigeon/platform';
import { createStore } from 'zustand';

export interface ScratchRequestState {
  /** The one ad-hoc request; in memory only until projects and tabs land (PIGN-016). */
  request: Request;
  status: 'idle' | 'sending';
  /** Latest finished execution. */
  result: ExecutionResult | null;
  setMethod: (method: string) => void;
  setUrl: (raw: string) => void;
  /** Raw text body; an empty body means no body. */
  setBodyText: (text: string) => void;
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
      setUrl: (raw) => update({ url: { ...get().request.url, raw } }),
      setBodyText: (text) =>
        update({
          body: text === '' ? { mode: 'none' } : { mode: 'raw', raw: text, language: 'text' },
        }),
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
