/**
 * Reads a Pigeon project folder (docs/file-format.md §1–2) through `ProjectFileSystem`.
 *
 * Tolerant by design: a malformed managed file becomes a `Problem` plus a read-only `broken`
 * placeholder entity, and never hides the rest of the project. Unmanaged files are ignored.
 */

import type { ProjectFileSystem, ProjectPath } from '@pigeon/platform';

import { contentHash } from '../hash';
import { environmentFromPostman, globalsFromPostman } from '../postman/environment';
import { EXAMPLE_SUFFIX, exampleBodyFromFile, exampleFromPostman } from '../postman/example';
import { COMPARE_FILE, comparisonFromFile } from './comparison';
import { collectionFromPostman, folderFromPostman } from '../postman/collection';
import { requestFromPostmanItem } from '../postman/item';
import {
  asArray,
  asObject,
  asString,
  compareStrings,
  isObject,
  nonEmpty,
  without,
} from '../postman/json';
import type { JsonObject } from '../postman/json';
import {
  CollectionFileSchema,
  FolderFileSchema,
  ProjectFileSchema,
  RequestFileSchema,
} from './schemas';
import type {
  ExampleBody,
  ProjectEnvironment,
  Collection,
  Folder,
  Problem,
  ProjectItem,
  ProjectModel,
  ProjectReadResult,
  ProjectRequest,
} from './types';

/** The newest `pigeon.formatVersion` this build reads and writes. */
export const CURRENT_FORMAT_VERSION = 1;

const REQUEST_SUFFIX = '.request.json';
const decoder = new TextDecoder('utf-8', { fatal: true });

interface ReadContext {
  readonly fs: ProjectFileSystem;
  readonly files: Map<ProjectPath, { hash: string }>;
  readonly problems: Problem[];
}

export async function readProject(fs: ProjectFileSystem): Promise<ProjectReadResult> {
  const context: ReadContext = { fs, files: new Map(), problems: [] };
  const result = (model: ProjectModel, readOnly: boolean): ProjectReadResult => ({
    model,
    files: context.files,
    problems: context.problems,
    readOnly,
  });

  if (!(await fs.exists('pigeon.json'))) {
    context.problems.push(
      error('pigeon.json', 'missing', 'Not a Pigeon project: pigeon.json is missing'),
    );
    return result(placeholderProject(), true);
  }

  const manifest = await readJson(context, 'pigeon.json');
  const parsed = manifest === undefined ? undefined : ProjectFileSchema.safeParse(manifest);
  if (manifest === undefined || parsed === undefined || !parsed.success) {
    if (parsed !== undefined && !parsed.success) {
      context.problems.push(error('pigeon.json', 'schema', parsed.error.message));
    }
    return result(placeholderProject(), true);
  }

  const model = projectFromFile(manifest);
  const collectionKeys = await childDirectories(fs, 'collections');
  const collections: Collection[] = [];
  for (const fileKey of collectionKeys) {
    if (await fs.exists(`collections/${fileKey}/collection.json`)) {
      collections.push(await readCollection(context, fileKey));
    }
  }
  model.collections = applyOrder(
    collections,
    parsed.data.collections,
    'pigeon.json',
    context.problems,
  );
  await readExamples(context, model);
  model.environments = await readEnvironments(context);
  const globals = await readGlobals(context);
  if (globals) model.globals = globals;
  return result(model, model.formatVersion > CURRENT_FORMAT_VERSION);
}

const ENVIRONMENT_SUFFIX = '.postman_environment.json';
export const GLOBALS_PATH = 'environments/globals.postman_globals.json';

/** Project globals, when the file exists (a broken file reads as none and is reported). */
async function readGlobals(context: ReadContext) {
  if ((await context.fs.stat(GLOBALS_PATH))?.kind !== 'file') return undefined;
  const raw = await readJson(context, GLOBALS_PATH);
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw['values'])) {
    context.problems.push(error(GLOBALS_PATH, 'schema', 'Globals need a "values" array'));
    return undefined;
  }
  const globals = globalsFromPostman(raw);
  if (globals.id === '') globals.id = 'globals';
  return globals;
}

