/** Flattens the project tree into the rows the virtualized explorer renders. */

import type { Collection, Problem, ProjectItem, ProjectModel } from '@pigeon/core';
import { hasScripts } from '@pigeon/core';

import { fuzzyMatch } from './actions';

export interface TreeRow {
  id: string;
  kind: 'collection' | 'folder' | 'request' | 'example';
  name: string;
  depth: number;
  /** Requests only. */
  method?: string;
  /** Requests: how many examples they have (PIGN-027). */
  exampleCount?: number;
  /** Examples only: the status code. */
  code?: number;
  /** Has pre-request or test scripts (PIGN-031). */
  scripts?: boolean;
  hasChildren: boolean;
  expanded: boolean;
  broken: boolean;
  /** File backing the row (`collection.json`, `folder.json` or the request file). */
  path: string;
  /** Error message for broken files. */
  problem?: string;
  parentId: string | null;
  /** In-memory edits not saved yet. */
  unsaved?: boolean;
  /** Saved draft: A / M / D badge (data-model.md §10). */
  change?: 'created' | 'updated' | 'deleted';
  /** Deleted by a saved draft; shown struck through until committed. */
  deleted?: boolean;
  /** The saved draft conflicts with the file on disk. */
  conflict?: boolean;
}

/** A deleted entity as `ProjectSession.deletedEntities()` lists it. */
export interface DeletedEntity {
  id: string;
  name: string;
  kind: 'collection' | 'folder' | 'request';
  parentId: string | null;
  method?: string;
}

export interface FlattenOptions {
  /** Fuzzy filter on name and URL; matching items show with their ancestors expanded. */
  filter?: string;
  unsaved?: Readonly<Record<string, true>>;
  changes?: Readonly<Record<string, string>>;
  deleted?: readonly DeletedEntity[];
}

function changeOf(
  changes: Readonly<Record<string, string>>,
  id: string,
): Pick<TreeRow, 'change' | 'conflict'> {
  const change = changes[id];
  if (change === 'conflict') return { conflict: true };
  return change === 'created' || change === 'updated' ? { change } : {};
}

/** Ids of entities that match `filter`, plus all their ancestors. */
function visibleForFilter(model: ProjectModel, filter: string): Set<string> {
  const visible = new Set<string>();
  const visit = (items: readonly ProjectItem[], ancestors: string[]): void => {
    for (const item of items) {
      const text = item.kind === 'request' ? `${item.name} ${item.url.raw}` : item.name;
      if (fuzzyMatch(text, filter)) for (const id of [...ancestors, item.id]) visible.add(id);
      if (item.kind === 'folder') visit(item.children, [...ancestors, item.id]);
    }
  };
  for (const collection of model.collections) {
    if (fuzzyMatch(collection.name, filter)) visible.add(collection.id);
    visit(collection.children, [collection.id]);
  }
  return visible;
}

