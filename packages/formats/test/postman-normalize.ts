/**
 * `normalizePostman` (compatibility.md §A.4): what round-trip comparisons ignore — key order,
 * URL derived parts, generated ids, header strings, empty/default values, v2.0 vs v2.1.
 */

import { convertCollectionV20 } from '../src/postman/collection-v20';
import { headersFromString } from '../src/postman/collection-v20';
import { COLLECTION_SCHEMA } from '../src/project/schemas';

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeUrl(url: Json): Json {
  const object = typeof url === 'string' ? { raw: url } : isObject(url) ? { ...url } : url;
  if (!isObject(object)) return object;
  for (const derived of ['protocol', 'host', 'path', 'port']) delete object[derived];
  return object;
}

function normalizeRequest(request: Json): Json {
  const object = typeof request === 'string' ? { method: 'GET', url: request } : request;
  if (!isObject(object)) return object;
  const out: Record<string, Json> = { ...object };
  if (typeof out['method'] === 'string') out['method'] = out['method'].toUpperCase();
  if (out['url'] !== undefined) out['url'] = normalizeUrl(out['url']);
  if (typeof out['header'] === 'string') out['header'] = headersFromString(out['header']);
  // File form-data rows: an empty `value` is the same as none.
  const body = out['body'];
  if (isObject(body) && Array.isArray(body['formdata'])) {
    out['body'] = {
      ...body,
      formdata: body['formdata'].map((row) => {
        if (!isObject(row) || row['type'] !== 'file' || row['value'] !== '') return row;
        const { value: _value, ...rest } = row;
        return rest;
      }),
    };
  }
  return out;
}

/** Drops ids, default `disabled: false`, empty descriptions, empty arrays and null bodies. */
function clean(value: Json, key = ''): Json {
  if (Array.isArray(value)) return value.map((entry) => clean(entry));
  if (!isObject(value)) return value;
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'id' && key !== 'info') continue;
    if (k === 'disabled' && v === false) continue;
    if (k === 'description' && v === '') continue;
    if (k === 'body' && v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = clean(v, k);
  }
  return out;
}

function normalizeItems(items: Json): Json {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!isObject(item)) return item;
    const out: Record<string, Json> = { ...item };
    if (Array.isArray(out['item'])) out['item'] = normalizeItems(out['item']);
    if (out['request'] !== undefined) out['request'] = normalizeRequest(out['request']);
    if (Array.isArray(out['response'])) {
      out['response'] = out['response'].map((response) => {
        if (!isObject(response)) return response;
        const r: Record<string, Json> = { ...response };
        if (typeof r['header'] === 'string') r['header'] = headersFromString(r['header']);
        if (r['originalRequest'] !== undefined)
          r['originalRequest'] = normalizeRequest(r['originalRequest']);
        if (r['body'] === '') delete r['body'];
        return r;
      });
      // A project keeps no example order (file-key order on read): compare as a set.
      const label = (r: Json) => (isObject(r) ? `${String(r['name'])}|${String(r['code'])}` : '');
      (out['response'] as Json[]).sort((a, b) => label(a).localeCompare(label(b)));
    }
    return out;
  });
}

export function normalizePostman(collection: Record<string, Json>): Json {
  const info = isObject(collection['info']) ? collection['info'] : {};
  const schema = typeof info['schema'] === 'string' ? info['schema'] : '';
  const v21 = schema.includes('v2.0') ? convertCollectionV20(collection) : collection;
  return clean({
    ...v21,
    info: { ...(isObject(v21['info']) ? v21['info'] : {}), schema: COLLECTION_SCHEMA },
    item: normalizeItems(v21['item']),
  });
}
