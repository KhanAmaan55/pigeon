/**
 * Serializes a project model into its managed files (docs/file-format.md §2–3). Callers decide how
 * to apply the desired file set (commit planner, PIGN-019).
 *
 * Broken entities are never written (their files stay as they are on disk) but keep their place
 * in order lists so a later fix on disk slots back in.
 */

import { authToPostman } from '../postman/auth';
import type { ProjectPath } from '@pigeon/platform';

import { stringifyCanonical } from '../canonical-json';
import {
  collectionVariableToPostman,
  environmentToPostman,
  globalsToPostman,
} from '../postman/environment';
import {
  EXAMPLE_SUFFIX,
  exampleBodyBytes,
  exampleBodyFileName,
  exampleToPostman,
} from '../postman/example';
import { requestToPostmanItem } from '../postman/item';
import { COMPARE_FILE, comparisonToFile, isEmptyComparison } from './comparison';
import { asObject, nonEmpty, type JsonObject } from '../postman/json';
import { PROJECT_KEY_ORDERS, type ProjectFileKind } from './key-order';
import { COLLECTION_SCHEMA } from './schemas';
import type { Collection, Folder, ProjectExample, ProjectItem, ProjectModel } from './types';

const encoder = new TextEncoder();

export function serializeProject(model: ProjectModel): Map<ProjectPath, Uint8Array> {
  const files = new Map<ProjectPath, Uint8Array>();
  files.set('pigeon.json', encodeFile('pigeon', projectToFile(model)));
  for (const collection of model.collections) {
    const directory = `collections/${collection.fileKey}`;
    if (!collection.broken)
      files.set(
        `${directory}/collection.json`,
        encodeFile('collection', collectionToFile(collection)),
      );
    for (const child of collection.children) writeItem(files, directory, child);
  }
  for (const orphan of model.orphanExamples) {
    if (!orphan.broken) writeExample(files, orphan.directory, orphan);
  }
  for (const orphan of model.orphanComparisons ?? []) {
    files.set(
      `${orphan.directory}/${COMPARE_FILE}`,
      encodeFile('compare', comparisonToFile(orphan.requestId, orphan.config)),
    );
  }
  if (model.globals) {
    files.set(
      'environments/globals.postman_globals.json',
      encodeFile('environment', globalsToPostman(model.globals)),
    );
  }
  for (const environment of model.environments) {
    if (!environment.broken) {
      files.set(
        `environments/${environment.fileKey}.postman_environment.json`,
        encodeFile('environment', environmentToPostman(environment)),
      );
    }
  }
  return files;
}

/** Canonical bytes of one project file. */
export function encodeFile(kind: ProjectFileKind, value: JsonObject): Uint8Array {
  return encoder.encode(stringifyCanonical(value, { keyOrder: PROJECT_KEY_ORDERS[kind] }));
}

function writeItem(
  files: Map<ProjectPath, Uint8Array>,
  directory: string,
  item: ProjectItem,
): void {
  if (item.kind === 'request') {
    if (!item.broken) {
      files.set(
        `${directory}/${item.fileKey}.request.json`,
        encodeFile('request', requestToPostmanItem(item)),
      );
      const examples = exampleDirectory(directory, item.fileKey);
      for (const example of item.examples) writeExample(files, examples, example);
      if (!isEmptyComparison(item.comparison)) {
        files.set(
          `${examples}/${COMPARE_FILE}`,
          encodeFile('compare', comparisonToFile(item.id, item.comparison!)),
        );
      }
    }
    return;
  }
  const childDirectory = `${directory}/${item.fileKey}`;
  if (!item.broken)
    files.set(`${childDirectory}/folder.json`, encodeFile('folder', folderToFile(item)));
  for (const child of item.children) writeItem(files, childDirectory, child);
}

/**
 * `examples/<collection>/<folders…>/<request>`: the request's directory under `examples/`, so
 * examples follow their request on rename and move (file-format.md §1).
 */
export function exampleDirectory(requestDirectory: string, requestFileKey: string): string {
  return `examples/${requestDirectory.slice('collections/'.length)}/${requestFileKey}`;
}

function writeExample(
  files: Map<ProjectPath, Uint8Array>,
  directory: string,
  example: ProjectExample,
): void {
  if (example.broken) return;
  files.set(
    `${directory}/${example.fileKey}${EXAMPLE_SUFFIX}`,
    encodeFile('example', exampleToPostman(example)),
  );
  const bodyFile = exampleBodyFileName(example);
  if (bodyFile) files.set(`${directory}/${bodyFile}`, exampleBodyBytes(example.response.body));
}

function projectToFile(model: ProjectModel): JsonObject {
  const { pigeon, ...extra } = model.extra;
  return {
    ...extra,
    pigeon: { ...asObject(pigeon), formatVersion: model.formatVersion },
    id: model.id,
    name: model.name,
    collections: model.collections.map((collection) => collection.fileKey),
    ...(model.comparison === undefined ? {} : { comparison: model.comparison }),
  };
}

function collectionToFile(collection: Collection): JsonObject {
  const { info, _pigeon, ...extra } = collection.extra;
  return {
    ...extra,
    info: {
      schema: COLLECTION_SCHEMA,
      ...asObject(info),
      _postman_id: collection.id,
      name: collection.name,
      ...(collection.description === undefined ? {} : { description: collection.description }),
      ...(collection.version === undefined ? {} : { version: collection.version }),
    },
    ...(collection.auth === undefined ? {} : { auth: authToPostman(collection.auth) }),
    ...(collection.events.length === 0 ? {} : { event: collection.events }),
    ...(collection.variables.length === 0
      ? {}
      : { variable: collection.variables.map(collectionVariableToPostman) }),
    ...withOrder(_pigeon, collection.children),
  };
}

function folderToFile(folder: Folder): JsonObject {
  const { _pigeon, ...extra } = folder.extra;
  return {
    ...extra,
    id: folder.id,
    name: folder.name,
    ...(folder.description === undefined ? {} : { description: folder.description }),
    ...(folder.auth === undefined ? {} : { auth: authToPostman(folder.auth) }),
    ...(folder.events.length === 0 ? {} : { event: folder.events }),
    ...(folder.variables.length === 0
      ? {}
      : { variable: folder.variables.map(collectionVariableToPostman) }),
    ...withOrder(_pigeon, folder.children),
  };
}

/** `{ _pigeon: { …extra, order } }`, or `{}` when there is nothing to write. */
function withOrder(pigeonExtra: unknown, children: readonly ProjectItem[]): JsonObject {
  const pigeon = {
    ...asObject(pigeonExtra),
    ...(children.length === 0 ? {} : { order: children.map((child) => child.fileKey) }),
  };
  return nonEmpty(pigeon) ? { _pigeon: pigeon } : {};
}
