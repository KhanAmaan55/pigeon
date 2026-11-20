/**
 * Save for Commit planning (docs/file-format.md §5.1): which project files to write, delete and
 * which directories to remove so the files match base + the selected drafts. Pure: the caller
 * scans the disk (`DiskState`) and applies the plan.
 *
 * Safety rules:
 * - only paths the base knew (read on load) or the new model produces are touched; files that
 *   appeared on disk since are never deleted;
 * - a managed file that failed to parse is never written over or deleted;
 * - an entity whose file changed on disk since its draft was saved (`baseHash`) blocks the plan
 *   for that entity (conflict, resolved in PIGN-020);
 * - partial commits only delete files owned by the selected entities, and pull in structural
 *   prerequisites (new parent folders, parents whose child order changes).
 */

import {
  COMPARE_FILE,
  isEmptyComparison,
  EXAMPLE_SUFFIX,
  exampleBodyFileName,
  exampleDirectory,
  serializeProject,
} from '@pigeon/formats';
import type { ProjectPath } from '@pigeon/platform';

import type { ProjectItem, ProjectModel } from '../model/project';
import type { Draft } from './drafts';
import { GLOBALS_ENTITY_ID, PROJECT_ENTITY_ID } from './commands';
import { applyDrafts, locateEntity } from './drafts';

/** Managed files on disk now: path → sha-256, `null` for files Pigeon doesn't manage. */
export type DiskState = ReadonlyMap<ProjectPath, string | null>;

export interface PlannedWrite {
  path: ProjectPath;
  bytes: Uint8Array;
  /** `add`: the file doesn't exist yet. */
  kind: 'add' | 'modify';
  /** The entity the file belongs to (`undefined` for `pigeon.json`). */
  entityId?: string;
}

export interface PlannedRename {
  from: ProjectPath;
  to: ProjectPath;
  entityId: string;
}

export interface CommitConflict {
  entityId: string;
  path: ProjectPath | undefined;
  reason: 'changed-on-disk' | 'deleted-on-disk' | 'broken-file';
}

export interface CommitPlan {
  /** Draft ids committed: the selection plus prerequisites. */
  entityIds: string[];
  /** Ids added to the selection as structural prerequisites. */
  prerequisites: string[];
  writes: PlannedWrite[];
  deletes: ProjectPath[];
  /** Directories left empty, deepest first. */
  rmdirs: ProjectPath[];
  /** Delete + write pairs of one entity, for display (`R old → new`). */
  renames: PlannedRename[];
  /** Entities that can't be committed; the plan doesn't include them. */
  blocked: CommitConflict[];
  /** E.g. directories kept because they still contain the user's own files. */
  warnings: string[];
  /** The base model after the commit. */
  model: ProjectModel;
}

export interface PlanInput {
  base: ProjectModel;
  drafts: readonly Draft[];
  /** Entity ids to commit; `undefined` = all drafts. */
  selection?: readonly string[];
  disk: DiskState;
  /** Managed paths the base was read from (`ProjectReadResult.files`). */
  knownPaths: ReadonlySet<ProjectPath>;
  /** Managed files that failed to parse on load. */
  brokenPaths: ReadonlySet<ProjectPath>;
  /** sha-256 of the bytes, to compare with the disk. */
  hash: (bytes: Uint8Array) => Promise<string>;
}

