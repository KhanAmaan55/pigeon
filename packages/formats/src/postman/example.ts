/**
 * Postman v2.1 `response` (an example) ⇄ `ProjectExample` (data-model.md §6, file-format.md §2.6).
 * In a project the body lives in a sidecar file named after the example (`_pigeon.bodyFile`);
 * `originalRequest` uses the request mapping of ./item.ts.
 */

import { decodeBase64, encodeBase64 } from '../base64';
import type {
  ExampleBody,
  ExampleBodyFormat,
  ExtraFields,
  ProjectExample,
  RequestExample,
} from '../project/types';
import {
  requestFromPostmanItem,
  requestToPostmanItem,
  keyValueFromPostman,
  keyValueToPostman,
} from './item';
import { asArray, asObject, asString, isObject, nonEmpty, type JsonObject } from './json';

export const EXAMPLE_SUFFIX = '.example.json';

const EXTENSIONS: Record<ExampleBodyFormat, string> = {
  json: 'json',
  xml: 'xml',
  html: 'html',
  text: 'txt',
  javascript: 'js',
};
const FORMATS = new Map(Object.entries(EXTENSIONS).map(([format, ext]) => [ext, format])) as Map<
  string,
  ExampleBodyFormat
>;

/** `<fileKey>.body.<ext>` for the body, or `undefined` when there is none. */
export function exampleBodyFileName(example: Pick<ProjectExample, 'fileKey' | 'response'>) {
  const { body } = example.response;
  if (body.kind === 'none') return undefined;
  const ext = body.kind === 'binary' ? 'bin' : EXTENSIONS[body.format];
  return `${example.fileKey}.body.${ext}`;
}

/** The sidecar's bytes. */
export function exampleBodyBytes(body: ExampleBody): Uint8Array {
  if (body.kind === 'none') return new Uint8Array();
  return body.kind === 'binary' ? decodeBase64(body.base64) : new TextEncoder().encode(body.text);
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** A sidecar read back: text for the text extensions (when valid UTF-8), else binary. */
export function exampleBodyFromFile(fileName: string, bytes: Uint8Array): ExampleBody {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  const format = FORMATS.get(ext);
  if (format) {
    try {
      return { kind: 'text', text: strictUtf8.decode(bytes), format };
    } catch {
      // Not UTF-8 after all: keep the exact bytes.
    }
  }
  return { kind: 'binary', base64: encodeBase64(bytes) };
}

function take(object: JsonObject, key: string): unknown {
  const value = object[key];
  delete object[key];
  return value;
}

function requestExampleFromPostman(raw: JsonObject): RequestExample {
  const request = requestFromPostmanItem({ request: raw }, '');
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body,
    ...(request.auth === undefined ? {} : { auth: request.auth }),
    ...(request.description === undefined ? {} : { description: request.description }),
    extra: asObject(request.extra['request']),
  };
}

function requestExampleToPostman(example: RequestExample): JsonObject {
  const item = requestToPostmanItem({
    kind: 'request',
    id: '',
    fileKey: '',
    name: '',
    method: example.method,
    url: example.url,
    headers: example.headers,
    body: example.body,
    ...(example.auth === undefined ? {} : { auth: example.auth }),
    ...(example.description === undefined ? {} : { description: example.description }),
    events: [],
    settings: {},
    examples: [],
    extra: { request: example.extra },
  });
  return asObject(item['request']);
}

/**
 * Maps a Postman response object. `body` is the sidecar's content; a Postman `body` string in
 * the file (hand-written or imported) is used when there is no sidecar.
 */
export function exampleFromPostman(
  raw: JsonObject,
  fileKey: string,
  body?: ExampleBody,
): ProjectExample {
  const rest = { ...raw };
  const pigeon = { ...asObject(take(rest, '_pigeon')) };
  delete pigeon['bodyFile'];
  const requestId = asString(take(pigeon, 'requestId'));
  const original = take(rest, 'originalRequest');
  const inline = take(rest, 'body');
  const previewLanguage = take(rest, '_postman_previewlanguage');
  const responseTime = take(rest, 'responseTime');
  const code = take(rest, 'code');
  const extra: ExtraFields = { ...rest };
  delete extra['id'];
  delete extra['name'];
  delete extra['status'];
  delete extra['header'];
  delete extra['cookie'];
  if (original !== undefined && !isObject(original)) extra['originalRequest'] = original;
  if (nonEmpty(pigeon)) extra['_pigeon'] = pigeon;
  const inlineBody: ExampleBody | undefined =
    typeof inline === 'string' && inline !== ''
      ? { kind: 'text', text: inline, format: formatOfLanguage(previewLanguage) }
      : undefined;
  return {
    id: asString(raw['id']),
    fileKey,
    requestId,
    name: asString(raw['name']),
    ...(isObject(original) ? { request: requestExampleFromPostman(original) } : {}),
    response: {
      code: typeof code === 'number' ? code : Number(code) || 0,
      status: asString(raw['status']),
      headers: asArray(raw['header']).filter(isObject).map(keyValueFromPostman),
      cookies: asArray(raw['cookie']),
      body: body ?? inlineBody ?? { kind: 'none' },
      ...(typeof previewLanguage === 'string' ? { previewLanguage } : {}),
      ...(typeof responseTime === 'number' || responseTime === null
        ? { responseTimeMs: responseTime }
        : {}),
    },
    extra,
  };
}

function formatOfLanguage(language: unknown): ExampleBodyFormat {
  return language === 'json' ||
    language === 'xml' ||
    language === 'html' ||
    language === 'javascript'
    ? language
    : 'text';
}

/** The `*.example.json` object (without the body, which goes to its sidecar). */
export function exampleToPostman(example: ProjectExample): JsonObject {
  const { _pigeon: pigeonExtra, ...extra } = example.extra;
  const bodyFile = exampleBodyFileName(example);
  const { response } = example;
  return {
    ...extra,
    id: example.id,
    name: example.name,
    ...(example.request ? { originalRequest: requestExampleToPostman(example.request) } : {}),
    status: response.status,
    code: response.code,
    ...(response.previewLanguage === undefined
      ? {}
      : { _postman_previewlanguage: response.previewLanguage }),
    header: response.headers.map(keyValueToPostman),
    cookie: response.cookies,
    ...(response.responseTimeMs === undefined ? {} : { responseTime: response.responseTimeMs }),
    _pigeon: {
      ...asObject(pigeonExtra),
      requestId: example.requestId,
      ...(bodyFile === undefined ? {} : { bodyFile }),
    },
  };
}
