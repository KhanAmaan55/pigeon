/**
 * What an imported file is (compatibility.md §A.1, §B.4), from its structure: Postman
 * collections (v2.1, v2.0; v1 rejected), environments, globals, Apidog environment and project
 * exports (PIGN-048), Echo API project exports (PIGN-049) and cURL commands.
 */

import type { ApidogVariant } from './apidog/environments';
import { APIDOG_FALLBACK_MESSAGE, apidogFormatName, detectApidog } from './apidog/environments';
import type { CurlRequest } from './curl/parse';
import {
  detectEchoApi,
  ECHOAPI_FALLBACK_MESSAGE,
  ECHOAPI_FORMAT,
  echoApiHasVariables,
} from './echoapi/environments';
import { isCurlCommand, parseCurl } from './curl/parse';
import { isObject } from './postman/json';

export type DetectedFormat =
  | { kind: 'postman-collection'; version: '2.1' | '2.0'; data: Record<string, unknown> }
  | { kind: 'postman-environment'; data: Record<string, unknown> }
  | { kind: 'postman-globals'; data: Record<string, unknown> }
  /** Apidog environments (and globals), PIGN-048. */
  | { kind: 'apidog'; variant: ApidogVariant; version?: string; data: Record<string, unknown> }
  /** Echo API environments (and global variables), PIGN-049. */
  | { kind: 'echoapi'; data: Record<string, unknown> }
  /** A cURL command (PIGN-050), parsed. */
  | { kind: 'curl'; request: CurlRequest }
  | { kind: 'rejected'; format: string; message: string }
  | { kind: 'unknown'; message: string };

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export function detectFormat(input: string | Uint8Array | unknown): DetectedFormat {
  let data: unknown = input;
  // `ArrayBuffer.isView`, not `instanceof`: bytes may come from another realm (a worker, jsdom).
  if (typeof input === 'string' || input instanceof Uint8Array || ArrayBuffer.isView(input)) {
    let text: string;
    try {
      text = typeof input === 'string' ? input : strictUtf8.decode(input as Uint8Array);
    } catch {
      return { kind: 'unknown', message: 'The file is not UTF-8 text.' };
    }
    try {
      data = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      if (isCurlCommand(text)) {
        const parsed = parseCurl(text);
        return parsed.ok
          ? { kind: 'curl', request: parsed.request }
          : { kind: 'unknown', message: parsed.message };
      }
      return { kind: 'unknown', message: 'The file is not valid JSON or a cURL command.' };
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
  const apidog = detectApidog(data);
  if (apidog?.kind === 'apidog') {
    const hasAny =
      Array.isArray(data['environments']) && data['environments'].length > 0
        ? true
        : Array.isArray(data['globalVariables']) &&
          data['globalVariables'].some(
            (g) => isObject(g) && Array.isArray(g['variables']) && g['variables'].length > 0,
          );
    if (!hasAny) {
      return {
        kind: 'rejected',
        format: apidogFormatName(apidog.variant, apidog.version),
        message:
          'This Apidog export has no environments or global variables. Export the APIs from Apidog as OpenAPI or Postman to import them.',
      };
    }
    return apidog;
  }
  if (apidog?.kind === 'apidog-unrecognized') {
    return { kind: 'rejected', format: 'Apidog export', message: APIDOG_FALLBACK_MESSAGE };
  }
  const echo = detectEchoApi(data);
  if (echo?.kind === 'echoapi') {
    if (!echoApiHasVariables(data)) {
      return {
        kind: 'rejected',
        format: ECHOAPI_FORMAT,
        message:
          'This Echo API export has no environment variables, base URLs or global variables. Export the project from Echo API in Postman format to import its APIs.',
      };
    }
    return echo;
  }
  if (echo?.kind === 'echoapi-unrecognized') {
    return { kind: 'rejected', format: 'Echo API export', message: ECHOAPI_FALLBACK_MESSAGE };
  }
  return {
    kind: 'unknown',
    message: 'This is not a Postman collection (v2.1 or v2.0) or environment file.',
  };
}
