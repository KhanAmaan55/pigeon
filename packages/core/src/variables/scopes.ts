/**
 * Variable scopes (docs/data-model.md §5): highest precedence first — request-local (scripts,
 * later) → iteration data (later) → environment → collection → globals. Each variable's
 * effective value is its current value (local) if set, else its shared value.
 */

import type { ProjectEnvVariable } from '@pigeon/formats';

import type { ProjectModel } from '../model/project';

export type ScopeKind = 'environment' | 'collection' | 'folder' | 'globals';

export interface ScopedValue {
  value: string;
  secret: boolean;
  scope: ScopeKind;
  /** e.g. the environment's name, for tooltips. */
  scopeName: string;
  /** Local scope key of the variable's current value (`env:<id>`, …), for "Edit" links. */
  scopeKey: string;
}

/** Layers, highest precedence first. */
export interface VariableScopes {
  layers: ReadonlyArray<{
    kind: ScopeKind;
    name: string;
    key: string;
    values: ReadonlyMap<string, ScopedValue>;
  }>;
}

export const EMPTY_SCOPES: VariableScopes = { layers: [] };

/** One layer from variables (enabled only) and their current values. */
export function scopeLayer(
  kind: ScopeKind,
  name: string,
  key: string,
  variables: readonly ProjectEnvVariable[],
  currentValues: Readonly<Record<string, string>> = {},
): VariableScopes['layers'][number] {
  const values = new Map<string, ScopedValue>();
  for (const variable of variables) {
    // The first enabled definition of a key wins (Postman behaviour).
    if (!variable.enabled || values.has(variable.key)) continue;
    values.set(variable.key, {
      value: currentValues[variable.key] ?? variable.value,
      secret: variable.type === 'secret',
      scope: kind,
      scopeName: name,
      scopeKey: key,
    });
  }
  return { kind, name, key, values };
}

export interface BuildScopesOptions {
  environmentId: string | null;
  /** Current values of a scope key (`env:<id>`, `collection:<id>`, `globals`). */
  currentValues?: (scopeKey: string) => Readonly<Record<string, string>>;
}

/** The scopes a request in `model` resolves against. Collection and globals join in PIGN-024. */
export function buildScopes(model: ProjectModel, options: BuildScopesOptions): VariableScopes {
  const layers: Array<VariableScopes['layers'][number]> = [];
  const environment = model.environments.find((e) => e.id === options.environmentId && !e.broken);
  if (environment) {
    const key = `env:${environment.id}`;
    layers.push(
      scopeLayer(
        'environment',
        environment.name,
        key,
        environment.values,
        options.currentValues?.(key),
      ),
    );
  }
  return { layers };
}

/** The value a name resolves to directly (no nesting), or `undefined`. */
export function lookupVariable(scopes: VariableScopes, name: string): ScopedValue | undefined {
  for (const layer of scopes.layers) {
    const found = layer.values.get(name);
    if (found) return found;
  }
  return undefined;
}

/** Every visible variable once (the one that wins), for autocomplete. */
export function visibleVariables(scopes: VariableScopes): Array<{ name: string } & ScopedValue> {
  const seen = new Map<string, { name: string } & ScopedValue>();
  for (const layer of scopes.layers) {
    for (const [name, value] of layer.values)
      if (!seen.has(name)) seen.set(name, { name, ...value });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