/** `environments/*.postman_environment.json`, by file key (file-format.md §1, §2.5). */
async function readEnvironments(context: ReadContext): Promise<ProjectEnvironment[]> {
  if ((await context.fs.stat('environments'))?.kind !== 'dir') return [];
  const environments: ProjectEnvironment[] = [];
  for (const entry of await context.fs.list('environments')) {
    const name = entry.path.slice('environments/'.length);
    if (entry.kind !== 'file' || !name.endsWith(ENVIRONMENT_SUFFIX) || name === ENVIRONMENT_SUFFIX)
      continue;
    const fileKey = name.slice(0, -ENVIRONMENT_SUFFIX.length);
    const raw = await readJson(context, entry.path);
    const valid =
      raw !== undefined && Array.isArray(raw['values']) && typeof raw['name'] === 'string';
    if (raw !== undefined && !valid) {
      context.problems.push(
        error(entry.path, 'schema', 'An environment needs a "name" and a "values" array'),
      );
    }
    if (!valid) {
      environments.push({
        id:
          typeof raw?.['id'] === 'string' && raw['id'] !== ''
            ? raw['id']
            : `broken:environment:${fileKey}`,
        fileKey,
        name: typeof raw?.['name'] === 'string' ? raw['name'] : fileKey,
        values: [],
        extra: {},
        broken: true,
      });
      continue;
    }
    const environment = environmentFromPostman(raw, fileKey);
    // Hand-written files may lack an id: a stable one from the file name.
    if (environment.id === '') environment.id = `environment:${fileKey}`;
    environments.push(environment);
  }
  return environments.sort((a, b) => compareStrings(a.fileKey, b.fileKey));
}

async function readCollection(context: ReadContext, fileKey: string): Promise<Collection> {
  const directory = `collections/${fileKey}`;
  const path = `${directory}/collection.json`;
  const raw = await readJson(context, path);
  const children = await readChildren(context, directory);
  const parsed = raw === undefined ? undefined : CollectionFileSchema.safeParse(raw);
  if (raw === undefined || parsed === undefined || !parsed.success) {
    if (parsed !== undefined && !parsed.success)
      context.problems.push(error(path, 'schema', parsed.error.message));
    const info = asObject(raw?.['info']);
    return {
      kind: 'collection',
      ...brokenIdentity('collection', fileKey, info['_postman_id'], info['name']),
      events: [],
      variables: [],
      children,
      extra: {},
      broken: true,
    };
  }

  const pigeon = asObject(raw['_pigeon']);
  return collectionFromPostman(
    raw,
    fileKey,
    applyOrder(children, stringArray(pigeon['order']), path, context.problems),
  );
}

/** Requests (`*.request.json`) and folders (directories with `folder.json`) directly in `directory`. */
async function readChildren(context: ReadContext, directory: ProjectPath): Promise<ProjectItem[]> {
  const children: ProjectItem[] = [];
  for (const entry of await context.fs.list(directory)) {
    const name = entry.path.slice(directory.length + 1);
    if (
      entry.kind === 'file' &&
      name.endsWith(REQUEST_SUFFIX) &&
      name.length > REQUEST_SUFFIX.length
    ) {
      children.push(await readRequest(context, entry.path, name.slice(0, -REQUEST_SUFFIX.length)));
    } else if (entry.kind === 'dir' && (await context.fs.exists(`${entry.path}/folder.json`))) {
      children.push(await readFolder(context, entry.path, name));
    }
  }
  return children;
}

async function readFolder(
  context: ReadContext,
  directory: ProjectPath,
  fileKey: string,
): Promise<Folder> {
  const path = `${directory}/folder.json`;
  const raw = await readJson(context, path);
  const children = await readChildren(context, directory);
  const parsed = raw === undefined ? undefined : FolderFileSchema.safeParse(raw);
  if (raw === undefined || parsed === undefined || !parsed.success) {
    if (parsed !== undefined && !parsed.success)
      context.problems.push(error(path, 'schema', parsed.error.message));
    return {
      kind: 'folder',
      ...brokenIdentity('folder', fileKey, raw?.['id'], raw?.['name']),
      events: [],
      variables: [],
      children,
      extra: {},
      broken: true,
    };
  }

  const pigeon = asObject(raw['_pigeon']);
  return folderFromPostman(
    raw,
    fileKey,
    applyOrder(children, stringArray(pigeon['order']), path, context.problems),
  );
}

