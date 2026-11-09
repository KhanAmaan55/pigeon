import { describe, expect, it } from 'vitest';

import { GRAPHQL_ERROR_MESSAGE, USERS } from '../src/index';
import { useTestServer } from './helpers';

const url = useTestServer();

const post = (body: unknown) =>
  fetch(url('/graphql'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('/graphql', () => {
  it('resolves user(id) with variables and an operation name', async () => {
    const res = await post({
      query: 'query Other { users { id } } query One($id: ID!) { user(id: $id) { id name roles } }',
      variables: { id: '1' },
      operationName: 'One',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { user: { id: '1', name: USERS[0]?.name, roles: USERS[0]?.roles } },
    });
  });

  it('returns null for an unknown user and lists users', async () => {
    const res = await post({ query: '{ user(id: "99") { id } users { email active } }' });
    expect(await res.json()).toEqual({
      data: {
        user: null,
        users: USERS.map(({ email, active }) => ({ email, active })),
      },
    });
  });

  it('reports resolver errors next to partial data', async () => {
    const res = await post({ query: '{ users { id } error }' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown; errors: Array<{ message: string }> };
    expect(body.errors).toEqual([
      { message: GRAPHQL_ERROR_MESSAGE, locations: [{ line: 1, column: 16 }], path: ['error'] },
    ]);
    expect(body.data).toEqual({ users: USERS.map(({ id }) => ({ id: String(id) })), error: null });
  });

  it('reports syntax and validation errors without data', async () => {
    const syntax = (await (await post({ query: '{ users {' })).json()) as Record<string, unknown>;
    expect(syntax['errors']).toHaveLength(1);
    expect(syntax['data']).toBeUndefined();

    const unknownField = (await (await post({ query: '{ nope }' })).json()) as {
      errors: Array<{ message: string }>;
    };
    expect(unknownField.errors[0]?.message).toContain('nope');
  });

  it('answers introspection queries', async () => {
    const res = await post({ query: '{ __type(name: "User") { fields { name } } }' });
    expect(await res.json()).toEqual({
      data: {
        __type: { fields: ['id', 'name', 'email', 'active', 'roles'].map((name) => ({ name })) },
      },
    });
  });

  it('supports GET with query-string parameters', async () => {
    const params = new URLSearchParams({
      query: 'query ($id: ID!) { user(id: $id) { name } }',
      variables: JSON.stringify({ id: '3' }),
    });
    const res = await fetch(url(`/graphql?${params}`));
    expect(await res.json()).toEqual({ data: { user: { name: 'Grace Hopper' } } });
  });

  it('rejects malformed HTTP requests', async () => {
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ variables: {} })).status).toBe(400);
    expect((await fetch(url('/graphql?query={users{id}}&variables=nope'))).status).toBe(400);

    const put = await fetch(url('/graphql'), { method: 'PUT', body: '{}' });
    expect(put.status).toBe(405);
    expect(put.headers.get('allow')).toBe('GET, POST');
  });
});
