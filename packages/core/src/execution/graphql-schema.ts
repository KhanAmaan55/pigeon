/**
 * GraphQL schemas for the editor (PIGN-055, docs/api-execution.md §6): the introspection
 * request (sent like the request itself — same URL, headers, auth and variables), reading the
 * answer, and a cache of introspection results per request URL in local app state (never in
 * project files). The `graphql` package itself is not used here: the UI loads it lazily.
 */

import type { AppStateStore } from '@pigeon/platform';

import type { Request } from '../model/request';

/** `query IntrospectionQuery { __schema { … } }` (graphql's `getIntrospectionQuery()`). */
export function introspectionRequest(request: Request, introspectionQuery: string): Request {
  return {
    ...request,
    method: 'POST',
    body: {
      mode: 'graphql',
      query: introspectionQuery,
      variables: '',
      operationName: 'IntrospectionQuery',
    },
  };
}

export type IntrospectionAnswer =
  { ok: true; introspection: { __schema: unknown } } | { ok: false; message: string };

/** The `data` of an introspection response, or why there is none. */
export function introspectionFromResponse(
  status: number,
  bodyText: string | undefined,
): IntrospectionAnswer {
  let json: unknown;
  try {
    json = JSON.parse(bodyText ?? '');
  } catch {
    return {
      ok: false,
      message: `The server answered ${status} without JSON: it may not be a GraphQL endpoint.`,
    };
  }
  const object = (typeof json === 'object' && json !== null ? json : {}) as {
    data?: { __schema?: unknown } | null;
    errors?: Array<{ message?: unknown }>;
  };
  const schema = object.data?.__schema;
  if (typeof schema === 'object' && schema !== null) {
    return { ok: true, introspection: { __schema: schema } };
  }
  const first = object.errors?.find((e) => typeof e.message === 'string')?.message;
  return {
    ok: false,
    message: first
      ? `Introspection failed: ${String(first)}`
      : `The server answered ${status} without a schema (introspection may be turned off).`,
  };
}

/** Requests share a cached schema when their URL (without query and fragment) is the same. */
export function schemaCacheKey(rawUrl: string): string {
  return rawUrl.trim().replace(/[?#].*$/, '');
}

export interface CachedSchema {
  url: string;
  /** ISO time. */
  fetchedAt: string;
  introspection: { __schema: unknown };
}

interface IndexEntry {
  url: string;
  fetchedAt: string;
}

/** How many URLs keep a cached schema (least recently fetched dropped first). */
export const SCHEMA_CACHE_LIMIT = 20;
/** Larger introspection results are not cached (they are still used until the editor closes). */
export const SCHEMA_CACHE_MAX_CHARS = 5 * 1024 * 1024;

const INDEX_KEY = 'graphqlSchemas';
const entryKey = (url: string) => `graphqlSchema:${url}`;

/**
 * Introspection results per request URL in an app-state namespace: `project:<localKey>` for
 * project requests, `app` for the scratch request. Survives restarts; `clear` forgets one URL.
 */
export class GraphqlSchemaCache {
  readonly #store: AppStateStore;
  readonly #namespace: 'app' | `project:${string}`;
  readonly #listeners = new Set<() => void>();

  constructor(store: AppStateStore, namespace: 'app' | `project:${string}`) {
    this.#store = store;
    this.#namespace = namespace;
  }

  async #index(): Promise<IndexEntry[]> {
    const index = await this.#store.get<unknown>(this.#namespace, INDEX_KEY).catch(() => undefined);
    return Array.isArray(index)
      ? index.filter(
          (e): e is IndexEntry =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as IndexEntry).url === 'string' &&
            typeof (e as IndexEntry).fetchedAt === 'string',
        )
      : [];
  }

  async get(url: string): Promise<CachedSchema | undefined> {
    const key = schemaCacheKey(url);
    const cached = await this.#store
      .get<CachedSchema>(this.#namespace, entryKey(key))
      .catch(() => undefined);
    return cached && typeof cached.introspection === 'object' && cached.introspection !== null
      ? cached
      : undefined;
  }

  /** `false` when the result is too large to keep. */
  async set(url: string, introspection: { __schema: unknown }, now = new Date()): Promise<boolean> {
    if (JSON.stringify(introspection).length > SCHEMA_CACHE_MAX_CHARS) return false;
    const key = schemaCacheKey(url);
    const fetchedAt = now.toISOString();
    await this.#store.set(this.#namespace, entryKey(key), { url: key, fetchedAt, introspection });
    const index = [{ url: key, fetchedAt }, ...(await this.#index()).filter((e) => e.url !== key)];
    for (const dropped of index.splice(SCHEMA_CACHE_LIMIT)) {
      await this.#store.delete(this.#namespace, entryKey(dropped.url));
    }
    await this.#store.set(this.#namespace, INDEX_KEY, index);
    this.#emit();
    return true;
  }

  async clear(url: string): Promise<void> {
    const key = schemaCacheKey(url);
    await this.#store.delete(this.#namespace, entryKey(key));
    const index = (await this.#index()).filter((e) => e.url !== key);
    await this.#store.set(this.#namespace, INDEX_KEY, index);
    this.#emit();
  }

  /** URLs with a cached schema, most recently fetched first. */
  async list(): Promise<IndexEntry[]> {
    return this.#index();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}
