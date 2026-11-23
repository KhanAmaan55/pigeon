/**
 * The schema behind a GraphQL request's editor (PIGN-055): the request's committed schema file
 * when it has one, otherwise the introspection result cached for its URL in local state
 * (`GraphqlSchemaCache`). "Fetch schema" sends the introspection query like the request itself;
 * "Clear" forgets the cached result. The graphql runtime loads only when there is a schema to
 * build (or one is fetched).
 */

import type { GraphqlSchemaCache as Cache } from '@pigeon/core';
import { GraphqlSchemaCache, introspectionFromResponse, schemaCacheKey } from '@pigeon/core';
import type { AppStateStore, ProjectFileSystem } from '@pigeon/platform';
import type { GraphQLSchema } from 'graphql';
import { useCallback, useEffect, useState } from 'react';

import type { DocsModel } from './runtime';
import type { GraphqlRuntime } from './load';
import { loadGraphqlRuntime } from './load';

export type SchemaState =
  | { status: 'none' }
  | { status: 'loading' }
  | {
      status: 'ready';
      schema: GraphQLSchema;
      runtime: GraphqlRuntime;
      origin: 'file' | 'introspection';
      fetchedAt?: string;
      types: number;
      docs: DocsModel;
      /** Fetched but too large to cache: kept for this editor only. */
      notCached?: boolean;
    }
  | { status: 'error'; origin: 'file' | 'introspection'; message: string };

const caches = new WeakMap<AppStateStore, Map<string, Cache>>();

/** One cache object per app state and namespace, so every editor hears about changes. */
export function schemaCache(store: AppStateStore, namespace: 'app' | `project:${string}`): Cache {
  let byNamespace = caches.get(store);
  if (!byNamespace) caches.set(store, (byNamespace = new Map()));
  let cache = byNamespace.get(namespace);
  if (!cache) byNamespace.set(namespace, (cache = new GraphqlSchemaCache(store, namespace)));
  return cache;
}

function ready(
  runtime: GraphqlRuntime,
  schema: GraphQLSchema,
  extra: { origin: 'file' | 'introspection'; fetchedAt?: string; notCached?: boolean },
): SchemaState {
  return {
    status: 'ready',
    schema,
    runtime,
    types: runtime.schemaSummary(schema).types,
    docs: runtime.docsModel(schema),
    ...extra,
  };
}

export function useGraphqlSchema(opts: {
  rawUrl: string;
  schemaFile: string | undefined;
  projectFs: ProjectFileSystem | null;
  cache: Cache;
  introspect: (query: string) => Promise<{
    response?: { status: number; bodyText?: string };
    error?: { message: string };
  }>;
}) {
  const { rawUrl, schemaFile, projectFs, cache, introspect } = opts;
  const url = schemaCacheKey(rawUrl);
  const [state, setState] = useState<SchemaState>({ status: 'none' });
  /** A fetched schema too large to cache, for this URL. */
  const [memory, setMemory] = useState<{ url: string; state: SchemaState } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => cache.subscribe(() => setNonce((n) => n + 1)), [cache]);

  useEffect(() => {
    let current = true;
    const set = (next: SchemaState) => current && setState(next);
    void (async () => {
      if (schemaFile && projectFs) {
        set({ status: 'loading' });
        const text = await projectFs.readText(schemaFile).catch(() => null);
        if (text === null) {
          set({ status: 'error', origin: 'file', message: `Schema file ${schemaFile} not found.` });
          return;
        }
        const runtime = await loadGraphqlRuntime();
        const built = runtime.schemaFromFile(text, schemaFile);
        set(
          built.ok
            ? ready(runtime, built.schema, { origin: 'file' })
            : { status: 'error', origin: 'file', message: built.message },
        );
        return;
      }
      if (memory?.url === url) {
        set(memory.state);
        return;
      }
      const cached = url === '' ? undefined : await cache.get(url);
      if (!cached) {
        set({ status: 'none' });
        return;
      }
      set({ status: 'loading' });
      const runtime = await loadGraphqlRuntime();
      const built = runtime.schemaFromIntrospection(cached.introspection);
      set(
        built.ok
          ? ready(runtime, built.schema, { origin: 'introspection', fetchedAt: cached.fetchedAt })
          : { status: 'error', origin: 'introspection', message: built.message },
      );
    })();
    return () => {
      current = false;
    };
  }, [url, schemaFile, projectFs, cache, nonce, memory]);

  const fetchSchema = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const runtime = await loadGraphqlRuntime();
      const result = await introspect(runtime.INTROSPECTION_QUERY);
      if (!result.response) {
        setFetchError(result.error?.message ?? 'No response.');
        return;
      }
      const answer = introspectionFromResponse(result.response.status, result.response.bodyText);
      if (!answer.ok) {
        setFetchError(answer.message);
        return;
      }
      const built = runtime.schemaFromIntrospection(answer.introspection);
      if (!built.ok) {
        setFetchError(built.message);
        return;
      }
      setMemory(null);
      if (!(await cache.set(url, answer.introspection))) {
        setMemory({
          url,
          state: ready(runtime, built.schema, {
            origin: 'introspection',
            fetchedAt: new Date().toISOString(),
            notCached: true,
          }),
        });
      }
    } finally {
      setFetching(false);
    }
  }, [cache, introspect, url]);

  const clearSchema = useCallback(async () => {
    setMemory(null);
    setFetchError(null);
    await cache.clear(url);
  }, [cache, url]);

  return { state, fetching, fetchError, fetchSchema, clearSchema };
}
