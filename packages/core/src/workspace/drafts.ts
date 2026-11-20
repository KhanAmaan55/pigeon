/**
 * Drafts (docs/file-format.md §5, data-model.md §9): saved-but-not-committed changes, kept in
 * local app state. A draft holds one entity *without its children*; a container's child order
 * travels as `childOrder`, and a moved entity records its new `parentId`/`index`.
 *
 * `applyDrafts(base, drafts)` is pure and tolerant: drafts that can't be applied (their entity
 * or parent is gone) come back as `stale` instead of failing the load.
 */

import type { Collection, Folder, ProjectItem, ProjectModel } from '../model/project';
import { findContainer, findItem, placementOf, replaceItem } from './commands';

export type DraftEntityKind = 'collection' | 'folder' | 'request';

export interface Draft {
  ref: { kind: DraftEntityKind; id: string };
  op: 'create' | 'update' | 'delete';
  /** The entity without children; containers add `childOrder` (child ids). */
  data?: DraftData;
  /** Container for creates and moves; `null` for collections. */
  parentId?: string | null;
  /** Position among the parent's children (or among collections). */
  index?: number;
  /** sha-256 of the entity's file when the draft was made; `null` for new entities. */
  baseHash?: string | null;
  /** ISO time (local only). */
  savedAt: string;
}

export type DraftData = Record<string, unknown> & { childOrder?: string[] };

type Entity = Collection | ProjectItem;

/** The collection, folder or request `id` and where it sits. */
export function locateEntity(
  model: ProjectModel,
  id: string,
): { entity: Entity; parentId: string | null; index: number } | undefined {
  const placement = placementOf(model, id);
  if (!placement) return undefined;
  const entity =
    placement.parentId === null ? model.collections[placement.index]! : findItem(model, id)!;
  return { entity, parentId: placement.parentId, index: placement.index };
}

function entityData(entity: Entity): DraftData {
  if (entity.kind === 'request') return structuredClone(entity) as unknown as DraftData;
  const { children, ...rest } = entity;
  return { ...structuredClone(rest), childOrder: children.map((child) => child.id) } as DraftData;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The draft that turns `base` into `working` for entity `id`, or `null` when they agree
 * (nothing to save). `hashOf` gives the base hash of an entity's file.
 */
export function createDraft(
  base: ProjectModel,
  working: ProjectModel,
  id: string,
  hashOf: (id: string) => string | null,
  now: string = new Date().toISOString(),
): Draft | null {
  const before = locateEntity(base, id);
  const after = locateEntity(working, id);
  if (!before && !after) return null;
  if (!after) {
    return {
      ref: { kind: before!.entity.kind, id },
      op: 'delete',
      baseHash: hashOf(id),
      savedAt: now,
    };
  }
  const data = entityData(after.entity);
  if (!before) {
    return {
      ref: { kind: after.entity.kind, id },
      op: 'create',
      data,
      parentId: after.parentId,
      index: after.index,
      baseHash: null,
      savedAt: now,
    };
  }
  const moved = before.parentId !== after.parentId;
  if (!moved && sameJson(entityData(before.entity), data)) return null;
  return {
    ref: { kind: after.entity.kind, id },
    op: 'update',
    data,
    parentId: after.parentId,
    index: after.index,
    baseHash: hashOf(id),
    savedAt: now,
  };
}

export interface AppliedDrafts {
  model: ProjectModel;
  /** Drafts that could not be applied (entity or parent missing). */
  stale: Draft[];
}

/** `base` with `drafts` applied (see the module comment). */
export function applyDrafts(base: ProjectModel, drafts: readonly Draft[]): AppliedDrafts {
  let model = base;
  const stale: Draft[] = [];
  let pending = drafts.filter((draft) => draft.op !== 'delete');

  // Creates and updates, repeated until no progress: a child may wait for its created parent.
  for (let progress = true; progress && pending.length > 0;) {
    progress = false;
    const waiting: Draft[] = [];
    for (const draft of pending) {
      const next = applyOne(model, draft);
      if (next === 'wait') waiting.push(draft);
      else if (next === 'stale') stale.push(draft);
      else {
        model = next;
        progress = true;
      }
    }
    pending = waiting;
  }
  stale.push(...pending);

  for (const draft of drafts) {
    if (draft.op === 'delete') model = removeEntity(model, draft.ref.id);
  }
  for (const draft of drafts) {
    const order = draft.op !== 'delete' ? draft.data?.childOrder : undefined;
    if (order && !stale.includes(draft)) model = applyChildOrder(model, draft.ref.id, order);
  }
  return { model, stale };
}

function applyOne(model: ProjectModel, draft: Draft): ProjectModel | 'wait' | 'stale' {
  const { id, kind } = draft.ref;
  const data = draft.data;
  if (!data) return 'stale';
  const current = locateEntity(model, id);
  if (draft.op === 'update' && !current) return 'stale';
  if (current && current.entity.kind !== kind) return 'stale';

  const children = current && current.entity.kind !== 'request' ? current.entity.children : [];
  const { childOrder: _order, ...fields } = data;
  const entity = (kind === 'request'
    ? { ...fields }
    : { ...fields, children }) as unknown as Entity;

  if (kind === 'collection') {
    const collections = model.collections.filter((c) => c.id !== id);
    const index = clamp(draft.index ?? collections.length, collections.length);
    collections.splice(index, 0, entity as Collection);
    return { ...model, collections };
  }
  const parentId = draft.parentId ?? current?.parentId ?? null;
  if (!parentId) return 'stale';
  // The parent may be a container created by another draft: wait for it.
  if (!findContainer(model, parentId)) return 'wait';
  const without = current ? removeEntity(model, id) : model;
  return insertInto(without, parentId, entity as ProjectItem, draft.index);
}

function removeEntity(model: ProjectModel, id: string): ProjectModel {
  if (model.collections.some((c) => c.id === id)) {
    return { ...model, collections: model.collections.filter((c) => c.id !== id) };
  }
  return findItem(model, id) ? replaceItem(model, id, () => null) : model;
}

function insertInto(
  model: ProjectModel,
  parentId: string,
  item: ProjectItem,
  index?: number,
): ProjectModel {
  const insert = <T extends Collection | Folder>(container: T): T => {
    const children = [...container.children];
    children.splice(clamp(index ?? children.length, children.length), 0, item);
    return { ...container, children };
  };
  if (model.collections.some((c) => c.id === parentId)) {
    return {
      ...model,
      collections: model.collections.map((c) => (c.id === parentId ? insert(c) : c)),
    };
  }
  return replaceItem(model, parentId, (folder) =>
    folder.kind === 'folder' ? insert(folder) : folder,
  );
}

/** Children listed in `order` first (in that order), then the others as they are. */
function applyChildOrder(
  model: ProjectModel,
  containerId: string,
  order: readonly string[],
): ProjectModel {
  const reorder = <T extends Collection | Folder>(container: T): T => {
    const rank = new Map(order.map((id, index) => [id, index]));
    const listed = container.children
      .filter((c) => rank.has(c.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const rest = container.children.filter((c) => !rank.has(c.id));
    const children = [...listed, ...rest];
    return children.every((c, i) => c === container.children[i])
      ? container
      : { ...container, children };
  };
  if (model.collections.some((c) => c.id === containerId)) {
    return {
      ...model,
      collections: model.collections.map((c) => (c.id === containerId ? reorder(c) : c)),
    };
  }
  const folder = findItem(model, containerId);
  return folder?.kind === 'folder'
    ? replaceItem(model, containerId, (f) => (f.kind === 'folder' ? reorder(f) : f))
    : model;
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(length, index));
}
