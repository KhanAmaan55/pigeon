/**
 * Postman Collection v2.1 (and v2.0, converted first) → a project `Collection` with its folders,
 * requests and examples (compatibility.md Part A). Pure: ids, file keys and the report only
 * depend on the input and the options.
 */

import { allocateSlug, slugify } from '../slug';
import type {
  Collection,
  ExampleBody,
  ExampleBodyFormat,
  ProjectExample,
  ProjectItem,
  ProjectRequest,
} from '../project/types';
import { collectionFromPostman, folderFromPostman } from './collection';
import { convertCollectionV20, headersFromString } from './collection-v20';
import { exampleFromPostman } from './example';
import { requestFromPostmanItem } from './item';
import { asArray, asObject, asString, compareStrings, isObject, type JsonObject } from './json';

export interface ImportReport {
  /** Source format, e.g. `Postman Collection v2.1`. */
  format: string;
  counts: { folders: number; requests: number; examples: number };
  warnings: string[];
  /** Ids that were taken (in the project or earlier in the file) and replaced. */
  regeneratedIds: Array<{
    kind: 'collection' | 'folder' | 'request' | 'example';
    name: string;
    from: string;
    to: string;
  }>;
}

export interface ImportOptions {
  /** Ids already used in the project (entities and examples). */
  existingIds?: ReadonlySet<string>;
  /** Fresh ids (tests make them deterministic). */
  newId?: () => string;
}

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;
const TEXT_FORMATS: Record<string, ExampleBodyFormat> = {
  json: 'json',
  xml: 'xml',
  html: 'html',
  javascript: 'javascript',
  text: 'text',
};

