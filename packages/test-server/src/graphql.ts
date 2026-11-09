import { buildSchema, graphql } from 'graphql';

import { USERS } from './fixtures.ts';
import type { Handler } from './reply.ts';
import { json } from './reply.ts';

export const SCHEMA_SDL = `
"A user of the test API."
type User {
  id: ID!
  name: String!
  email: String!
  active: Boolean!
  roles: [String!]!
}

type Query {
  "Looks a user up by id; null when there is none."
  user(id: ID!): User
  users: [User!]!
  "Always fails, for testing GraphQL error responses."
  error: String
}
`;

const schema = buildSchema(SCHEMA_SDL);

export const ERROR_MESSAGE = 'Deliberate error from the test server';

const rootValue = {
  user: ({ id }: { id: string }) => USERS.find((user) => String(user.id) === id) ?? null,
  users: () => USERS,
  error: () => {
    throw new Error(ERROR_MESSAGE);
  },
};

interface GraphQLParams {
  query?: unknown;
  variables?: unknown;
  operationName?: unknown;
}

/**
 * GraphQL over HTTP: `POST` with a JSON body, or `GET` with `query`/`variables`/`operationName`
 * in the query string. GraphQL errors are answered with 200 and an `errors` array; malformed
 * HTTP requests get 400.
 */
export const graphqlHandler: Handler = async (ctx) => {
  let params: GraphQLParams;
  if (ctx.method === 'GET') {
    const variables = ctx.query.get('variables');
    try {
      params = {
        query: ctx.query.get('query') ?? undefined,
        variables: variables ? JSON.parse(variables) : undefined,
        operationName: ctx.query.get('operationName') ?? undefined,
      };
    } catch {
      return badRequest('variables must be JSON');
    }
  } else if (ctx.method === 'POST') {
    try {
      params = JSON.parse(ctx.body.toString('utf8')) as GraphQLParams;
    } catch {
      return badRequest('Body must be JSON: { "query": ..., "variables": ... }');
    }
  } else {
    return json({ errors: [{ message: 'Use GET or POST' }] }, 405, { Allow: 'GET, POST' });
  }

  if (typeof params !== 'object' || params === null || typeof params.query !== 'string') {
    return badRequest('Missing "query"');
  }
  const result = await graphql({
    schema,
    source: params.query,
    rootValue,
    variableValues: isRecord(params.variables) ? params.variables : undefined,
    operationName: typeof params.operationName === 'string' ? params.operationName : undefined,
  });
  return json(result);
};

const badRequest = (message: string) => json({ errors: [{ message }] }, 400);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
