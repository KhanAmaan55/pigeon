/**
 * Postman v2.1 `item` (request) JSON ⇄ normalized request model. Shared by the project reader /
 * writer and, later, the Postman importer / exporter (PIGN-028/029).
 *
 * Every key the mapping does not understand is kept in an `extra` record so it is written back
 * unchanged (docs/compatibility.md §A.3). Defaults are omitted on write (docs/file-format.md §3).
 */

import { authFromPostman, authToPostman } from './auth';
import type {
  Description,
  ExtraFields,
  ProjectBody,
  ProjectFormDataParam,
  ProjectKeyValue,
  ProjectRequest,
  ProjectRequestSettings,
  ProjectUrl,
  RawLanguage,
} from '../project/types';
import {
  asArray,
  asObject,
  asString,
  isDescription,
  isObject,
  nonEmpty,
  type JsonObject,
} from './json';

const RAW_LANGUAGES: readonly RawLanguage[] = ['json', 'text', 'xml', 'html', 'javascript'];
/** Postman `protocolProfileBehavior` keys modelled as settings, with their value type. */
const PROFILE_SETTINGS = {
  followRedirects: 'boolean',
  maxRedirects: 'number',
  strictSSL: 'boolean',
  disableBodyPruning: 'boolean',
  /** Postman's "Disable cookie jar" (PIGN-045). */
  disableCookies: 'boolean',
} as const;
/** A body Pigeon cannot edit yet (e.g. GraphQL before PIGN-032), kept verbatim. */
const UNSUPPORTED_BODY = 'unsupportedBody';

// --- Reading -----------------------------------------------------------------------------------

/** Maps a Postman request item into the normalized model. `fileKey` comes from the file name. */
export function requestFromPostmanItem(item: JsonObject, fileKey: string): ProjectRequest {
  const rest = { ...item };
  const request = asObject(take(rest, 'request'));
  const requestRest = { ...request };
  const profile = { ...asObject(take(rest, 'protocolProfileBehavior')) };
  const pigeon = { ...asObject(take(rest, '_pigeon')) };

  const settings: ProjectRequestSettings = {};
  for (const [key, type] of Object.entries(PROFILE_SETTINGS)) {
    if (typeof profile[key] === type) {
      (settings as Record<string, unknown>)[key] = take(profile, key);
    }
  }
  if (typeof pigeon['timeoutMs'] === 'number')
    settings.timeoutMs = take(pigeon, 'timeoutMs') as number;
  if (typeof pigeon['includeCredentials'] === 'boolean')
    settings.includeCredentials = take(pigeon, 'includeCredentials') as boolean;

  const id = asString(take(rest, 'id'));
  const name = asString(take(rest, 'name'));
  const event = take(rest, 'event');
  const description = takeDescription(requestRest);
  const auth = take(requestRest, 'auth');

  const extra: ExtraFields = { ...rest };
  if (event !== undefined && !Array.isArray(event)) extra['event'] = event;
  const method = asString(take(requestRest, 'method')).toUpperCase();
  const url = urlFromPostman(take(requestRest, 'url'));
  const headers = asArray(take(requestRest, 'header')).map(keyValueFromPostman);
  let body = bodyFromPostman(take(requestRest, 'body'));
  // GraphQL operation name: Postman has no field for it, Pigeon keeps it in `_pigeon`.
  if (body.mode === 'graphql' && typeof pigeon['operationName'] === 'string') {
    body = { ...body, operationName: take(pigeon, 'operationName') as string };
  }
  // GraphQL schema file (PIGN-055): `_pigeon.graphql.schemaFile`; other keys there are kept.
  if (body.mode === 'graphql') {
    const graphql = { ...asObject(pigeon['graphql']) };
    if (typeof graphql['schemaFile'] === 'string') {
      body = { ...body, schemaFile: take(graphql, 'schemaFile') as string };
      if (nonEmpty(graphql)) pigeon['graphql'] = graphql;
      else delete pigeon['graphql'];
    }
  }
  if (nonEmpty(requestRest)) extra['request'] = requestRest;
  if (nonEmpty(profile)) extra['protocolProfileBehavior'] = profile;
  if (nonEmpty(pigeon)) extra['_pigeon'] = pigeon;

  return {
    kind: 'request',
    id,
    fileKey,
    name,
    ...(description === undefined ? {} : { description }),
    method,
    url,
    headers,
    body,
    ...(auth === undefined ? {} : { auth: authFromPostman(auth) }),
    events: asArray(event),
    settings,
    examples: [],
    extra,
  };
}

export function urlFromPostman(value: unknown): ProjectUrl {
  if (typeof value === 'string') return { raw: value, query: [], pathVariables: [], extra: {} };
  const rest = { ...asObject(value) };
  const raw = asString(take(rest, 'raw'));
  const query = asArray(take(rest, 'query')).map(keyValueFromPostman);
  const pathVariables = asArray(take(rest, 'variable')).map(keyValueFromPostman);
  // Derived parts are regenerated from `raw` on Postman export (file-format.md §2.4).
  for (const derived of ['protocol', 'host', 'path', 'port']) delete rest[derived];
  return { raw, query, pathVariables, extra: rest };
}

