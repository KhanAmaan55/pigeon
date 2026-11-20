/**
 * What an imported file is (compatibility.md §A.1, §B.4), from its structure: Postman
 * collections (v2.1, v2.0; v1 rejected), environments and globals.
 */

import { isObject } from './postman/json';

export type DetectedFormat =
  | { kind: 'postman-collection'; version: '2.1' | '2.0'; data: Record<string, unknown> }
  | { kind: 'postman-environment'; data: Record<string, unknown> }
  | { kind: 'postman-globals'; data: Record<string, unknown> }
  | { kind: 'rejected'; format: string; message: string }
  | { kind: 'unknown'; message: string };

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export function detectFormat(input: string | Uint8Array | unknown): DetectedFormat {
  let data: unknown = input;
  if (typeof input === 'string' || input instanceof Uint8Array) {
    let text: string;
    try {
      text = typeof input === 'string' ? input : strictUtf8.decode(input);
    } catch {
      return { kind: 'unknown', message: 'The file is not UTF-8 text.' };
    }
    try {
      data = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      return { kind: 'unknown', message: 'The file is not valid JSON.' };
    }
  }
  if (!isObject(data)) return { kind: 'unknown', message: 'Expected a JSON object.' };

  const info = isObject(data['info']) ? data['info'] : undefined;
  const schema = typeof info?.['schema'] === 'string' ? info['schema'] : '';
  if (info && Array.isArray(data['item'])) {
    if (/\/collection\/v2\.1(\.\d+)?\/collection\.json$/.test(schema) || schema.includes('v2.1')) {
      return { kind: 'postman-collection', version: '2.1', data };
    }
    if (schema.includes('v2.0')) return { kind: 'postman-collection', version: '2.0', data };
    if (schema === '') return { kind: 'postman-collection', version: '2.1', data };
  }
  if (Array.isArray(data['requests']) && (Array.isArray(data['order']) || 'folders' in data)) {
    return {
      kind: 'rejected',
      format: 'Postman Collection v1',
      message:
        'Postman Collection v1 is not supported. Re-export it from Postman as Collection v2.1.',
    };
  }
  if (Array.isArray(data['collections']) && 'version' in data) {
    return {
      kind: 'rejected',
      format: 'Postman data dump',
      message: 'Postman data dumps are not supported yet. Export each collection as v2.1.',
    };
  }
  if (Array.isArray(data['values'])) {
    const scope = data['_postman_variable_scope'];
    if (scope === 'globals') return { kind: 'postman-globals', data };
    if (scope === 'environment' || typeof data['name'] === 'string') {
      return { kind: 'postman-environment', data };
    }
  }
  return {
    kind: 'unknown',
    message: 'This is not a Postman collection (v2.1 or v2.0) or environment file.',
  };
}
