/**
 * `{{var}}` resolution (docs/api-execution.md §3): pure and synchronous. Nested references
 * resolve up to depth 10; a cycle leaves the reference as typed and is reported; unknown names
 * stay as typed and are listed as unresolved. Dynamic variables (`{{$guid}}`, …) come from
 * injectable generators.
 */

import { findVariables, isDynamicName } from './parse';
import type { VariableScopes } from './scopes';
import { lookupVariable } from './scopes';

export const MAX_DEPTH = 10;

export interface DynamicGenerators {
  uuid: () => string;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** Integer in [0, 1000]. */
  randomInt: () => number;
}

export const DEFAULT_GENERATORS: DynamicGenerators = {
  uuid: () => crypto.randomUUID(),
  now: () => Date.now(),
  randomInt: () => Math.floor(Math.random() * 1001),
};

export const DYNAMIC_VARIABLES = [
  '$guid',
  '$randomUUID',
  '$timestamp',
  '$isoTimestamp',
  '$randomInt',
] as const;

export function dynamicValue(name: string, generators: DynamicGenerators): string | undefined {
  switch (name) {
    case '$guid':
    case '$randomUUID':
      return generators.uuid();
    case '$timestamp':
      return String(Math.floor(generators.now() / 1000));
    case '$isoTimestamp':
      return new Date(generators.now()).toISOString();
    case '$randomInt':
      return String(generators.randomInt());
    default:
      return undefined;
  }
}

export interface ResolveResult {
  value: string;
  /** Names left as typed (unknown, unknown `$…`, too deep). */
  unresolved: string[];
  /** Names that take part in a reference cycle. */
  cycles: string[];
  /** Resolved values of secret variables (to mask in results and logs). */
  secretValues: string[];
}

/** Resolves strings against one set of scopes, collecting what every call left unresolved. */
export class VariableResolver {
  readonly #scopes: VariableScopes;
  readonly #generators: DynamicGenerators;
  readonly unresolved = new Set<string>();
  readonly cycles = new Set<string>();
  readonly secretValues = new Set<string>();

  constructor(scopes: VariableScopes, generators: DynamicGenerators = DEFAULT_GENERATORS) {
    this.#scopes = scopes;
    this.#generators = generators;
  }

  resolve(text: string): string {
    return this.#resolve(text, [], 0);
  }

  #resolve(text: string, stack: readonly string[], depth: number): string {
    const tokens = findVariables(text);
    if (tokens.length === 0) return text;
    let out = '';
    let at = 0;
    for (const token of tokens) {
      out += text.slice(at, token.start);
      at = token.end;
      const literal = text.slice(token.start, token.end);
      if (isDynamicName(token.name)) {
        const value = dynamicValue(token.name, this.#generators);
        if (value === undefined) this.unresolved.add(token.name);
        out += value ?? literal;
        continue;
      }
      if (stack.includes(token.name)) {
        for (const name of stack.slice(stack.indexOf(token.name))) this.cycles.add(name);
        out += literal;
        continue;
      }
      const found = lookupVariable(this.#scopes, token.name);
      if (!found || depth >= MAX_DEPTH) {
        this.unresolved.add(token.name);
        out += literal;
        continue;
      }
      const value = this.#resolve(found.value, [...stack, token.name], depth + 1);
      if (found.secret && value !== '') this.secretValues.add(value);
      out += value;
    }
    return out + text.slice(at);
  }

  result(value: string): ResolveResult {
    return {
      value,
      unresolved: [...this.unresolved].filter((name) => !this.cycles.has(name)),
      cycles: [...this.cycles],
      secretValues: [...this.secretValues],
    };
  }
}

/** One string, on its own. */
export function resolveString(
  text: string,
  scopes: VariableScopes,
  generators: DynamicGenerators = DEFAULT_GENERATORS,
): ResolveResult {
  const resolver = new VariableResolver(scopes, generators);
  return resolver.result(resolver.resolve(text));
}

/** What a single `{{name}}` would resolve to, for tooltips: `undefined` when it doesn't. */
export function describeVariable(
  name: string,
  scopes: VariableScopes,
): {
  state: 'resolved' | 'unresolved' | 'dynamic';
  value?: string;
  secret?: boolean;
  scopeName?: string;
  scopeKey?: string;
} {
  if (isDynamicName(name)) {
    return (DYNAMIC_VARIABLES as readonly string[]).includes(name)
      ? { state: 'dynamic' }
      : { state: 'unresolved' };
  }
  const found = lookupVariable(scopes, name);
  if (!found) return { state: 'unresolved' };
  const resolved = resolveString(`{{${name}}}`, scopes);
  if (resolved.unresolved.length > 0 || resolved.cycles.length > 0)
    return { state: 'unresolved', scopeName: found.scopeName };
  return {
    state: 'resolved',
    value: resolved.value,
    secret: found.secret,
    scopeName: found.scopeName,
    scopeKey: found.scopeKey,
  };
}