export function keyValueFromPostman(value: unknown): ProjectKeyValue {
  const rest = { ...asObject(value) };
  const row: ProjectKeyValue = { key: asString(take(rest, 'key')), value: '' };
  const rawValue = take(rest, 'value');
  if (typeof rawValue === 'string') row.value = rawValue;
  else if (rawValue === null) rest['valueNull'] = true;
  else if (rawValue !== undefined) row.value = String(rawValue);
  if (typeof rest['disabled'] === 'boolean') row.disabled = take(rest, 'disabled') as boolean;
  const description = takeDescription(rest);
  if (description !== undefined) row.description = description;
  if (typeof rest['type'] === 'string') row.type = take(rest, 'type') as string;
  if (nonEmpty(rest)) row.extra = rest;
  return row;
}

function formDataFromPostman(value: unknown): ProjectFormDataParam {
  const rest = { ...asObject(value) };
  const kind = rest['type'] === 'file' ? 'file' : 'text';
  if (kind === 'file') delete rest['type'];
  const src = rest['src'];
  const validSrc =
    typeof src === 'string' || (Array.isArray(src) && src.every((s) => typeof s === 'string'));
  if (validSrc) delete rest['src'];
  const contentType =
    typeof rest['contentType'] === 'string' ? (take(rest, 'contentType') as string) : undefined;
  return {
    ...keyValueFromPostman(rest),
    kind,
    ...(validSrc ? { src: src as string | string[] } : {}),
    ...(contentType === undefined ? {} : { contentType }),
  };
}

export function bodyFromPostman(value: unknown): ProjectBody {
  if (!isObject(value)) return { mode: 'none' };
  const rest = { ...value };
  const mode = take(rest, 'mode');
  const disabled =
    typeof rest['disabled'] === 'boolean' ? (take(rest, 'disabled') as boolean) : undefined;
  const common = (): { disabled?: boolean; extra?: ExtraFields } => ({
    ...(disabled === undefined ? {} : { disabled }),
    ...(nonEmpty(rest) ? { extra: rest } : {}),
  });

  switch (mode) {
    case 'raw': {
      const raw = asString(take(rest, 'raw'));
      const options = asObject(rest['options']);
      const language = toRawLanguage(asObject(options['raw'])['language']);
      return { mode, raw, language, ...common() };
    }
    case 'urlencoded':
      return {
        mode,
        params: asArray(take(rest, 'urlencoded')).map(keyValueFromPostman),
        ...common(),
      };
    case 'formdata':
      return {
        mode,
        params: asArray(take(rest, 'formdata')).map(formDataFromPostman),
        ...common(),
      };
    case 'file': {
      const file = { ...asObject(take(rest, 'file')) };
      const src = typeof file['src'] === 'string' ? (take(file, 'src') as string) : undefined;
      if (nonEmpty(file)) rest['file'] = file;
      return { mode, ...(src === undefined ? {} : { src }), ...common() };
    }
    case 'graphql': {
      const graphql = { ...asObject(take(rest, 'graphql')) };
      const query = asString(take(graphql, 'query'));
      const variables = take(graphql, 'variables');
      // Postman stores variables as JSON text; an object (other tools) is written as text.
      const variablesText =
        typeof variables === 'string'
          ? variables
          : variables === undefined || variables === null
            ? ''
            : JSON.stringify(variables, null, 2);
      const operationName =
        typeof graphql['operationName'] === 'string' ? graphql['operationName'] : undefined;
      if (nonEmpty(graphql)) rest['graphql'] = graphql;
      return {
        mode,
        query,
        variables: variablesText,
        ...(operationName === undefined ? {} : { operationName }),
        ...common(),
      };
    }
    case undefined:
    case 'none':
      return { mode: 'none', ...common() };
    default:
      return { mode: 'none', extra: { [UNSUPPORTED_BODY]: value } };
  }
}

// --- Writing -----------------------------------------------------------------------------------