async function readRequest(
  context: ReadContext,
  path: ProjectPath,
  fileKey: string,
): Promise<ProjectRequest> {
  const raw = await readJson(context, path);
  const parsed = raw === undefined ? undefined : RequestFileSchema.safeParse(raw);
  if (raw === undefined || parsed === undefined || !parsed.success) {
    if (parsed !== undefined && !parsed.success)
      context.problems.push(error(path, 'schema', parsed.error.message));
    return {
      kind: 'request',
      ...brokenIdentity('request', fileKey, raw?.['id'], raw?.['name']),
      method: 'GET',
      url: { raw: '', query: [], pathVariables: [], extra: {} },
      headers: [],
      body: { mode: 'none' },
      events: [],
      settings: {},
      examples: [],
      extra: {},
      broken: true,
    };
  }
  return requestFromPostmanItem(raw, fileKey);
}

/** `compare.json` files (PIGN-035): each joins the request its `requestId` names. */
async function readComparisons(
  context: ReadContext,
  model: ProjectModel,
  requests: ReadonlyMap<string, ProjectRequest>,
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    const raw = await readJson(context, path);
    if (raw === undefined) continue;
    const { requestId, config } = comparisonFromFile(raw);
    const request = requests.get(requestId);
    if (request && !request.broken && !request.comparison) {
      request.comparison = config;
      continue;
    }
    const directory = path.slice(0, path.lastIndexOf('/'));
    (model.orphanComparisons ??= []).push({ directory, requestId, config });
    context.problems.push({
      path,
      kind: 'orphan',
      severity: 'warning',
      message: request
        ? 'A second comparison config for the same request is kept but not used.'
        : `Comparison config for a request that is not in the project (${requestId || 'no requestId'}).`,
    });
  }
}

/**
 * `examples/**\/*.example.json` (file-format.md §2.6) with their body sidecars. Each joins the
 * request its `_pigeon.requestId` names, wherever it sits on disk (the next commit of that
 * request moves it under the request's directory); unmatched ones are kept as orphans.
 */
async function readExamples(context: ReadContext, model: ProjectModel): Promise<void> {
  if ((await context.fs.stat('examples'))?.kind !== 'dir') return;
  const requests = new Map<string, ProjectRequest>();
  const visit = (items: readonly ProjectItem[]) => {
    for (const item of items) {
      if (item.kind === 'request') requests.set(item.id, item);
      else visit(item.children);
    }
  };
  for (const collection of model.collections) visit(collection.children);

  const listed = await context.fs.list('examples', { recursive: true });
  await readComparisons(
    context,
    model,
    requests,
    listed
      .filter((entry) => entry.kind === 'file' && entry.path.endsWith(`/${COMPARE_FILE}`))
      .map((entry) => entry.path)
      .sort(compareStrings),
  );
  const entries = listed
    .filter((entry) => entry.kind === 'file' && entry.path.endsWith(EXAMPLE_SUFFIX))
    .map((entry) => entry.path)
    .sort(compareStrings);
  for (const path of entries) {
    const directory = path.slice(0, path.lastIndexOf('/'));
    const fileKey = path.slice(directory.length + 1, -EXAMPLE_SUFFIX.length);
    if (fileKey === '') continue;
    const raw = await readJson(context, path);
    if (raw === undefined) {
      model.orphanExamples.push({
        ...brokenIdentity('example', `${directory}/${fileKey}`, undefined, fileKey),
        fileKey,
        requestId: '',
        response: { code: 0, status: '', headers: [], cookies: [], body: { kind: 'none' } },
        extra: {},
        directory,
        broken: true,
      });
      continue;
    }
    const bodyFile = asObject(raw['_pigeon'])['bodyFile'];
    let body: ExampleBody | undefined;
    if (typeof bodyFile === 'string' && bodyFile !== '' && !bodyFile.includes('/')) {
      const bodyPath = `${directory}/${bodyFile}`;
      try {
        const bytes = await context.fs.readFile(bodyPath);
        context.files.set(bodyPath, { hash: await contentHash(bodyPath, bytes) });
        body = exampleBodyFromFile(bodyFile, bytes);
      } catch (cause) {
        context.problems.push(
          error(bodyPath, 'missing', `Example body could not be read: ${messageOf(cause)}`),
        );
      }
    }
    const example = exampleFromPostman(raw, fileKey, body);
    if (example.id === '') example.id = `example:${directory}/${fileKey}`;
    const request = requests.get(example.requestId);
    if (request && !request.broken) {
      request.examples.push(example);
      continue;
    }
    model.orphanExamples.push({ ...example, directory });
    context.problems.push({
      path,
      kind: 'orphan',
      severity: 'warning',
      message: example.requestId
        ? `Example "${example.name}" belongs to a request that is not in the project (${example.requestId}).`
        : `Example "${example.name}" does not name its request (_pigeon.requestId).`,
    });
  }
  for (const request of requests.values()) {
    request.examples.sort((a, b) => compareStrings(a.fileKey, b.fileKey));
  }
}

