/**
 * Edit commands (docs/architecture.md §3.2): pure `(model, command) → model` functions with
 * structural sharing, so only the edited entities and their ancestors get new objects (React
 * re-renders just what changed). `ProjectSession.apply` runs them.
 *
 * Structural commands (PIGN-017) keep file keys valid: new and renamed entities get a slug from
 * their name (docs/file-format.md §4), and any collision within a directory (requests and
 * folders share one namespace) gets `-2`, `-3`, …
 */

import type { ProjectEnvironment, ProjectEnvVariable } from '@pigeon/formats';
import { allocateSlug, slugify } from '@pigeon/formats';

import type {
  Collection,
  Folder,
  ProjectItem,
  ProjectModel,
  ProjectRequest,
} from '../model/project';

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

export type EditCommand =
  | { type: 'updateRequest'; id: string; patch: RequestPatch }
  | { type: 'createCollection'; id: string; name: string; index?: number }
  | { type: 'createFolder'; id: string; parentId: string; name: string; index?: number }
  | {
      type: 'createRequest';
      id: string;
      parentId: string;
      name: string;
      index?: number;
      /** Initial content; defaults to an empty GET. */
      request?: Partial<Omit<ProjectRequest, 'kind' | 'id' | 'fileKey' | 'name'>>;
    }
  | { type: 'renameItem'; id: string; name: string }
  | { type: 'duplicateItem'; id: string; newId: string }
  | { type: 'deleteItem'; id: string }
  | { type: 'moveItem'; id: string; parentId: string; index: number }
  | { type: 'moveCollection'; id: string; index: number }
  /** `pigeon.json` identity (e.g. "Regenerate project id" for a copied project folder). */
  | { type: 'setProjectInfo'; id?: string; name?: string }
  // Environments (PIGN-022): one file each, ordered by file key.
  | { type: 'createEnvironment'; id: string; name: string; values?: ProjectEnvVariable[] }
  | { type: 'renameEnvironment'; id: string; name: string }
  | { type: 'duplicateEnvironment'; id: string; newId: string }
  | { type: 'deleteEnvironment'; id: string }
  /** Replaces the variables (add, edit, remove, reorder) of an environment. */
  | { type: 'setEnvironmentValues'; id: string; values: ProjectEnvVariable[] };

/** Pseudo entity id of the project itself (`pigeon.json`) in drafts and unsaved tracking. */
export const PROJECT_ENTITY_ID = '$project';

/** Context for commands that need fresh ids beyond the ones they carry (duplicates). */
export interface CommandContext {
  newId: () => string;
}

const defaultContext: CommandContext = { newId: () => crypto.randomUUID() };

/** Where an entity sits: its container (`null` for collections) and index. */
export interface Placement {
  parentId: string | null;
  index: number;
}

export class CommandError extends Error {
  override readonly name = 'CommandError';
}

/**
 * Ids of the entities whose files a command changes: the entity itself and every container whose
 * child order changes. Used for unsaved tracking and, later, drafts.
 */
export function touchedIds(model: ProjectModel, command: EditCommand): string[] {
  switch (command.type) {
    case 'updateRequest':
    case 'renameItem':
      return [command.id];
    case 'createCollection':
      return [command.id];
    case 'createFolder':
    case 'createRequest':
      return [command.id, command.parentId];
    case 'duplicateItem': {
      const parent = placementOf(model, command.id)?.parentId;
      return [command.newId, ...(parent ? [parent] : [])];
    }
    case 'deleteItem': {
      const parent = placementOf(model, command.id)?.parentId;
      return [command.id, ...(parent ? [parent] : [])];
    }
    case 'moveItem': {
      const parent = placementOf(model, command.id)?.parentId;
      return [
        command.id,
        command.parentId,
        ...(parent && parent !== command.parentId ? [parent] : []),
      ];
    }
    case 'moveCollection':
      return [command.id];
    case 'setProjectInfo':
      return [PROJECT_ENTITY_ID];
    case 'createEnvironment':
    case 'renameEnvironment':
    case 'deleteEnvironment':
    case 'setEnvironmentValues':
      return [command.id];
    case 'duplicateEnvironment':
      return [command.newId];
  }
}