export function importPostmanCollection(
  source: JsonObject,
  version: '2.1' | '2.0',
  options: ImportOptions = {},
): { collection: Collection; report: ImportReport } {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const taken = new Set(options.existingIds ?? []);
  const raw = version === '2.0' ? convertCollectionV20(source) : source;
  const report: ImportReport = {
    format: `Postman Collection v${version}`,
    counts: { folders: 0, requests: 0, examples: 0 },
    warnings: version === '2.0' ? ['Converted from Postman Collection v2.0 to v2.1.'] : [],
    regeneratedIds: [],
  };
  const unsupportedAuth = new Map<string, number>();
  let scripts = 0;
  const absolutePaths: string[] = [];
  const urlMismatches: string[] = [];
  const filledPathVariables: string[] = [];
  let generatedIds = 0;

  /** Keeps `id` when it is free, else a fresh one (recorded in the report). */
  const claim = (
    kind: ImportReport['regeneratedIds'][number]['kind'],
    id: unknown,
    name: string,
  ) => {
    if (typeof id !== 'string' || id === '') {
      generatedIds += 1;
      const fresh = newId();
      taken.add(fresh);
      return fresh;
    }
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
    const fresh = newId();
    taken.add(fresh);
    report.regeneratedIds.push({ kind, name, from: id, to: fresh });
    return fresh;
  };
  const noteAuth = (auth: unknown) => {
    if (!isObject(auth) || typeof auth['type'] !== 'string') return;
    if (!['noauth', 'basic', 'bearer', 'apikey'].includes(auth['type'])) {
      unsupportedAuth.set(auth['type'], (unsupportedAuth.get(auth['type']) ?? 0) + 1);
    }
  };
  const noteEvents = (events: unknown) => {
    for (const event of asArray(events)) {
      const exec = asObject(asObject(event)['script'])['exec'];
      const text = Array.isArray(exec) ? exec.join('\n') : typeof exec === 'string' ? exec : '';
      if (text.trim() !== '') scripts += 1;
    }
  };

  const mapItems = (items: unknown[], path: string): ProjectItem[] => {
    const keys = new Set<string>();
    const children: ProjectItem[] = [];
    for (const entry of items) {
      if (!isObject(entry)) continue;
      const name = asString(entry['name']);
      noteAuth(entry['auth']);
      noteEvents(entry['event']);
      if (Array.isArray(entry['item'])) {
        const { item, ...rest } = entry;
        const id = claim('folder', rest['id'], name);
        const fileKey = allocateSlug(slugify(name, { kind: 'folder', id }), keys);
        const folder = folderFromPostman(
          { ...rest, id },
          fileKey,
          mapItems(item, `${path}${name}/`),
        );
        children.push(folder);
        report.counts.folders += 1;
        continue;
      }
      const request = mapRequest(entry, name, path);
      request.fileKey = allocateSlug(slugify(name, { kind: 'request', id: request.id }), keys);
      children.push(request);
    }
    return children;
  };

  const mapRequest = (entry: JsonObject, name: string, path: string): ProjectRequest => {
    const { response, ...item } = entry;
    const id = claim('request', item['id'], name);
    // `request` may be a plain URL string (GET).
    const requestValue = item['request'];
    const requestObject: JsonObject = isObject(requestValue)
      ? { ...requestValue }
      : { method: 'GET', url: typeof requestValue === 'string' ? requestValue : '' };
    if (typeof requestObject['header'] === 'string') {
      requestObject['header'] = headersFromString(requestObject['header']);
    }
    noteAuth(requestObject['auth']);
    checkUrl(requestObject, `${path}${name}`);
    const request = requestFromPostmanItem({ ...item, id, request: requestObject }, '');
    for (const src of fileSources(request)) {
      if (ABSOLUTE_PATH.test(src)) absolutePaths.push(`${path}${name}: ${src}`);
    }
    const exampleKeys = new Set<string>();
    // Examples have no order of their own in a project: file-key order, as the reader gives.
    request.examples = asArray(response)
      .filter(isObject)
      .map((raw) => mapExample(raw, id, exampleKeys))
      .sort((a, b) => compareStrings(a.fileKey, b.fileKey));
    report.counts.requests += 1;
    report.counts.examples += request.examples.length;
    return request;
  };

  const mapExample = (raw: JsonObject, requestId: string, keys: Set<string>): ProjectExample => {
    const name =
      asString(raw['name']) || `${asString(raw['code'])} ${asString(raw['status'])}`.trim();
    const id = claim('example', raw['id'], name);
    const headers =
      typeof raw['header'] === 'string' ? headersFromString(raw['header']) : raw['header'];
    const { body, ...rest }: JsonObject = { ...raw, header: headers };
    const example = exampleFromPostman(
      { ...rest, id, _pigeon: { ...asObject(raw['_pigeon']), requestId } },
      allocateSlug(slugify(name, { kind: 'example', id }), keys),
      exampleBodyOf(body, raw),
    );
    return example;
  };

  /** A URL object whose derived parts disagree with `raw` (raw wins, compatibility §A.4). */
  const checkUrl = (request: JsonObject, label: string) => {
    const url = request['url'];
    if (!isObject(url)) return;
    const host = Array.isArray(url['host']) ? url['host'].join('.') : asString(url['host']);
    const pathParts = Array.isArray(url['path']) ? url['path'].join('/') : asString(url['path']);
    if (typeof url['raw'] !== 'string' || url['raw'] === '') {
      if (host === '' && pathParts === '') return;
      // No raw: build it from the parts.
      const protocol = typeof url['protocol'] === 'string' ? `${url['protocol']}://` : '';
      const port = url['port'] === undefined ? '' : `:${asString(url['port'])}`;
      const query = asArray(url['query'])
        .filter(isObject)
        .map(
          (q) => `${asString(q['key'])}${q['value'] === null ? '' : `=${asString(q['value'])}`}`,
        );
      request['url'] = {
        ...url,
        raw: `${protocol}${host}${port}${pathParts ? `/${pathParts}` : ''}${query.length ? `?${query.join('&')}` : ''}`,
      };
      return;
    }
    const raw = url['raw'].split(/[?#]/)[0]!.replace(/^[a-z][a-z\d+.-]*:\/\//i, '');
    const hostPort = `${host}${url['port'] === undefined ? '' : `:${asString(url['port'])}`}`;
    const parts = `${hostPort}${pathParts ? `/${pathParts}` : ''}`;
    if (host === '' || raw.replace(/\/$/, '') === parts.replace(/\/$/, '')) return;
    const filled = fillPathVariables(url, raw, hostPort);
    if (filled) {
      request['url'] = filled.url;
      filledPathVariables.push(`${label} (${filled.names.join(', ')})`);
    } else urlMismatches.push(label);
  };

  const info = asObject(raw['info']);
  const name = asString(info['name']) || 'Imported collection';
  noteAuth(raw['auth']);
  noteEvents(raw['event']);
  const { item, ...root } = raw;
  const collectionId = claim('collection', info['_postman_id'], name);
  const collection = collectionFromPostman(
    { ...root, info: { ...info, _postman_id: collectionId } },
    slugify(name, { kind: 'collection', id: collectionId }),
    mapItems(asArray(item), ''),
  );
  if (version === '2.0') {
    // The v2.0 schema URL is replaced by v2.1's on write.
    const infoExtra = asObject(collection.extra['info']);
    delete infoExtra['schema'];
    if (Object.keys(infoExtra).length === 0) delete collection.extra['info'];
    else collection.extra['info'] = infoExtra;
  }

  for (const [type, count] of unsupportedAuth) {
    report.warnings.push(
      `${type} auth (${count}×) is not supported yet: kept as is, requests are sent without it.`,
    );
  }
  if (scripts > 0) {
    report.warnings.push(
      `${scripts} script${scripts === 1 ? ' is' : 's are'} kept but not run yet.`,
    );
  }
  if (absolutePaths.length > 0) {
    report.warnings.push(
      `Absolute file paths are kept as they are (they only work on this machine): ${absolutePaths.join('; ')}.`,
    );
  }
  if (filledPathVariables.length > 0) {
    report.warnings.push(
      `Path variables without a value were filled from the URL's path parts (as Postman sends them): ${filledPathVariables.join('; ')}.`,
    );
  }
  if (urlMismatches.length > 0) {
    report.warnings.push(
      `URL parts disagree with the raw URL (the raw URL is used): ${urlMismatches.join(', ')}.`,
    );
  }
  if (generatedIds > 0) {
    report.warnings.push(
      `${generatedIds} item${generatedIds === 1 ? '' : 's'} without an id got one.`,
    );
  }
  return { collection, report };
}

/** Form-data and binary body file sources of a request. */
function fileSources(request: ProjectRequest): string[] {
  const { body } = request;
  if (body.mode === 'file') return body.src ? [body.src] : [];
  if (body.mode !== 'formdata') return [];
  return body.params.flatMap((param) =>
    param.kind === 'file' && param.src !== undefined
      ? typeof param.src === 'string'
        ? [param.src]
        : param.src
      : [],
  );
}

/**
 * An inline Postman example body as a sidecar body: the format from `_postman_previewlanguage`,
 * else the `Content-Type` header; JSON that doesn't parse is kept as text (`.body.txt`).
 */
function exampleBodyOf(body: unknown, raw: JsonObject): ExampleBody {
  if (typeof body !== 'string' || body === '') {
    return body === undefined || body === null || body === ''
      ? { kind: 'none' }
      : { kind: 'text', text: JSON.stringify(body), format: 'json' };
  }
  const language = asString(raw['_postman_previewlanguage']).toLowerCase();
  const contentType = asArray(raw['header'])
    .filter(isObject)
    .find((h) => asString(h['key']).toLowerCase() === 'content-type');
  const type = asString(contentType?.['value']).toLowerCase();
  let format: ExampleBodyFormat =
    TEXT_FORMATS[language] ??
    (type.includes('json')
      ? 'json'
      : type.includes('xml')
        ? 'xml'
        : type.includes('html')
          ? 'html'
          : type.includes('javascript')
            ? 'javascript'
            : 'text');
  if (format === 'json') {
    try {
      JSON.parse(body);
    } catch {
      format = 'text';
    }
  }
  return { kind: 'text', text: body, format };
}

/**
 * When the raw URL and the derived `path` differ only where the raw URL has a `:name` path
 * variable without a value (e.g. raw `…/airports/:airport_id`, path `["airports",
 * "{{airport_id}}"]`), Postman sends the path parts: the variable gets that part as its value.
 * `null` when the difference is anything else (the raw URL then wins, compatibility §A.4).
 */
function fillPathVariables(
  url: JsonObject,
  rawWithoutScheme: string,
  hostPort: string,
): { url: JsonObject; names: string[] } | null {
  const slash = rawWithoutScheme.indexOf('/');
  const rawHost = slash === -1 ? rawWithoutScheme : rawWithoutScheme.slice(0, slash);
  if (rawHost !== hostPort) return null;
  const trim = (segments: string[]) => (segments.at(-1) === '' ? segments.slice(0, -1) : segments);
  const rawSegments = trim(slash === -1 ? [] : rawWithoutScheme.slice(slash + 1).split('/'));
  const partSegments = trim(
    Array.isArray(url['path'])
      ? url['path'].map((segment) =>
          isObject(segment) ? asString(segment['value']) : asString(segment),
        )
      : asString(url['path']).split('/'),
  );
  if (rawSegments.length !== partSegments.length) return null;
  const variables = asArray(url['variable']).map((entry) => ({ ...asObject(entry) }));
  const names: string[] = [];
  for (const [index, rawSegment] of rawSegments.entries()) {
    const part = partSegments[index]!;
    if (rawSegment === part) continue;
    const name = /^:([\w.-]+)$/.exec(rawSegment)?.[1];
    if (!name || part === '' || part.startsWith(':')) return null;
    const existing = variables.find((v) => v['key'] === name);
    if (existing && asString(existing['value']) !== '') return null;
    if (existing) existing['value'] = part;
    else variables.push({ key: name, value: part });
    names.push(`:${name} = ${part}`);
  }
  return names.length === 0 ? null : { url: { ...url, variable: variables }, names };
}
