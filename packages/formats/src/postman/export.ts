/**
 * Project collection (or folder) → one Postman Collection v2.1 file (compatibility.md §A.4–A.5,
 * PIGN-029). Unknown keys are emitted where they were read; URL derived parts are regenerated
 * from `raw`; `_pigeon` keys are dropped unless asked for; examples become `response[]` with
 * their bodies inlined.
 */

import { decodeBase64 } from '../base64';
import { COLLECTION_SCHEMA } from '../project/schemas';
import type {
  Collection,
  Folder,
  ProjectExample,
  ProjectItem,
  ProjectRequest,
} from '../project/types';
import { authToPostman } from './auth';
import { collectionVariableToPostman } from './environment';
import { exampleToPostman } from './example';
import { requestToPostmanItem } from './item';
import { asObject, isObject, nonEmpty, type JsonObject } from './json';
import { decomposeUrl } from './url';

export interface ExportOptions {
  /** `response[]` with inlined bodies (default on). */
  includeExamples?: boolean;
  /** Keep `_pigeon` keys (default off; Postman ignores unknown keys). */
  includePigeonMetadata?: boolean;
}

export interface ExportResult {
  /** The Postman collection object. */
  data: JsonObject;
  /** `<name>.postman_collection.json`. */
  fileName: string;
  warnings: string[];
}

/** `name` made safe for a file name. */
export function exportFileName(name: string): string {
  const safe =
    [...name]
      .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '-' : char))
      .join('')
      .replace(/-+/g, '-')
      .trim() || 'collection';
  return `${safe}.postman_collection.json`;
}

export function exportCollection(
  source: Collection | Folder,
  options: ExportOptions = {},
): ExportResult {
  const includeExamples = options.includeExamples ?? true;
  const metadata = options.includePigeonMetadata ?? false;
  const warnings: string[] = [];

  const pigeonOf = (extra: unknown, add: JsonObject = {}): JsonObject => {
    if (!metadata) return {};
    const pigeon = { ...asObject(extra), ...add };
    delete pigeon['order'];
    return nonEmpty(pigeon) ? { _pigeon: pigeon } : {};
  };

  /** A URL object with Postman's derived parts, in Postman's key order. */
  const url = (value: unknown): JsonObject => {
    const object = asObject(value);
    const raw = typeof object['raw'] === 'string' ? object['raw'] : '';
    const { raw: _raw, query, variable, hash, ...rest } = object;
    return {
      raw,
      ...decomposeUrl(raw),
      ...(query === undefined ? {} : { query }),
      ...(hash === undefined ? {} : { hash }),
      ...(variable === undefined ? {} : { variable }),
      ...rest,
    };
  };

  /** URL parts regenerated; file form-data rows without the empty `value` Postman omits. */
  const withUrl = (request: JsonObject): JsonObject => {
    const { url: value, body, ...rest } = request;
    const formdata =
      isObject(body) && Array.isArray(body['formdata']) ? body['formdata'] : undefined;
    return {
      ...rest,
      ...(body === undefined
        ? {}
        : {
            body: formdata
              ? {
                  ...asObject(body),
                  formdata: formdata.map((row) => {
                    if (!isObject(row) || row['type'] !== 'file' || row['value'] !== '') return row;
                    const { value: _value, ...fileRow } = row;
                    return fileRow;
                  }),
                }
              : body,
          }),
      url: url(value),
    };
  };

  const example = (item: ProjectExample, requestName: string): JsonObject => {
    const { _pigeon: pigeonExtra, ...rest } = exampleToPostman(item);
    const { requestId: _requestId, bodyFile: _bodyFile, ...pigeon } = asObject(pigeonExtra);
    const { body } = item.response;
    let text: string | undefined;
    if (body.kind === 'text') text = body.text;
    else if (body.kind === 'binary') {
      // Postman examples hold text bodies only: keep the bytes as Latin-1 text.
      text = Array.from(decodeBase64(body.base64), (byte) => String.fromCharCode(byte)).join('');
      warnings.push(
        `Example "${item.name}" of "${requestName}" has a binary body, exported as text.`,
      );
    }
    const out: JsonObject = {
      ...rest,
      ...(isObject(rest['originalRequest'])
        ? { originalRequest: withUrl(rest['originalRequest']) }
        : {}),
      ...(text === undefined ? {} : { body: text }),
      ...(metadata && nonEmpty(pigeon) ? { _pigeon: pigeon } : {}),
    };
    return out;
  };

  const request = (item: ProjectRequest): JsonObject => {
    if (item.broken) warnings.push(`"${item.name}" could not be loaded and is left out.`);
    const { _pigeon: pigeonExtra, request: postmanRequest, ...rest } = requestToPostmanItem(item);
    return {
      ...rest,
      request: withUrl(asObject(postmanRequest)),
      ...(includeExamples && item.examples.length > 0
        ? { response: item.examples.map((e) => example(e, item.name)) }
        : {}),
      ...pigeonOf(pigeonExtra),
    };
  };

  const items = (children: readonly ProjectItem[]): JsonObject[] =>
    children
      .filter((child) => !child.broken)
      .map((child) => (child.kind === 'request' ? request(child) : folder(child)));

  /** Shared by folders and the root: auth, events, variables, unknown keys. */
  const container = (entity: Collection | Folder): JsonObject => {
    const { _pigeon: pigeonExtra, info: _info, ...extra } = entity.extra;
    return {
      ...extra,
      ...(entity.auth === undefined ? {} : { auth: authToPostman(entity.auth) }),
      ...(entity.events.length === 0 ? {} : { event: entity.events }),
      ...(entity.variables.length === 0
        ? {}
        : { variable: entity.variables.map(collectionVariableToPostman) }),
      ...pigeonOf(pigeonExtra),
    };
  };

  const folder = (entity: Folder): JsonObject => ({
    id: entity.id,
    name: entity.name,
    ...(entity.description === undefined ? {} : { description: entity.description }),
    item: items(entity.children),
    ...container(entity),
  });

  const infoExtra = source.kind === 'collection' ? asObject(source.extra['info']) : {};
  const data: JsonObject = {
    info: {
      _postman_id: source.id,
      name: source.name,
      ...(source.description === undefined ? {} : { description: source.description }),
      ...(source.kind === 'collection' && source.version !== undefined
        ? { version: source.version }
        : {}),
      ...infoExtra,
      schema: COLLECTION_SCHEMA,
    },
    item: items(source.children),
    ...container(source),
  };
  return { data, fileName: exportFileName(source.name), warnings };
}

/** The exported file's text: tab-indented like Postman's own exports. */
export function exportCollectionText(result: ExportResult): string {
  return `${JSON.stringify(result.data, null, '\t')}\n`;
}