/** Maps a normalized request back to its project-file JSON (Postman `item` without `response`). */
export function requestToPostmanItem(request: ProjectRequest): JsonObject {
  const {
    request: requestExtra,
    protocolProfileBehavior: profileExtra,
    _pigeon: pigeonExtra,
    ...itemExtra
  } = request.extra;
  const { timeoutMs, includeCredentials, ...profileSettings } = request.settings;
  const profile = { ...asObject(profileExtra), ...profileSettings };
  const graphqlName =
    request.body.mode === 'graphql' &&
    request.body.operationName !== undefined &&
    !('operationName' in asObject(asObject(request.body.extra)['graphql']))
      ? request.body.operationName
      : undefined;
  const pigeonRest = asObject(pigeonExtra);
  const schemaFile =
    request.body.mode === 'graphql' && request.body.schemaFile
      ? request.body.schemaFile
      : undefined;
  const graphqlPigeon = {
    ...asObject(pigeonRest['graphql']),
    ...(schemaFile === undefined ? {} : { schemaFile }),
  };
  const pigeon = {
    ...pigeonRest,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(includeCredentials === undefined ? {} : { includeCredentials }),
    ...(graphqlName === undefined ? {} : { operationName: graphqlName }),
    ...(nonEmpty(graphqlPigeon) ? { graphql: graphqlPigeon } : {}),
  };
  const body = bodyToPostman(request.body);

  return {
    ...itemExtra,
    id: request.id,
    name: request.name,
    request: {
      ...asObject(requestExtra),
      method: request.method,
      ...(request.headers.length === 0 ? {} : { header: request.headers.map(keyValueToPostman) }),
      ...(body === undefined ? {} : { body }),
      url: urlToPostman(request.url),
      ...(request.description === undefined ? {} : { description: request.description }),
      ...(request.auth === undefined ? {} : { auth: authToPostman(request.auth) }),
    },
    ...(request.events.length === 0 ? {} : { event: request.events }),
    ...(nonEmpty(profile) ? { protocolProfileBehavior: profile } : {}),
    ...(nonEmpty(pigeon) ? { _pigeon: pigeon } : {}),
  };
}

export function urlToPostman(url: ProjectUrl): JsonObject {
  return {
    ...url.extra,
    raw: url.raw,
    ...(url.query.length === 0 ? {} : { query: url.query.map(keyValueToPostman) }),
    ...(url.pathVariables.length === 0
      ? {}
      : { variable: url.pathVariables.map(keyValueToPostman) }),
  };
}

export function keyValueToPostman(row: ProjectKeyValue): JsonObject {
  const { valueNull, ...extra } = row.extra ?? {};
  return {
    ...extra,
    key: row.key,
    value: valueNull === true && row.value === '' ? null : row.value,
    ...(row.type === undefined ? {} : { type: row.type }),
    ...(row.disabled === true ? { disabled: true } : {}),
    ...(row.description === undefined ? {} : { description: row.description }),
  };
}

function formDataToPostman(row: ProjectFormDataParam): JsonObject {
  return {
    ...keyValueToPostman(row),
    type: row.kind === 'file' ? 'file' : (row.type ?? 'text'),
    ...(row.src === undefined ? {} : { src: row.src }),
    ...(row.contentType === undefined ? {} : { contentType: row.contentType }),
  };
}

/** `undefined` when the request has no body (mode `none`, nothing preserved). */
export function bodyToPostman(body: ProjectBody): JsonObject | undefined {
  const extra = { ...body.extra };
  if (body.mode === 'none' && isObject(extra[UNSUPPORTED_BODY])) return extra[UNSUPPORTED_BODY];
  const disabled = body.disabled === true ? { disabled: true } : {};

  switch (body.mode) {
    case 'none':
      return nonEmpty(extra) || body.disabled === true
        ? { ...extra, mode: 'none', ...disabled }
        : undefined;
    case 'raw': {
      const options = asObject(extra['options']);
      const rawOptions = asObject(options['raw']);
      if (toRawLanguage(rawOptions['language']) !== body.language) {
        extra['options'] = { ...options, raw: { ...rawOptions, language: body.language } };
      }
      return { ...extra, mode: 'raw', raw: body.raw, ...disabled };
    }
    case 'urlencoded':
      return {
        ...extra,
        mode: 'urlencoded',
        urlencoded: body.params.map(keyValueToPostman),
        ...disabled,
      };
    case 'formdata':
      return {
        ...extra,
        mode: 'formdata',
        formdata: body.params.map(formDataToPostman),
        ...disabled,
      };
    case 'file': {
      const file = {
        ...asObject(extra['file']),
        ...(body.src === undefined ? {} : { src: body.src }),
      };
      return { ...extra, mode: 'file', file, ...disabled };
    }
    case 'graphql': {
      // The operation name lives in `graphql` only when the file had it there (otherwise in
      // the item's `_pigeon.operationName`, see `requestToPostmanItem`).
      const graphql = asObject(extra['graphql']);
      const { operationName: _operationName, ...graphqlExtra } = graphql;
      return {
        ...extra,
        mode: 'graphql',
        graphql: {
          ...graphqlExtra,
          query: body.query,
          variables: body.variables,
          ...('operationName' in graphql && body.operationName !== undefined
            ? { operationName: body.operationName }
            : {}),
        },
        ...disabled,
      };
    }
  }
}

// --- Helpers -----------------------------------------------------------------------------------

function toRawLanguage(value: unknown): RawLanguage {
  return RAW_LANGUAGES.find((language) => language === value) ?? 'text';
}

/** Removes `key` from `record` and returns its value. */
function take(record: JsonObject, key: string): unknown {
  const value = record[key];
  delete record[key];
  return value;
}

/** Takes `description` only when it has a valid Postman description shape. */
function takeDescription(record: JsonObject): Description | undefined {
  return isDescription(record['description'])
    ? (take(record, 'description') as Description)
    : undefined;
}
