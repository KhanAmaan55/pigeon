/**
 * Pre-request scripts (api-execution.md §9, PIGN-043): collection → folders (outermost first) →
 * request, each in the sandbox, sharing one state. Their changes to the request and to variables
 * apply to this send; variable writes are also returned so the caller saves them as **current
 * values** (local, never shared values). The first failing script stops the send.
 */

import { readScript } from '@pigeon/formats';

import type { ProjectModel } from '../model/project';
import type { KeyValue, Request } from '../model/request';
import { syncUrlFromRaw } from '../model/url';
import type { ScopedValue, VariableScopes } from '../variables/scopes';
import { itemAncestry } from '../variables/scopes';
import { findItem } from '../workspace/commands';
import type {
  ConsoleEntry,
  ScriptRunner,
  ScriptScope,
  ScriptState,
  ScriptVariables,
} from './types';

export interface ScriptSource {
  /** Where the script lives, e.g. "collection Users API", "folder Admin", "this request". */
  place: string;
  code: string;
}

function scriptOf(events: readonly unknown[], listen: 'prerequest' | 'test'): string | null {
  const script = readScript(events, listen);
  return script.index === -1 || script.disabled || script.text.trim() === '' ? null : script.text;
}

/** The `listen` scripts that run for `requestId`, in order. */
export function scriptChain(
  model: ProjectModel,
  requestId: string,
  listen: 'prerequest' | 'test',
): ScriptSource[] {
  const found = itemAncestry(model, requestId);
  const request = findItem(model, requestId);
  if (!found || request?.kind !== 'request') return [];
  const out: ScriptSource[] = [];
  const add = (place: string, events: readonly unknown[] | undefined) => {
    const code = scriptOf(events ?? [], listen);
    if (code !== null) out.push({ place, code });
  };
  add(`collection ${found.collection.name}`, found.collection.events);
  for (const folder of found.folders) add(`folder ${folder.name}`, folder.events);
  add('this request', request.events);
  return out;
}

/** A variable write to save as a current value (`value: null` = unset). */
export interface CurrentValueWrite {
  /** Local scope key: `env:<id>`, `collection:<id>` or `globals`. */
  scopeKey: string;
  key: string;
  value: string | null;
}

export type PreRequestOutcome =
  | {
      ok: true;
      request: Request;
      scopes: VariableScopes;
      writes: CurrentValueWrite[];
      logs: ConsoleEntry[];
    }
  | { ok: false; place: string; message: string; logs: ConsoleEntry[] };

const LAYER_OF: Record<ScriptScope, 'environment' | 'collection' | 'globals'> = {
  environment: 'environment',
  collection: 'collection',
  globals: 'globals',
};

function layerRecord(scopes: VariableScopes, kind: string): Record<string, string> | null {
  const layer = scopes.layers.find((l) => l.kind === kind);
  if (!layer) return null;
  return Object.fromEntries([...layer.values].map(([key, v]) => [key, v.value]));
}

export function scriptVariables(scopes: VariableScopes): ScriptVariables {
  const folders: Record<string, string> = {};
  // Layers are highest precedence first: merge folders innermost last.
  for (const layer of [...scopes.layers].reverse()) {
    if (layer.kind !== 'folder') continue;
    for (const [key, v] of layer.values) folders[key] = v.value;
  }
  return {
    environment: layerRecord(scopes, 'environment'),
    collection: layerRecord(scopes, 'collection') ?? {},
    folders,
    globals: layerRecord(scopes, 'globals') ?? {},
    local: layerRecord(scopes, 'local') ?? {},
  };
}

export function scriptRequest(request: Request): ScriptState['request'] {
  return {
    method: request.method,
    url: request.url.raw,
    headers: request.headers.map((h) => ({
      key: h.key,
      value: h.value,
      ...(h.disabled ? { disabled: true } : {}),
    })),
    body:
      request.body.mode === 'raw'
        ? { mode: 'raw', raw: request.body.raw }
        : { mode: request.body.mode },
  };
}

