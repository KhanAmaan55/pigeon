/** Flattens the project tree into the rows the virtualized explorer renders. */

import type { Collection, Problem, ProjectItem, ProjectModel } from '@pigeon/core';

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
}

export function flattenTree(
  model: ProjectModel,
  expanded: Readonly<Record<string, true>>,
  problems: readonly Problem[] = [],
): TreeRow[] {
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
      });
      if (isExpanded) pushChildren(item.children, folderDirectory, depth + 1, item.id);
    }
  };
  for (const collection of model.collections) {
    rows.push(collectionRow(collection, expanded, messages));
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
