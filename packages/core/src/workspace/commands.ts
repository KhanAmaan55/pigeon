/**
 * Edit commands (docs/architecture.md §3.2): pure `(model, command) → model` functions with
 * structural sharing, so only the edited entity and its ancestors get new objects (React
 * re-renders just what changed). `ProjectSession.apply` runs them.
 */

import type { Collection, ProjectItem, ProjectModel, ProjectRequest } from '../model/project';

/** Fields of a request the editor changes; `kind`, `id` and `fileKey` are not editable here. */
export type RequestPatch = Partial<
  Pick<
    ProjectRequest,
    | 'name'
    | 'description'
    | 'method'
    | 'url'
    | 'headers'
    | 'body'
    | 'auth'
    | 'events'
    | 'settings'
    | 'extra'
  >
>;

export type EditCommand = { type: 'updateRequest'; id: string; patch: RequestPatch };

/** The ids of the entities a command changes. */
export function touchedIds(command: EditCommand): string[] {
  return [command.id];
}

export function applyCommand(model: ProjectModel, command: EditCommand): ProjectModel {
  switch (command.type) {
    case 'updateRequest':
      return replaceItem(model, command.id, (item) => {
        if (item.kind !== 'request') throw new Error(`"${command.id}" is not a request`);
        if (item.broken) throw new Error(`"${item.name}" could not be loaded and is read-only`);
        return { ...item, ...command.patch };
      });
  }
}

/** Finds an item anywhere in the model. */
export function findItem(model: ProjectModel, id: string): ProjectItem | undefined {
  const search = (items: readonly ProjectItem[]): ProjectItem | undefined => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.kind === 'folder') {
        const found = search(item.children);
        if (found) return found;
      }
    }
    return undefined;
  };
  for (const collection of model.collections) {
    const found = search(collection.children);
    if (found) return found;
  }
  return undefined;
}

/**
 * `model` with the item `id` replaced by `update(item)` (or removed when it returns `null`).
 * Throws when the item doesn't exist.
 */
export function replaceItem(
  model: ProjectModel,
  id: string,
  update: (item: ProjectItem) => ProjectItem | null,
): ProjectModel {
  let found = false;
  const visit = <T extends Collection | ProjectItem>(container: T): T => {
    if (container.kind === 'request') return container;
    let changed = false;
    const children: ProjectItem[] = [];
    for (const child of container.children) {
      if (child.id === id) {
        found = true;
        changed = true;
        const next = update(child);
        if (next) children.push(next);
        continue;
      }
      const next = found ? child : visit(child);
      if (next !== child) changed = true;
      children.push(next);
    }
    return changed ? { ...container, children } : container;
  };
  let collectionsChanged = false;
  const collections = model.collections.map((collection) => {
    if (found) return collection;
    const next = visit(collection);
    if (next !== collection) collectionsChanged = true;
    return next;
  });
  if (!found) throw new Error(`No item with id "${id}"`);
  return collectionsChanged ? { ...model, collections } : model;
}