export async function planCommit(input: PlanInput): Promise<CommitPlan> {
  const drafts = new Map(input.drafts.map((draft) => [draft.ref.id, draft]));
  const requested = input.selection
    ? input.selection.filter((id) => drafts.has(id))
    : [...drafts.keys()];
  const selected = new Set(requested);
  const prerequisites: string[] = [];
  const addPrerequisite = (id: string | null | undefined) => {
    if (!id || selected.has(id) || !drafts.has(id)) return;
    selected.add(id);
    prerequisites.push(id);
  };
  // Parents of created, moved and deleted entities: new folders must exist, child orders change.
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...selected]) {
      const draft = drafts.get(id)!;
      const before = locateEntity(input.base, id)?.parentId;
      for (const parent of [draft.parentId, before]) {
        if (parent && !selected.has(parent) && drafts.has(parent)) {
          addPrerequisite(parent);
          changed = true;
        }
      }
    }
  }

  // Conflicts: the entity's file must still be what the draft was based on.
  const blocked: CommitConflict[] = [];
  for (const id of selected) {
    const draft = drafts.get(id)!;
    const path = entityFilePath(input.base, id);
    if (path && input.brokenPaths.has(path) && draft.op !== 'delete') {
      blocked.push({ entityId: id, path, reason: 'broken-file' });
      continue;
    }
    if (draft.baseHash === undefined || draft.baseHash === null) continue;
    const onDisk = path === undefined ? undefined : input.disk.get(path);
    if (onDisk === undefined) {
      if (draft.op !== 'delete') blocked.push({ entityId: id, path, reason: 'deleted-on-disk' });
    } else if (onDisk !== draft.baseHash) {
      blocked.push({ entityId: id, path, reason: 'changed-on-disk' });
    }
  }
  const blockedIds = new Set(blocked.map((conflict) => conflict.entityId));
  const committed = [...selected].filter((id) => !blockedIds.has(id));
  const model = applyDrafts(
    input.base,
    committed.map((id) => drafts.get(id)!),
  ).model;

  // Desired bytes; every path is attributed to its entity for display and ownership. Only files
  // of committed entities (or below a committed container, e.g. after a folder rename) are
  // written, so files changed on disk by others are left alone.
  const desired = serializeProject(model);
  const owners = pathOwners(model);
  const baseOwners = pathOwners(input.base);
  const committedSet = new Set(committed);
  const parents = parentMap(model);
  const isCommitted = (id: string | undefined): boolean => {
    for (let current = id; current; current = parents.get(current) ?? undefined) {
      if (committedSet.has(current)) return true;
    }
    return false;
  };
  const collectionsChanged = committed.some((id) => {
    const kind = drafts.get(id)!.ref.kind;
    return kind === 'collection' || kind === 'project';
  });
  const baseParents = parentMap(input.base);
  const childParents = new Set<string>();
  for (const id of committed) {
    for (const parent of [parents.get(id), baseParents.get(id)])
      if (parent) childParents.add(parent);
  }
  const writes: PlannedWrite[] = [];
  for (const [path, bytes] of desired) {
    if (input.brokenPaths.has(path)) continue;
    const owner = owners.get(path);
    // A container's file lists its children's file keys: it changes with a committed child.
    const parentOfCommitted = owner !== undefined && childParents.has(owner);
    if (path === 'pigeon.json' ? !collectionsChanged : !isCommitted(owner) && !parentOfCommitted) {
      continue;
    }
    const onDisk = input.disk.get(path);
    if (onDisk !== undefined && onDisk !== null && onDisk === (await input.hash(bytes))) continue;
    writes.push({
      path,
      bytes,
      kind: onDisk === undefined ? 'add' : 'modify',
      ...(owners.get(path) ? { entityId: owners.get(path)! } : {}),
    });
  }

  // Deletes: files of committed entities that the new model no longer produces.
  const owned = new Set<string>();
  for (const id of committed) for (const path of ownedPaths(input.base, id)) owned.add(path);
  const deletes = [...input.knownPaths]
    .filter(
      (path) =>
        !desired.has(path) &&
        input.disk.has(path) &&
        !input.brokenPaths.has(path) &&
        (owned.has(path) ||
          [...owned].some((prefix) => prefix.endsWith('/') && path.startsWith(prefix))),
    )
    .sort();

  // Directories that end up empty (deepest first); others are kept with a warning.
  const remaining = new Set([...input.disk.keys()].filter((path) => !deletes.includes(path)));
  for (const write of writes) remaining.add(write.path);
  const candidates = new Set<string>();
  for (const path of deletes) {
    // The top-level directories (collections/, environments/, examples/) always stay.
    for (let dir = parentOf(path); dir.includes('/'); dir = parentOf(dir)) candidates.add(dir);
  }
  const rmdirs: string[] = [];
  const warnings: string[] = [];
  for (const dir of [...candidates].sort(
    (a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b),
  )) {
    const left = [...remaining].filter((path) => path.startsWith(`${dir}/`));
    if (left.length === 0) rmdirs.push(dir);
    else if (left.every((path) => input.disk.get(path) === null)) {
      warnings.push(
        `${dir} is kept: it contains files Pigeon doesn't manage (${left.map((p) => p.slice(dir.length + 1)).join(', ')}).`,
      );
    }
  }

  // Renames: a deleted and a written path of the same entity.
  const renames: PlannedRename[] = [];
  const paired = new Set<string>();
  for (const from of deletes) {
    const entityId = baseOwners.get(from);
    if (!entityId) continue;
    // An entity may own several files (a request and its examples): pair by file name first.
    const candidates = writes.filter(
      (write) => write.entityId === entityId && write.kind === 'add' && !paired.has(write.path),
    );
    const to = (
      candidates.find((write) => baseName(write.path) === baseName(from)) ??
      candidates.find((write) => fileRole(write.path) === fileRole(from))
    )?.path;
    if (to) {
      paired.add(to);
      renames.push({ from, to, entityId });
    }
  }

  return {
    entityIds: committed,
    prerequisites: prerequisites.filter((id) => !blockedIds.has(id)),
    writes,
    deletes,
    rmdirs,
    renames,
    blocked,
    warnings,
    model,
  };
}