/** Environments sorted by file key (how the reader orders them). */
function sortEnvironments(environments: ProjectEnvironment[]): ProjectEnvironment[] {
  return environments.sort((a, b) => (a.fileKey < b.fileKey ? -1 : a.fileKey > b.fileKey ? 1 : 0));
}

function environmentKey(model: ProjectModel, name: string, id: string): string {
  return allocateSlug(
    slugify(name, { kind: 'environment', id }),
    new Set(model.environments.filter((e) => e.id !== id).map((e) => e.fileKey)),
  );
}

function updateEnvironment(
  model: ProjectModel,
  id: string,
  update: (environment: ProjectEnvironment) => ProjectEnvironment,
): ProjectModel {
  const environment = model.environments.find((e) => e.id === id);
  if (!environment) throw new CommandError(`No environment with id "${id}"`);
  assertEditable(environment);
  return {
    ...model,
    environments: sortEnvironments(model.environments.map((e) => (e.id === id ? update(e) : e))),
  };
}

/** A collection, folder, request or environment by id. */
export function entityExists(model: ProjectModel, id: string): boolean {
  return (
    model.collections.some((c) => c.id === id) ||
    model.environments.some((e) => e.id === id) ||
    findItem(model, id) !== undefined
  );
}

export function applyCommand(
  model: ProjectModel,
  command: EditCommand,
  context: CommandContext = defaultContext,
): ProjectModel {
  switch (command.type) {
    case 'updateRequest':
      return replaceItem(model, command.id, (item) => {
        if (item.kind !== 'request') throw new CommandError(`"${command.id}" is not a request`);
        assertEditable(item);
        return { ...item, ...command.patch };
      });

    case 'createCollection': {
      assertNewId(model, command.id);
      const collection: Collection = {
        kind: 'collection',
        id: command.id,
        fileKey: allocateSlug(
          slugify(command.name, { kind: 'collection', id: command.id }),
          new Set(model.collections.map((c) => c.fileKey)),
        ),
        name: command.name,
        events: [],
        variables: [],
        children: [],
        extra: {},
      };
      return { ...model, collections: insertAt(model.collections, collection, command.index) };
    }

    case 'createFolder':
    case 'createRequest': {
      assertNewId(model, command.id);
      const kind = command.type === 'createFolder' ? 'folder' : 'request';
      return updateContainer(model, command.parentId, (container) => {
        const fileKey = allocateSlug(
          slugify(command.name, { kind, id: command.id }),
          siblingKeys(container.children),
        );
        const item: ProjectItem =
          command.type === 'createFolder'
            ? {
                kind: 'folder',
                id: command.id,
                fileKey,
                name: command.name,
                events: [],
                variables: [],
                children: [],
                extra: {},
              }
            : {
                kind: 'request',
                method: 'GET',
                url: { raw: '', query: [], pathVariables: [], extra: {} },
                headers: [],
                body: { mode: 'none' },
                events: [],
                settings: {},
                extra: {},
                ...command.request,
                id: command.id,
                fileKey,
                name: command.name,
              };
        return { ...container, children: insertAt(container.children, item, command.index) };
      });
    }

    case 'renameItem': {
      const name = command.name.trim();
      if (name === '') throw new CommandError('A name cannot be empty.');
      const collectionIndex = model.collections.findIndex((c) => c.id === command.id);
      if (collectionIndex !== -1) {
        const collection = model.collections[collectionIndex]!;
        assertEditable(collection);
        const taken = new Set(
          model.collections.filter((c) => c.id !== command.id).map((c) => c.fileKey),
        );
        const renamed = {
          ...collection,
          name,
          fileKey: allocateSlug(slugify(name, { kind: 'collection', id: collection.id }), taken),
        };
        return {
          ...model,
          collections: model.collections.map((c, i) => (i === collectionIndex ? renamed : c)),
        };
      }
      const placement = requirePlacement(model, command.id);
      return updateContainer(model, placement.parentId!, (container) => ({
        ...container,
        children: container.children.map((child) => {
          if (child.id !== command.id) return child;
          assertEditable(child);
          const taken = siblingKeys(container.children.filter((c) => c.id !== command.id));
          return {
            ...child,
            name,
            fileKey: allocateSlug(slugify(name, { kind: child.kind, id: child.id }), taken),
          };
        }),
      }));
    }

    case 'duplicateItem': {
      assertNewId(model, command.newId);
      const collection = model.collections.find((c) => c.id === command.id);
      if (collection) {
        const copy: Collection = {
          ...structuredClone(collection),
          id: command.newId,
          name: `${collection.name} copy`,
          children: collection.children.map((child) => cloneWithNewIds(child, context)),
        };
        copy.fileKey = allocateSlug(
          slugify(copy.name, { kind: 'collection', id: copy.id }),
          new Set(model.collections.map((c) => c.fileKey)),
        );
        const index = model.collections.indexOf(collection);
        return { ...model, collections: insertAt(model.collections, copy, index + 1) };
      }
      const placement = requirePlacement(model, command.id);
      return updateContainer(model, placement.parentId!, (container) => {
        const original = container.children[placement.index]!;
        assertEditable(original);
        const copy = {
          ...cloneWithNewIds(original, context),
          id: command.newId,
          name: `${original.name} copy`,
        };
        copy.fileKey = allocateSlug(
          slugify(copy.name, { kind: copy.kind, id: copy.id }),
          siblingKeys(container.children),
        );
        return { ...container, children: insertAt(container.children, copy, placement.index + 1) };
      });
    }

    case 'deleteItem': {
      if (model.collections.some((c) => c.id === command.id)) {
        return { ...model, collections: model.collections.filter((c) => c.id !== command.id) };
      }
      return replaceItem(model, command.id, () => null);
    }

    case 'moveItem': {
      const placement = requirePlacement(model, command.id);
      if (placement.parentId === null)
        throw new CommandError('Collections are reordered with moveCollection.');
      const item = findItem(model, command.id)!;
      if (isSameOrDescendant(model, command.parentId, command.id)) {
        throw new CommandError('A folder cannot be moved into itself or one of its folders.');
      }
      const target = findContainer(model, command.parentId);
      if (!target) throw new CommandError(`No collection or folder with id "${command.parentId}"`);
      assertEditable(target);
      // Same container: adjust the index for the removal before re-inserting.
      const sameParent = placement.parentId === command.parentId;
      const index =
        sameParent && placement.index < command.index ? command.index - 1 : command.index;
      const without = replaceItem(model, command.id, () => null);
      return updateContainer(without, command.parentId, (container) => {
        const taken = siblingKeys(container.children);
        const fileKey = taken.has(item.fileKey) ? allocateSlug(item.fileKey, taken) : item.fileKey;
        const moved = fileKey === item.fileKey ? item : { ...item, fileKey };
        return { ...container, children: insertAt(container.children, moved, index) };
      });
    }

    case 'setProjectInfo': {
      if (command.name !== undefined && command.name.trim() === '') {
        throw new CommandError('A name cannot be empty.');
      }
      return {
        ...model,
        ...(command.id === undefined ? {} : { id: command.id }),
        ...(command.name === undefined ? {} : { name: command.name.trim() }),
      };
    }

    case 'createEnvironment': {
      assertNewId(model, command.id);
      const name = command.name.trim();
      if (name === '') throw new CommandError('A name cannot be empty.');
      const environment: ProjectEnvironment = {
        id: command.id,
        fileKey: environmentKey(model, name, command.id),
        name,
        values: command.values ?? [],
        extra: {},
      };
      return { ...model, environments: sortEnvironments([...model.environments, environment]) };
    }

    case 'renameEnvironment': {
      const name = command.name.trim();
      if (name === '') throw new CommandError('A name cannot be empty.');
      return updateEnvironment(model, command.id, (e) => ({
        ...e,
        name,
        fileKey: environmentKey(model, name, e.id),
      }));
    }

    case 'duplicateEnvironment': {
      assertNewId(model, command.newId);
      const original = model.environments.find((e) => e.id === command.id);
      if (!original) throw new CommandError(`No environment with id "${command.id}"`);
      assertEditable(original);
      const name = `${original.name} copy`;
      const copy: ProjectEnvironment = {
        ...structuredClone(original),
        id: command.newId,
        name,
        fileKey: environmentKey(model, name, command.newId),
      };
      return { ...model, environments: sortEnvironments([...model.environments, copy]) };
    }

    case 'deleteEnvironment':
      if (!model.environments.some((e) => e.id === command.id)) {
        throw new CommandError(`No environment with id "${command.id}"`);
      }
      return { ...model, environments: model.environments.filter((e) => e.id !== command.id) };

    case 'setEnvironmentValues':
      return updateEnvironment(model, command.id, (e) => ({ ...e, values: command.values }));

    case 'moveCollection': {
      const index = model.collections.findIndex((c) => c.id === command.id);
      if (index === -1) throw new CommandError(`No collection with id "${command.id}"`);
      const collection = model.collections[index]!;
      const rest = model.collections.filter((c) => c.id !== command.id);
      const target = index < command.index ? command.index - 1 : command.index;
      return { ...model, collections: insertAt(rest, collection, target) };
    }
  }
}

