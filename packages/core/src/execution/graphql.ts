/**
 * GraphQL helpers (PIGN-032, docs/api-execution.md §6): the operations a document defines (to
 * pick an operation name) and the `data` / `errors` of a response, which the viewer shows even
 * with HTTP 200.
 */

import type { NormalizedResponse } from './types';

export interface GraphqlOperation {
  type: 'query' | 'mutation' | 'subscription';
  /** Absent for anonymous operations. */
  name?: string;
}

/**
 * Top-level operations in `document` (a lightweight tokenizer: strings, block strings and
 * comments are skipped; only depth-0 `query|mutation|subscription Name` count).
 */
export function graphqlOperations(document: string): GraphqlOperation[] {
  const operations: GraphqlOperation[] = [];
  let depth = 0;
  let i = 0;
  let anonymousStart = true;
  while (i < document.length) {
    const char = document[i]!;
    if (char === '#') {
      while (i < document.length && document[i] !== '\n') i++;
      continue;
    }
    if (document.startsWith('"""', i)) {
      const end = document.indexOf('"""', i + 3);
      i = end === -1 ? document.length : end + 3;
      continue;
    }
    if (char === '"') {
      i++;
      while (i < document.length && document[i] !== '"' && document[i] !== '\n') {
        if (document[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (char === '{') {
      // `{ … }` at the top level is an anonymous query (shorthand).
      if (depth === 0 && anonymousStart) operations.push({ type: 'query' });
      depth++;
      anonymousStart = false;
      i++;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) anonymousStart = true;
      i++;
      continue;
    }
    if (depth === 0 && /[A-Za-z_]/.test(char)) {
      const word = /^[_A-Za-z][_0-9A-Za-z]*/.exec(document.slice(i))![0];
      i += word.length;
      if (word === 'query' || word === 'mutation' || word === 'subscription') {
        const name = /^\s*([_A-Za-z][_0-9A-Za-z]*)/.exec(document.slice(i));
        operations.push({ type: word, ...(name ? { name: name[1]! } : {}) });
        anonymousStart = false;
      } else if (word === 'fragment') {
        anonymousStart = false;
      }
      continue;
    }
    i++;
  }
  return operations;
}

export interface GraphqlError {
  message: string;
  path?: Array<string | number>;
  locations?: Array<{ line: number; column: number }>;
}

export interface GraphqlView {
  data?: unknown;
  errors: GraphqlError[];
}

/** `data` and `errors` of a GraphQL response, or `undefined` when it isn't one. */
export function interpretGraphql(
  response: Pick<NormalizedResponse, 'json'>,
): GraphqlView | undefined {
  const json = response.json;
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  const record = json as Record<string, unknown>;
  if (!('data' in record) && !('errors' in record)) return undefined;
  const errors = Array.isArray(record['errors'])
    ? record['errors'].map((error): GraphqlError => {
        const e = (typeof error === 'object' && error !== null ? error : {}) as Record<
          string,
          unknown
        >;
        return {
          message: typeof e['message'] === 'string' ? e['message'] : JSON.stringify(error),
          ...(Array.isArray(e['path']) ? { path: e['path'] as Array<string | number> } : {}),
          ...(Array.isArray(e['locations'])
            ? { locations: e['locations'] as GraphqlError['locations'] & object }
            : {}),
        };
      })
    : [];
  return { ...('data' in record ? { data: record['data'] } : {}), errors };
}