/** `collections/<c>/…` file of a collection, folder or request in `model`. */
export function entityFilePath(model: ProjectModel, id: string): ProjectPath | undefined {
  if (id === PROJECT_ENTITY_ID) return 'pigeon.json';
  if (id === GLOBALS_ENTITY_ID) return 'environments/globals.postman_globals.json';
  return pathEntries(model).find(([, owner]) => owner === id)?.[0];
}

/** Path → owning entity id for every file `serializeProject(model)` produces. */
function pathOwners(model: ProjectModel): Map<ProjectPath, string> {
  return new Map(pathEntries(model));
}

function pathEntries(model: ProjectModel): Array<[ProjectPath, string]> {
  const entries: Array<[ProjectPath, string]> = model.environments.map((e) => [
    `environments/${e.fileKey}.postman_environment.json`,
    e.id,
  ]);
  if (model.globals) entries.push(['environments/globals.postman_globals.json', GLOBALS_ENTITY_ID]);
  const visit = (items: readonly ProjectItem[], dir: string) => {
    for (const item of items) {
      if (item.kind === 'request') {
        entries.push([`${dir}/${item.fileKey}.request.json`, item.id]);
        // Example files belong to their request (PIGN-027).
        const examples = exampleDirectory(dir, item.fileKey);
        for (const example of item.examples) {
          entries.push([`${examples}/${example.fileKey}${EXAMPLE_SUFFIX}`, item.id]);
          const body = exampleBodyFileName(example);
          if (body) entries.push([`${examples}/${body}`, item.id]);
        }
        // And its comparison config (PIGN-035).
        if (!isEmptyComparison(item.comparison)) {
          entries.push([`${examples}/${COMPARE_FILE}`, item.id]);
        }
      } else {
        entries.push([`${dir}/${item.fileKey}/folder.json`, item.id]);
        visit(item.children, `${dir}/${item.fileKey}`);
      }
    }
  };
  for (const collection of model.collections) {
    entries.push([`collections/${collection.fileKey}/collection.json`, collection.id]);
    visit(collection.children, `collections/${collection.fileKey}`);
  }
  return entries;
}

/**
 * Paths an entity owns in `model`: its file, and for collections and folders everything below
 * their directory (a `…/` prefix), since a delete, rename or move takes the whole subtree.
 */
function ownedPaths(model: ProjectModel, id: string): string[] {
  const path = entityFilePath(model, id);
  if (!path) return [];
  const entity = locateEntity(model, id)?.entity;
  // The matching directory under examples/ (a request's examples, a container's subtree).
  const examplesOf = (directory: string) => `examples/${directory.slice('collections/'.length)}/`;
  if (entity && entity.kind !== 'request') {
    return [path, `${parentOf(path)}/`, examplesOf(parentOf(path))];
  }
  if (entity?.kind === 'request') {
    return [path, examplesOf(`${parentOf(path)}/${entity.fileKey}`)];
  }
  return [path];
}

/** Entity id → parent container id (`null` for collections). */
function parentMap(model: ProjectModel): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  const visit = (items: readonly ProjectItem[], parentId: string) => {
    for (const item of items) {
      parents.set(item.id, parentId);
      if (item.kind === 'folder') visit(item.children, item.id);
    }
  };
  for (const collection of model.collections) {
    parents.set(collection.id, null);
    visit(collection.children, collection.id);
  }
  return parents;
}

/** What a file is to its entity: its own file, an example, or an example body. */
function fileRole(path: string): string {
  if (path.endsWith(EXAMPLE_SUFFIX)) return 'example';
  if (path.startsWith('examples/')) return 'example-body';
  return 'entity';
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}
