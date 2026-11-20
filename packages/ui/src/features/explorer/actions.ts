/**
 * Explorer actions (PIGN-017) on top of `ProjectSession` edit commands. They only change the
 * working model in memory; Save / Save for Commit arrive with PIGN-018/019.
 */

import type { ProjectSession } from '@pigeon/core';
import { findContainer, isSameOrDescendant, placementOf } from '@pigeon/core';

import type { ProjectStore } from '../../stores/project-store';

/** A request whose editor should focus the URL input when it mounts (after "New request"). */
let pendingUrlFocus: string | null = null;

/** True once for the request "New request" just created. */
export function takeUrlFocus(requestId: string): boolean {
  if (pendingUrlFocus !== requestId) return false;
  pendingUrlFocus = null;
  return true;
}

/** The collection or folder new items go into, given the selection. */
export function targetContainerId(
  session: ProjectSession,
  selectedId: string | null,
): string | null {
  const model = session.getWorkingModel();
  if (selectedId) {
    if (findContainer(model, selectedId)) return selectedId;
    const parent = placementOf(model, selectedId)?.parentId;
    if (parent) return parent;
  }
  return model.collections[0]?.id ?? null;
}

export function newCollection(
  session: ProjectSession,
  store: ProjectStore,
  name = 'New Collection',
): string {
  const id = crypto.randomUUID();
  session.apply({ type: 'createCollection', id, name });
  const state = store.getState();
  state.setExpanded(id, true);
  state.select(id);
  state.startRename(id);
  return id;
}

export function newFolder(session: ProjectSession, store: ProjectStore, parentId: string): string {
  const id = crypto.randomUUID();
  session.apply({ type: 'createFolder', id, parentId, name: 'New Folder' });
  const state = store.getState();
  state.setExpanded(parentId, true);
  state.select(id);
  state.startRename(id);
  return id;
}

/** Cmd/Ctrl+N: a new request in the selected container, opened in a pinned tab with the URL focused. */
export function newRequest(
  session: ProjectSession,
  store: ProjectStore,
  parentId?: string | null,
  kind: 'http' | 'graphql' = 'http',
): string | null {
  let target = parentId ?? targetContainerId(session, store.getState().selectedId);
  if (!target) target = newCollection(session, store);
  const id = crypto.randomUUID();
  session.apply({
    type: 'createRequest',
    id,
    parentId: target,
    // "New GraphQL request" (PIGN-032): POST with an empty GraphQL body.
    ...(kind === 'graphql'
      ? {
          name: 'New GraphQL Request',
          request: { method: 'POST', body: { mode: 'graphql', query: '', variables: '' } },
        }
      : { name: 'New Request' }),
  });
  const state = store.getState();
  state.setExpanded(target, true);
  state.cancelRename();
  pendingUrlFocus = id;
  state.openTab(id, { pin: true });
  return id;
}

export function duplicate(session: ProjectSession, store: ProjectStore, id: string): string {
  const newId = crypto.randomUUID();
  session.apply({ type: 'duplicateItem', id, newId });
  store.getState().select(newId);
  return newId;
}

/** Request ids at or below `id` (for closing their tabs). */
export function requestIdsUnder(session: ProjectSession, id: string): string[] {
  const model = session.getWorkingModel();
  const ids: string[] = [];
  const collect = (items: readonly { id: string; kind: string; children?: unknown }[]) => {
    for (const item of items) {
      if (item.kind === 'request') ids.push(item.id);
      else collect((item as { children: typeof items }).children);
    }
  };
  if (session.findRequest(id)) return [id];
  const container = findContainer(model, id);
  if (container) collect(container.children);
  return ids;
}

export type DropPosition = 'before' | 'after' | 'inside';

export interface DropTarget {
  kind: 'collection' | 'folder' | 'request';
  id: string;
  position: DropPosition;
}

/**
 * The move a drop stands for, or `null` when it isn't allowed: collections only reorder among
 * collections, items can't go before/after a collection, and nothing moves into itself.
 */
export function resolveDrop(
  session: ProjectSession,
  draggedId: string,
  target: DropTarget,
):
  | { type: 'moveCollection'; id: string; index: number }
  | { type: 'moveItem'; id: string; parentId: string; index: number }
  | null {
  const model = session.getWorkingModel();
  const dragged = placementOf(model, draggedId);
  if (!dragged || draggedId === target.id) return null;
  if (dragged.parentId === null) {
    if (target.kind !== 'collection' || target.position === 'inside') return null;
    const index = model.collections.findIndex((c) => c.id === target.id);
    return {
      type: 'moveCollection',
      id: draggedId,
      index: target.position === 'before' ? index : index + 1,
    };
  }
  if (target.position === 'inside') {
    if (target.kind === 'request') return null;
    if (isSameOrDescendant(model, target.id, draggedId)) return null;
    const container = findContainer(model, target.id);
    return container
      ? { type: 'moveItem', id: draggedId, parentId: target.id, index: container.children.length }
      : null;
  }
  if (target.kind === 'collection') return null;
  const placement = placementOf(model, target.id);
  if (!placement?.parentId || isSameOrDescendant(model, placement.parentId, draggedId)) return null;
  return {
    type: 'moveItem',
    id: draggedId,
    parentId: placement.parentId,
    index: target.position === 'before' ? placement.index : placement.index + 1,
  };
}

/** Case-insensitive subsequence match ("fuzzy"): `lsu` matches "List users". */
export function fuzzyMatch(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  let from = 0;
  for (const char of query.toLowerCase()) {
    if (char === ' ') continue;
    const at = haystack.indexOf(char, from);
    if (at === -1) return false;
    from = at + 1;
  }
  return true;
}
