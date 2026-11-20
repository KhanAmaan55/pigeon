/**
 * Auth inheritance (data-model.md §4.1): a folder or request without auth inherits from its
 * nearest ancestor that has one; `noauth` stops inheritance; a collection without auth has none.
 */

import type { Auth } from '../../model/auth';
import type { ProjectModel } from '../../model/project';
import { itemAncestry } from '../../variables/scopes';

/** Where an effective auth is defined. */
export interface AuthOrigin {
  kind: 'collection' | 'folder' | 'request';
  id: string;
  name: string;
}

export interface EffectiveAuth {
  /** `undefined`: no auth at all. */
  auth: Auth | undefined;
  /** The entity defining `auth`; `undefined` when nothing does. */
  origin?: AuthOrigin;
}

/** The auth an item (request or folder) gets from its ancestors when it has none of its own. */
export function inheritedAuth(model: ProjectModel, itemId: string): EffectiveAuth {
  const found = itemAncestry(model, itemId);
  if (!found) return { auth: undefined };
  for (const folder of [...found.folders].reverse()) {
    if (folder.auth !== undefined) {
      return { auth: folder.auth, origin: { kind: 'folder', id: folder.id, name: folder.name } };
    }
  }
  const { collection } = found;
  if (collection.id === itemId || collection.auth === undefined) return { auth: undefined };
  return {
    auth: collection.auth,
    origin: { kind: 'collection', id: collection.id, name: collection.name },
  };
}