// --- Lookups ---------------------------------------------------------------------------------------

/** Finds an item (folder or request) anywhere in the model. */
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

/** A collection or folder by id. */
export function findContainer(model: ProjectModel, id: string): Collection | Folder | undefined {
  const collection = model.collections.find((c) => c.id === id);
  if (collection) return collection;
  const item = findItem(model, id);
  return item?.kind === 'folder' ? item : undefined;
}

/** Where an entity sits, or `undefined` when it doesn't exist. */
export function placementOf(model: ProjectModel, id: string): Placement | undefined {
  const collectionIndex = model.collections.findIndex((c) => c.id === id);
  if (collectionIndex !== -1) return { parentId: null, index: collectionIndex };
  const search = (container: Collection | Folder): Placement | undefined => {
    for (const [index, child] of container.children.entries()) {
      if (child.id === id) return { parentId: container.id, index };
      if (child.kind === 'folder') {
        const found = search(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  for (const collection of model.collections) {
    const found = search(collection);
    if (found) return found;
  }
  return undefined;
}

/** True when `id` is `ancestorId` or lies below it. */
export function isSameOrDescendant(model: ProjectModel, id: string, ancestorId: string): boolean {
  if (id === ancestorId) return true;
  const container = findContainer(model, ancestorId);
  if (!container) return false;
  const search = (items: readonly ProjectItem[]): boolean =>
    items.some((item) => item.id === id || (item.kind === 'folder' && search(item.children)));
  return search(container.children);
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
  if (!found) throw new CommandError(`No item with id "${id}"`);
  return collectionsChanged ? { ...model, collections } : model;
}

// --- Helpers -----------------------------------------------------------------------------------------

function updateContainer(
  model: ProjectModel,
  containerId: string,
  update: (container: Collection | Folder) => Collection | Folder,
): ProjectModel {
  const collectionIndex = model.collections.findIndex((c) => c.id === containerId);
  if (collectionIndex !== -1) {
    const collection = model.collections[collectionIndex]!;
    assertEditable(collection);
    const next = update(collection) as Collection;
    return {
      ...model,
      collections: model.collections.map((c, i) => (i === collectionIndex ? next : c)),
    };
  }
  const folder = findItem(model, containerId);
  if (folder?.kind !== 'folder')
    throw new CommandError(`No collection or folder with id "${containerId}"`);
  assertEditable(folder);
  return replaceItem(model, containerId, (item) => update(item as Folder) as Folder);
}

function siblingKeys(children: readonly ProjectItem[]): Set<string> {
  return new Set(children.map((child) => child.fileKey));
}

function insertAt<T>(list: readonly T[], item: T, index?: number): T[] {
  const at = index === undefined ? list.length : Math.max(0, Math.min(list.length, index));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

function cloneWithNewIds(item: ProjectItem, context: CommandContext): ProjectItem {
  const copy = structuredClone(item);
  const renew = (entity: ProjectItem): ProjectItem =>
    entity.kind === 'folder'
      ? { ...entity, id: context.newId(), children: entity.children.map(renew) }
      : { ...entity, id: context.newId() };
  return renew(copy);
}

function assertEditable(entity: { broken?: true; name: string }): void {
  if (entity.broken)
    throw new CommandError(`"${entity.name}" could not be loaded and is read-only`);
}

function assertNewId(model: ProjectModel, id: string): void {
  if (entityExists(model, id)) {
    throw new CommandError(`An entity with id "${id}" already exists`);
  }
}

function requirePlacement(model: ProjectModel, id: string): Placement {
  const placement = placementOf(model, id);
  if (!placement) throw new CommandError(`No item with id "${id}"`);
  return placement;
}
