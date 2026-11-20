import type { KeyOrderPath, KeyOrderSpec } from '../canonical-json';

export type ProjectFileKind =
  'pigeon' | 'collection' | 'folder' | 'request' | 'environment' | 'example';

const KINDS = {
  pigeon: ['pigeon', 'id', 'name', 'collections', 'comparison'],
  comparison: ['status', 'headers', 'body', 'rules'],
  comparisonHeaders: ['compare', 'mode'],
  comparisonBody: ['mode', 'additionalFields', 'distinguishIntegers'],
  collection: ['info', 'auth', 'event', 'variable'],
  info: ['_postman_id', 'name', 'description', 'version', 'schema'],
  folder: ['id', 'name', 'description', 'auth', 'event', 'variable'],
  item: ['id', 'name', 'description', 'request', 'event', 'protocolProfileBehavior'],
  request: ['method', 'header', 'body', 'url', 'description', 'auth'],
  url: ['raw', 'protocol', 'host', 'port', 'path', 'query', 'hash', 'variable'],
  header: ['key', 'value', 'type', 'disabled', 'description'],
  body: ['mode', 'raw', 'options', 'urlencoded', 'formdata', 'file', 'graphql', 'disabled'],
  auth: ['type'],
  event: ['listen', 'script', 'disabled'],
  script: ['id', 'type', 'exec', 'src', 'name'],
  variable: ['key', 'value', 'type', 'enabled', 'disabled', 'description'],
  protocolProfileBehavior: ['followRedirects', 'maxRedirects', 'strictSSL'],
  environment: ['id', 'name', 'values', '_postman_variable_scope'],
  envVariable: ['key', 'value', 'type', 'enabled', 'description'],
  example: [
    'id',
    'name',
    'originalRequest',
    'status',
    'code',
    '_postman_previewlanguage',
    'header',
    'cookie',
    'responseTime',
    'body',
  ],
  examplePigeon: ['requestId', 'bodyFile'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const PATH_KINDS: Readonly<Record<ProjectFileKind, Readonly<Record<string, keyof typeof KINDS>>>> =
  {
    pigeon: {
      '': 'pigeon',
      comparison: 'comparison',
      'comparison.headers': 'comparisonHeaders',
      'comparison.body': 'comparisonBody',
    },
    collection: {
      '': 'collection',
      info: 'info',
      auth: 'auth',
      event: 'event',
      'event.script': 'script',
      variable: 'variable',
    },
    folder: {
      '': 'folder',
      auth: 'auth',
      event: 'event',
      'event.script': 'script',
      variable: 'variable',
    },
    environment: {
      '': 'environment',
      values: 'envVariable',
    },
    example: {
      '': 'example',
      originalRequest: 'request',
      'originalRequest.url': 'url',
      'originalRequest.body': 'body',
      'originalRequest.auth': 'auth',
      _pigeon: 'examplePigeon',
    },
    request: {
      '': 'item',
      request: 'request',
      'request.url': 'url',
      'request.header': 'header',
      'request.body': 'body',
      'request.auth': 'auth',
      event: 'event',
      'event.script': 'script',
      protocolProfileBehavior: 'protocolProfileBehavior',
    },
  };

/** Key-order specifications for every JSON file PIGN-013 will write. */
export const PROJECT_KEY_ORDERS: Readonly<Record<ProjectFileKind, KeyOrderSpec>> = {
  pigeon: createProjectKeyOrder('pigeon'),
  collection: createProjectKeyOrder('collection'),
  folder: createProjectKeyOrder('folder'),
  request: createProjectKeyOrder('request'),
  environment: createProjectKeyOrder('environment'),
  example: createProjectKeyOrder('example'),
};

/** Returns the canonical ordering specification for a particular project file. */
export function createProjectKeyOrder(fileKind: ProjectFileKind): KeyOrderSpec {
  const pathKinds = PATH_KINDS[fileKind];
  return {
    kinds: KINDS,
    kindForPath(path: KeyOrderPath): string | undefined {
      if (fileKind === 'environment') return pathKinds[path.join('.')];
      if (path.at(-2) === 'auth') return 'header';
      if (['header', 'query', 'variable', 'urlencoded', 'formdata'].includes(path.at(-1) ?? '')) {
        return 'header';
      }
      return pathKinds[path.join('.')];
    },
  };
}
