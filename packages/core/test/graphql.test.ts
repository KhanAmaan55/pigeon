import { MEMORY_CAPABILITIES } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { Request } from '../src/index';
import {
  autoHeaders,
  createExecutionContext,
  createRequest,
  emptyBody,
  graphqlOperations,
  interpretGraphql,
  prepareRequest,
} from '../src/index';

const ctx = (values: Record<string, string> = {}) =>
  createExecutionContext({
    capabilities: MEMORY_CAPABILITIES,
    scopes: {
      layers: [
        {
          kind: 'environment',
          name: 'Local',
          key: 'env:l',
          values: new Map(Object.entries(values).map(([k, v]) => [k, { value: v, secret: false }])),
        },
      ],
    } as never,
  });

const gql = (body: Partial<Extract<Request['body'], { mode: 'graphql' }>>, method = 'POST') =>
  createRequest({
    method,
    url: 'http://localhost:4010/graphql',
    body: { ...emptyBody('graphql'), ...body } as Request['body'],
  });

const text = (body: unknown) =>
  new TextDecoder().decode((body as { kind: 'bytes'; bytes: Uint8Array }).bytes);

describe('GraphQL requests (PIGN-032)', () => {
  it('POSTs {"query","variables","operationName"} as JSON, variables kept as written', async () => {
    const result = await prepareRequest(
      gql({
        query: 'query User($id: ID!) { user(id: $id) { name } }',
        variables: '{ "id": {{userId}}, "big": 12345678901234567890 }',
        operationName: 'User',
      }),
      ctx({ userId: '42' }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.meta.protocol).toBe('graphql');
    expect(text(result.value.body)).toBe(
      '{"query":"query User($id: ID!) { user(id: $id) { name } }","variables":{ "id": 42, "big": 12345678901234567890 },"operationName":"User"}',
    );
    expect(result.value.headers).toContainEqual(['Content-Type', 'application/json']);
  });

  it('GET puts query, variables and operationName in the query string', async () => {
    const result = await prepareRequest(
      gql({ query: '{ users { id } }', variables: '{"n":1}', operationName: 'Users' }, 'GET'),
      ctx(),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.body).toBeUndefined();
    const url = new URL(result.value.url);
    expect(url.searchParams.get('query')).toBe('{ users { id } }');
    expect(url.searchParams.get('variables')).toBe('{"n":1}');
    expect(url.searchParams.get('operationName')).toBe('Users');
    expect(
      autoHeaders(
        { method: 'GET', headers: [], body: gql({ query: '{ a }' }).body },
        MEMORY_CAPABILITIES,
      ).map((h) => h.name),
    ).not.toContain('Content-Type');
  });

  it('blocks sending with invalid variables JSON', async () => {
    for (const variables of ['{ not json', '[1, 2]']) {
      const result = await prepareRequest(gql({ query: '{ a }', variables }), ctx());
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({ kind: 'invalid-request' });
    }
    const empty = await prepareRequest(gql({ query: '{ a }', variables: '  ' }), ctx());
    expect(empty.ok && text(empty.value.body)).toBe('{"query":"{ a }"}');
  });

  it('detects operations for the operation name picker', () => {
    expect(
      graphqlOperations(`
        # query Commented { x }
        query Users($first: Int) { users(first: $first) { id name } }
        mutation AddUser { addUser(name: "query Fake") { id } }
        fragment F on User { id }
        subscription { tick }
        { shorthand }
      `),
    ).toEqual([
      { type: 'query', name: 'Users' },
      { type: 'mutation', name: 'AddUser' },
      { type: 'subscription' },
      { type: 'query' },
    ]);
  });

  it('reads data and errors from a GraphQL response', () => {
    expect(
      interpretGraphql({
        json: {
          data: { x: null },
          errors: [{ message: 'Boom', path: ['x'], locations: [{ line: 1, column: 3 }] }],
        },
      }),
    ).toEqual({
      data: { x: null },
      errors: [{ message: 'Boom', path: ['x'], locations: [{ line: 1, column: 3 }] }],
    });
    expect(interpretGraphql({ json: { users: [] } })).toBeUndefined();
    expect(interpretGraphql({ json: undefined })).toBeUndefined();
  });
});
