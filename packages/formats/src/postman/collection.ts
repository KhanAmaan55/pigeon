/**
 * Postman collection root and item-group objects ⇄ `Collection` / `Folder` (compatibility.md
 * §A.2). Shared by the project reader (`collection.json`, `folder.json`) and the Postman
 * importer; in a project the children come from files, in a Postman file from `item[]`.
 */

import { authFromPostman } from './auth';
import { collectionVariableFromPostman } from './environment';
import { asArray, asObject, asString, isDescription, nonEmpty, without } from './json';
import type { JsonObject } from './json';
import { COLLECTION_SCHEMA } from '../project/schemas';
import type { Collection, Folder, ProjectItem } from '../project/types';

/** A collection root (without `item`); `_pigeon.order` is the caller's business. */
export function collectionFromPostman(
  raw: JsonObject,
  fileKey: string,
  children: ProjectItem[],
): Collection {
  const info = asObject(raw['info']);
  const pigeon = asObject(raw['_pigeon']);
  const extra = without(raw, ['info', 'auth', 'event', 'variable', '_pigeon']);
  const infoExtra = without(info, ['_postman_id', 'name', 'description', 'version', 'schema']);
  if (info['schema'] !== undefined && info['schema'] !== COLLECTION_SCHEMA)
    infoExtra['schema'] = info['schema'];
  if (!isDescription(info['description']) && info['description'] !== undefined) {
    infoExtra['description'] = info['description'];
  }
  if (nonEmpty(infoExtra)) extra['info'] = infoExtra;
  const pigeonExtra = without(pigeon, ['order']);
  if (nonEmpty(pigeonExtra)) extra['_pigeon'] = pigeonExtra;

  return {
    kind: 'collection',
    id: asString(info['_postman_id']),
    fileKey,
    name: asString(info['name']),
    ...(isDescription(info['description']) ? { description: info['description'] } : {}),
    ...(typeof info['version'] === 'string' ? { version: info['version'] } : {}),
    ...(raw['auth'] === undefined ? {} : { auth: authFromPostman(raw['auth']) }),
    events: asArray(raw['event']),
    variables: asArray(raw['variable']).map(collectionVariableFromPostman),
    children,
    extra,
  };
}

/** An item group (without `item`); `_pigeon.order` is the caller's business. */
export function folderFromPostman(
  raw: JsonObject,
  fileKey: string,
  children: ProjectItem[],
): Folder {
  const pigeon = asObject(raw['_pigeon']);
  const extra = without(raw, ['id', 'name', 'description', 'auth', 'event', 'variable', '_pigeon']);
  if (!isDescription(raw['description']) && raw['description'] !== undefined)
    extra['description'] = raw['description'];
  const pigeonExtra = without(pigeon, ['order']);
  if (nonEmpty(pigeonExtra)) extra['_pigeon'] = pigeonExtra;

  return {
    kind: 'folder',
    id: asString(raw['id']),
    fileKey,
    name: asString(raw['name']),
    ...(isDescription(raw['description']) ? { description: raw['description'] } : {}),
    ...(raw['auth'] === undefined ? {} : { auth: authFromPostman(raw['auth']) }),
    events: asArray(raw['event']),
    variables: asArray(raw['variable']).map(collectionVariableFromPostman),
    children,
    extra,
  };
}
