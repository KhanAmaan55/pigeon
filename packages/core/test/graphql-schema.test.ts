import { MemoryAppState } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import {
  createRequest,
  GraphqlSchemaCache,
  introspectionFromResponse,
  introspectionRequest,
  SCHEMA_CACHE_LIMIT,
  schemaCacheKey,
} from '../src/index';

describe('GraphQL introspection (PIGN-055)', () => {
  it('builds the introspection request from the request (URL, headers and auth kept)', () => {
    const request = createRequest({ name: 'Users', method: 'GET' });
    const sent = introspectionRequest(
      { ...request, auth: { type: 'bearer', bearer: { token: '{{token}}' } } as never },
      'query IntrospectionQuery { __schema { queryType { name } } }',
    );
    expect(sent.method).toBe('POST');
    expect(sent.auth).toEqual({ type: 'bearer', bearer: { token: '{{token}}' } });
    expect(sent.body).toEqual({
      mode: 'graphql',
      query: 'query IntrospectionQuery { __schema { queryType { name } } }',
      variables: '',
      operationName: 'IntrospectionQuery',
    });
  });

  it('reads the schema from data.__schema, and explains failures', () => {
    expect(introspectionFromResponse(200, '{"data":{"__schema":{"types":[]}}}')).toEqual({
      ok: true,
      introspection: { __schema: { types: [] } },
    });
    expect(
      introspectionFromResponse(
        200,
        '{"errors":[{"message":"GraphQL introspection is not allowed"}]}',
      ),
    ).toEqual({ ok: false, message: 'Introspection failed: GraphQL introspection is not allowed' });
    expect(introspectionFromResponse(404, '<html>')).toMatchObject({ ok: false });
    expect(introspectionFromResponse(200, '{"data":null}')).toMatchObject({
      ok: false,
      message: expect.stringContaining('introspection may be turned off'),
    });
  });

  it('keys the cache by URL without query or fragment', () => {
    expect(schemaCacheKey(' {{baseUrl}}/graphql?x=1#top ')).toBe('{{baseUrl}}/graphql');
  });

  it('caches per URL in app state, survives a new instance, clears, and keeps the last 20', async () => {
    const state = new MemoryAppState();
    const cache = new GraphqlSchemaCache(state, 'project:p1');
    let changes = 0;
    cache.subscribe(() => changes++);
    await cache.set(
      '{{baseUrl}}/graphql?a=1',
      { __schema: { n: 1 } },
      new Date('2026-11-23T10:00:00Z'),
    );
    const restarted = new GraphqlSchemaCache(state, 'project:p1');
    expect(await restarted.get('{{baseUrl}}/graphql')).toEqual({
      url: '{{baseUrl}}/graphql',
      fetchedAt: '2026-11-23T10:00:00.000Z',
      introspection: { __schema: { n: 1 } },
    });
    expect(await new GraphqlSchemaCache(state, 'app').get('{{baseUrl}}/graphql')).toBeUndefined();
    await restarted.clear('{{baseUrl}}/graphql');
    expect(await cache.get('{{baseUrl}}/graphql')).toBeUndefined();
    expect(changes).toBe(1);

    for (let i = 0; i < SCHEMA_CACHE_LIMIT + 2; i++) {
      await cache.set(`http://api/${i}`, { __schema: { i } }, new Date(Date.UTC(2026, 0, 1, 0, i)));
    }
    const urls = (await cache.list()).map((e) => e.url);
    expect(urls).toHaveLength(SCHEMA_CACHE_LIMIT);
    expect(urls[0]).toBe(`http://api/${SCHEMA_CACHE_LIMIT + 1}`);
    expect(await cache.get('http://api/0')).toBeUndefined();
    expect(await cache.get('http://api/2')).toBeDefined();
  });
});