/** `request` with the script's changes (unchanged headers keep their descriptions). */
function applyRequest(request: Request, changed: ScriptState['request']): Request {
  const headers: KeyValue[] = changed.headers
    .map((h, i) => {
      const before = request.headers[i];
      const same = before && before.key === h.key;
      return {
        ...(same ? before : {}),
        key: h.key,
        value: h.value,
        ...(h.disabled ? { disabled: true } : { disabled: undefined }),
      };
    })
    .map(({ disabled, ...rest }) => (disabled ? { ...rest, disabled } : rest));
  return {
    ...request,
    method: changed.method.toUpperCase(),
    url: changed.url === request.url.raw ? request.url : syncUrlFromRaw(request.url, changed.url),
    headers,
    body:
      request.body.mode === 'raw' && changed.body.mode === 'raw'
        ? { ...request.body, raw: changed.body.raw ?? '' }
        : request.body,
  };
}

/** `scopes` with the script's writes and its request-local variables (on top). */
export function applyScopes(
  scopes: VariableScopes,
  variables: ScriptVariables,
  writes: ScriptState['writes'],
): { scopes: VariableScopes; persisted: CurrentValueWrite[] } {
  const layers = scopes.layers.map((layer) => ({ ...layer, values: new Map(layer.values) }));
  const persisted: CurrentValueWrite[] = [];
  for (const write of writes) {
    const kind = LAYER_OF[write.scope];
    let layer = layers.find((l) => l.kind === kind);
    if (!layer && kind === 'globals') {
      layer = { kind: 'globals', name: 'Globals', key: 'globals', values: new Map() };
      layers.push(layer);
    }
    if (!layer) continue;
    if (write.value === null) layer.values.delete(write.key);
    else {
      const before = layer.values.get(write.key);
      const value: ScopedValue = {
        value: write.value,
        secret: before?.secret ?? false,
        scope: layer.kind,
        scopeName: layer.name,
        scopeKey: layer.key,
      };
      layer.values.set(write.key, value);
    }
    persisted.push({ scopeKey: layer.key, key: write.key, value: write.value });
  }
  const local = Object.entries(variables.local);
  const withLocal =
    local.length === 0
      ? layers
      : [
          {
            kind: 'local' as const,
            name: 'Request',
            key: 'local',
            values: new Map(
              local.map(([key, value]): [string, ScopedValue] => [
                key,
                { value, secret: false, scope: 'local', scopeName: 'Request', scopeKey: 'local' },
              ]),
            ),
          },
          ...layers.filter((l) => l.kind !== 'local'),
        ];
  return { scopes: { layers: withLocal }, persisted };
}

/** Runs `scripts` in order for one send. */
export async function runPreRequestScripts(
  runner: ScriptRunner,
  scripts: readonly ScriptSource[],
  input: { request: Request; scopes: VariableScopes; requestName: string },
): Promise<PreRequestOutcome> {
  let state: ScriptState = {
    request: scriptRequest(input.request),
    variables: scriptVariables(input.scopes),
    info: { requestName: input.requestName, requestId: input.request.id, eventName: 'prerequest' },
    writes: [],
  };
  const logs: ConsoleEntry[] = [];
  for (const script of scripts) {
    const result = await runner.run({ code: script.code, state });
    logs.push(...result.logs.map((entry) => ({ ...entry, source: script.place })));
    if (!result.ok) {
      logs.push({
        level: 'error',
        message: result.message,
        source: script.place,
        at: Date.now(),
      });
      return { ok: false, place: script.place, message: result.message, logs };
    }
    state = result.state;
  }
  const { scopes, persisted } = applyScopes(input.scopes, state.variables, state.writes);
  return {
    ok: true,
    request: applyRequest(input.request, state.request),
    scopes,
    writes: persisted,
    logs,
  };
}
