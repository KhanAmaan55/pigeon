/** Flattens the project tree into the rows the virtualized explorer renders. */

import type { Collection, Problem, ProjectItem, ProjectModel } from '@pigeon/core';

import { fuzzyMatch } from './actions';

export interface TreeRow {
  id: string;
  kind: 'collection' | 'folder' | 'request';
  name: string;
  depth: number;
  /** Requests only. */
  method?: string;
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
}

export interface FlattenOptions {
  /** Fuzzy filter on name and URL; matching items show with their ancestors expanded. */
  filter?: string;
  unsaved?: Readonly<Record<string, true>>;
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
  ) => {
    for (const item of items) {
      if (!shown(item.id)) continue;
      if (item.kind === 'request') {
        const path = `${directory}/${item.fileKey}.request.json`;
        rows.push({
          id: item.id,
          kind: 'request',
          name: item.name,
          depth,
          // A broken file has no meaningful method.
          ...(item.broken ? {} : { method: item.method }),
          hasChildren: false,
          expanded: false,
          broken: item.broken === true,
          path,
          ...problemOf(messages, path),
          parentId,
          ...(unsaved[item.id] ? { unsaved: true } : {}),
        });
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
        hasChildren: item.children.length > 0,
        expanded: isExpanded,
        broken: item.broken === true,
        path,
        ...problemOf(messages, path),
        parentId,
        ...(unsaved[item.id] ? { unsaved: true } : {}),
      });
      if (isExpanded) pushChildren(item.children, folderDirectory, depth + 1, item.id);
    }
  };
  for (const collection of model.collections) {
    if (!shown(collection.id)) continue;
    rows.push({
      ...collectionRow(collection, expanded, messages),
      ...(unsaved[collection.id] ? { unsaved: true } : {}),
    });
    if (expanded[collection.id]) {
      pushChildren(collection.children, `collections/${collection.fileKey}`, 1, collection.id);
    }
  }
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
