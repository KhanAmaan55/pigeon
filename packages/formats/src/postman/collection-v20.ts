/**
 * Postman Collection v2.0 → v2.1 (compatibility.md §A.1): auth params as objects become
 * `[{ key, value, type }]` arrays; header strings become header arrays. URL strings are valid
 * v2.1 already. Everything else is the same shape.
 */

import { asArray, isObject, type JsonObject } from './json';

/** `basic: { username, password }` → `basic: [{ key, value, type }]`. */
function convertAuth(auth: unknown): unknown {
  if (!isObject(auth) || typeof auth['type'] !== 'string') return auth;
  const type = auth['type'];
  const params = auth[type];
  if (!isObject(params)) return auth;
  return {
    ...auth,
    [type]: Object.entries(params).map(([key, value]) => ({
      key,
      value,
      type: typeof value === 'boolean' ? 'boolean' : typeof value === 'string' ? 'string' : 'any',
    })),
  };
}

/** `"Accept: x\nX-Y: z"` → `[{ key: 'Accept', value: 'x' }, …]`. */
export function headersFromString(text: string): JsonObject[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const colon = line.indexOf(':');
      return colon === -1
        ? { key: line, value: '' }
        : { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
    });
}

function convertRequest(request: unknown): unknown {
  if (!isObject(request)) return request;
  const out: JsonObject = { ...request };
  if (typeof out['header'] === 'string') out['header'] = headersFromString(out['header']);
  if (out['auth'] !== undefined) out['auth'] = convertAuth(out['auth']);
  return out;
}

function convertItem(item: unknown): unknown {
  if (!isObject(item)) return item;
  const out: JsonObject = { ...item };
  if (out['auth'] !== undefined) out['auth'] = convertAuth(out['auth']);
  if (Array.isArray(out['item'])) out['item'] = out['item'].map(convertItem);
  if (out['request'] !== undefined) out['request'] = convertRequest(out['request']);
  if (Array.isArray(out['response'])) {
    out['response'] = out['response'].map((response) => {
      if (!isObject(response)) return response;
      const converted: JsonObject = { ...response };
      if (typeof converted['header'] === 'string')
        converted['header'] = headersFromString(converted['header']);
      if (converted['originalRequest'] !== undefined)
        converted['originalRequest'] = convertRequest(converted['originalRequest']);
      return converted;
    });
  }
  return out;
}

/** A v2.0 collection in v2.1 shape (the schema URL is rewritten by the importer). */
export function convertCollectionV20(collection: JsonObject): JsonObject {
  const out: JsonObject = { ...collection };
  if (out['auth'] !== undefined) out['auth'] = convertAuth(out['auth']);
  out['item'] = asArray(out['item']).map(convertItem);
  return out;
}