export function flattenTree(
  model: ProjectModel,
  expandedState: Readonly<Record<string, true>>,
  problems: readonly Problem[] = [],
  options: FlattenOptions = {},
): TreeRow[] {
  const filter = options.filter?.trim() ?? '';
  const visible = filter === '' ? undefined : visibleForFilter(model, filter);
  // While filtering, everything leading to a match is open.
  const expanded: Readonly<Record<string, true>> = visible
    ? Object.fromEntries([...visible].map((id) => [id, true as const]))
    : expandedState;
  const unsaved = options.unsaved ?? {};
  const changes = options.changes ?? {};
  const deletedByParent = new Map<string | null, DeletedEntity[]>();
  for (const entity of visible ? [] : (options.deleted ?? [])) {
    deletedByParent.set(entity.parentId, [...(deletedByParent.get(entity.parentId) ?? []), entity]);
  }
  const deletedRows = (parentId: string | null, depth: number, directory: string): TreeRow[] =>
    (deletedByParent.get(parentId) ?? []).map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      depth,
      ...(entity.method ? { method: entity.method } : {}),
      hasChildren: false,
      expanded: false,
      broken: false,
      path: directory,
      parentId,
      change: 'deleted' as const,
      deleted: true,
    }));
  const shown = (id: string) => !visible || visible.has(id);
  const messages = new Map<string, string>();
  for (const problem of problems) {
    if (problem.severity === 'error' && !messages.has(problem.path))
      messages.set(problem.path, problem.message);
  }
  const rows: TreeRow[] = [];
  const pushChildren = (
    items: readonly ProjectItem[],
    directory: string,
    depth: number,
    parentId: string,
  ): void => {
    pushItems(items, directory, depth, parentId);
    rows.push(...deletedRows(parentId, depth, directory));
  };
  const pushItems = (
    items: readonly ProjectItem[],
    directory: string,
    depth: number,
    parentId: string,
  ): void => {
    for (const item of items) {
      if (!shown(item.id)) continue;
      if (item.kind === 'request') {
        const path = `${directory}/${item.fileKey}.request.json`;
        const examplesShown = expanded[item.id] === true && item.examples.length > 0;
        rows.push({
          id: item.id,
          kind: 'request',
          name: item.name,
          depth,
          // A broken file has no meaningful method.
          ...(item.broken ? {} : { method: item.method }),
          ...(item.examples.length > 0 ? { exampleCount: item.examples.length } : {}),
          ...(hasScripts(item.events) ? { scripts: true } : {}),
          hasChildren: item.examples.length > 0,
          expanded: examplesShown,
          broken: item.broken === true,
          path,
          ...problemOf(messages, path),
          parentId,
          ...(unsaved[item.id] ? { unsaved: true } : {}),
          ...changeOf(changes, item.id),
        });
        if (examplesShown) {
          const exampleDirectory = `examples/${directory.slice('collections/'.length)}/${item.fileKey}`;
          for (const example of item.examples) {
            rows.push({
              id: example.id,
              kind: 'example',
              name: example.name,
              depth: depth + 1,
              code: example.response.code,
              hasChildren: false,
              expanded: false,
              broken: false,
              path: `${exampleDirectory}/${example.fileKey}.example.json`,
              parentId: item.id,
            });
          }
        }
        continue;
      }
      const folderDirectory = `${directory}/${item.fileKey}`;
      const path = `${folderDirectory}/folder.json`;
      const isExpanded = expanded[item.id] === true;
      rows.push({
        id: item.id,
        kind: 'folder',
        name: item.name,
        depth,
        ...(hasScripts(item.events) ? { scripts: true } : {}),
        hasChildren: item.children.length > 0,
        expanded: isExpanded,
        broken: item.broken === true,
        path,
        ...problemOf(messages, path),
        parentId,
        ...(unsaved[item.id] ? { unsaved: true } : {}),
        ...changeOf(changes, item.id),
      });
      if (isExpanded) pushChildren(item.children, folderDirectory, depth + 1, item.id);
    }
  };
  for (const collection of model.collections) {
    if (!shown(collection.id)) continue;
    rows.push({
      ...collectionRow(collection, expanded, messages),
      ...(unsaved[collection.id] ? { unsaved: true } : {}),
      ...changeOf(changes, collection.id),
    });
    if (expanded[collection.id]) {
      pushChildren(collection.children, `collections/${collection.fileKey}`, 1, collection.id);
    }
  }
  rows.push(...deletedRows(null, 0, 'collections'));
  return rows;
}

function collectionRow(
  collection: Collection,
  expanded: Readonly<Record<string, true>>,
  messages: Map<string, string>,
): TreeRow {
  const path = `collections/${collection.fileKey}/collection.json`;
  return {
    id: collection.id,
    kind: 'collection',
    name: collection.name,
    depth: 0,
    ...(hasScripts(collection.events) ? { scripts: true } : {}),
    hasChildren: collection.children.length > 0,
    expanded: expanded[collection.id] === true,
    broken: collection.broken === true,
    path,
    ...problemOf(messages, path),
    parentId: null,
  };
}

function problemOf(messages: Map<string, string>, path: string): { problem?: string } {
  const message = messages.get(path);
  return message === undefined ? {} : { problem: message };
}

/** Request method label shown in the explorer (`DEL` for DELETE, like other API clients). */
export function methodLabel(method: string): string {
  const upper = method.toUpperCase();
  if (upper === 'DELETE') return 'DEL';
  if (upper === 'OPTIONS') return 'OPT';
  return upper.length > 5 ? upper.slice(0, 5) : upper;
}