/** Reads, hashes and parses a JSON object file; records a `parse` problem instead of throwing. */
async function readJson(context: ReadContext, path: ProjectPath): Promise<JsonObject | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await context.fs.readFile(path);
  } catch (cause) {
    context.problems.push(error(path, 'parse', `Could not read file: ${messageOf(cause)}`));
    return undefined;
  }
  context.files.set(path, { hash: await contentHash(path, bytes) });
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch (cause) {
    context.problems.push(error(path, 'parse', messageOf(cause)));
    return undefined;
  }
  if (!isObject(value)) {
    context.problems.push(error(path, 'schema', 'Expected a JSON object'));
    return undefined;
  }
  return value;
}

async function childDirectories(fs: ProjectFileSystem, directory: ProjectPath): Promise<string[]> {
  if ((await fs.stat(directory))?.kind !== 'dir') return [];
  return (await fs.list(directory))
    .filter((entry) => entry.kind === 'dir')
    .map((entry) => entry.path.slice(directory.length + 1));
}

function projectFromFile(raw: JsonObject): ProjectModel {
  const pigeon = asObject(raw['pigeon']);
  const extra = without(raw, ['pigeon', 'id', 'name', 'collections', 'comparison']);
  const pigeonExtra = without(pigeon, ['formatVersion']);
  if (nonEmpty(pigeonExtra)) extra['pigeon'] = pigeonExtra;
  return {
    id: asString(raw['id']),
    name: asString(raw['name']),
    formatVersion: pigeon['formatVersion'] as number,
    collections: [],
    orphanExamples: [],
    environments: [],
    ...(raw['comparison'] === undefined ? {} : { comparison: raw['comparison'] }),
    extra,
  };
}

/**
 * Orders `values` by `order` (file-format.md §2.3): listed entries first, the rest appended in
 * alphabetical order; listed-but-missing entries are dropped with a warning.
 */
function applyOrder<T extends { fileKey: string }>(
  values: readonly T[],
  order: readonly string[],
  path: ProjectPath,
  problems: Problem[],
): T[] {
  const remaining = new Map(values.map((value) => [value.fileKey, value]));
  const ordered: T[] = [];
  for (const fileKey of order) {
    const value = remaining.get(fileKey);
    if (value === undefined) {
      problems.push({
        path,
        kind: 'order',
        severity: 'warning',
        message: `Order entry "${fileKey}" does not exist`,
      });
      continue;
    }
    ordered.push(value);
    remaining.delete(fileKey);
  }
  const rest = [...remaining.values()].sort((left, right) =>
    compareStrings(left.fileKey, right.fileKey),
  );
  return [...ordered, ...rest];
}

function brokenIdentity(
  kind: string,
  fileKey: string,
  id: unknown,
  name: unknown,
): { id: string; fileKey: string; name: string } {
  return {
    id: typeof id === 'string' && id !== '' ? id : `broken:${kind}:${fileKey}`,
    fileKey,
    name: typeof name === 'string' ? name : fileKey,
  };
}

function placeholderProject(): ProjectModel {
  return {
    id: '',
    name: '',
    formatVersion: CURRENT_FORMAT_VERSION,
    collections: [],
    orphanExamples: [],
    environments: [],
    extra: {},
  };
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === 'string');
}

function error(path: ProjectPath, kind: Problem['kind'], message: string): Problem {
  return { path, kind, severity: 'error', message };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
