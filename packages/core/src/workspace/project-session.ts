/**
 * One open project (docs/architecture.md §3.2): the base model (what the files say), drafts
 * saved in local state (PIGN-018), in-memory edits on top, and change notifications. The UI
 * subscribes through `createProjectStore(session)`; nothing here knows about React.
 *
 * Change states (data-model.md §10): clean → *unsaved* (in memory) → *saved* (a draft in local
 * state) → clean again after Save for Commit (PIGN-019) or Discard.
 */

import type { ProjectReadResult } from '@pigeon/formats';
import { createEmptyProject, readProject } from '@pigeon/formats';
import type {
  AppStateStore,
  Platform,
  ProjectFileSystem,
  ProjectLocation,
  ProjectPath,
} from '@pigeon/platform';

import type { EditCommand } from './commands';
import type { Draft } from './drafts';
import { applyDrafts, createDraft, locateEntity } from './drafts';
import type { LocalProjectState } from './local-state';
import { LocalStateStore } from './local-state';
import { applyCommand, findItem, placementOf, replaceItem, touchedIds } from './commands';
import type {
  Collection,
  Folder,
  Problem,
  ProjectItem,
  ProjectModel,
  ProjectRequest,
} from '../model/project';

export type Unsubscribe = () => void;

/** Directories a new project starts with (file-format.md §1). */
export const PROJECT_DIRECTORIES = ['collections', 'environments', 'examples'] as const;

export interface ItemLocation {
  item: ProjectItem;
  collection: Collection;
  /** Folders from the collection down to the item's parent. */
  ancestors: Folder[];
  /** Directory holding the item's file (`collections/<c>/<folders…>`). */
  directory: ProjectPath;
}

/** Where an entity stands (data-model.md §10); drafts carry their operation for badges. */
export type ChangeState = 'clean' | 'unsaved' | 'created' | 'updated' | 'deleted';

export class ProjectSession {
  readonly location: ProjectLocation;
  readonly fs: ProjectFileSystem;
  #read: ProjectReadResult;
  /** Base model + drafts + in-memory edits. */
  #working: ProjectModel;
  /** Entities with in-memory (unsaved) edits. */
  readonly #unsaved = new Set<string>();
  /** Saved drafts by entity id. */
  readonly #drafts = new Map<string, Draft>();
  /** Drafts that couldn't be applied on load (entity or parent gone); kept until discarded. */
  #staleDrafts: Draft[] = [];
  readonly #local: LocalStateStore | undefined;
  /** Set when the local state was unreadable and was backed up (key name). */
  readonly localStateBackup: string | undefined;
  readonly #listeners = new Set<() => void>();

  private constructor(
    location: ProjectLocation,
    fs: ProjectFileSystem,
    read: ProjectReadResult,
    local?: { store: LocalStateStore; backedUpAs?: string },
  ) {
    this.location = location;
    this.fs = fs;
    this.#read = read;
    this.#working = read.model;
    this.#local = local?.store;
    this.localStateBackup = local?.backedUpAs;
    if (this.#local) this.#loadDrafts(this.#local.state.drafts);
  }

  /** Opens and reads a project. Rejects only when the folder can't be opened at all. */
  static async open(
    location: ProjectLocation,
    platform: Pick<Platform, 'openProjectFs'> & Partial<Pick<Platform, 'appState'>>,
  ): Promise<ProjectSession> {
    const fs = await platform.openProjectFs(location);
    return ProjectSession.fromFs(fs, platform.appState ? { appState: platform.appState } : {});
  }

  /** With `appState`, drafts and UI state are loaded from and saved to local state. */
  static async fromFs(
    fs: ProjectFileSystem,
    opts: { appState?: AppStateStore } = {},
  ): Promise<ProjectSession> {
    const read = await readProject(fs);
    const persistable = opts.appState && read.model.id !== '' && !read.readOnly;
    const local = persistable
      ? await LocalStateStore.load(opts.appState!, read.model.id)
      : undefined;
    return new ProjectSession(fs.root, fs, read, local);
  }

  #loadDrafts(drafts: readonly Draft[]): void {
    const { model, stale } = applyDrafts(this.#read.model, drafts);
    this.#working = model;
    this.#staleDrafts = stale;
    this.#drafts.clear();
    for (const draft of drafts) if (!stale.includes(draft)) this.#drafts.set(draft.ref.id, draft);
  }

  /** Local UI state of this project (tabs, layout, …); `undefined` without local state. */
  get localState(): Readonly<LocalProjectState> | undefined {
    return this.#local?.state;
  }

  /** Stores UI state (debounced). */
  updateLocalState(patch: Partial<LocalProjectState>): void {
    void this.#local?.update(patch);
  }

  /** Writes pending UI state now (e.g. before the project closes). */
  flushLocalState(): Promise<void> {
    return this.#local?.flush() ?? Promise.resolve();
  }

  get id(): string {
    return this.#read.model.id;
  }

  get name(): string {
    return this.#read.model.name;
  }

  get problems(): readonly Problem[] {
    return this.#read.problems;
  }

  /** Newer format version, or an unusable `pigeon.json`. */
  get readOnly(): boolean {
    return this.#read.readOnly;
  }

  /** sha-256 per managed file as last read. */
  get fileHashes(): ReadonlyMap<ProjectPath, { hash: string }> {
    return this.#read.files;
  }

  /** What the files on disk say. */
  getBaseModel(): ProjectModel {
    return this.#read.model;
  }

  /** What the UI shows: base + in-memory edits (+ drafts from PIGN-018). */
  getWorkingModel(): ProjectModel {
    return this.#working;
  }

  /** Applies an in-memory edit; the entity becomes *unsaved*. Throws for read-only projects. */
  apply(command: EditCommand): void {
    if (this.readOnly) throw new Error('This project is read-only.');
    const touched = touchedIds(this.#working, command);
    this.#working = applyCommand(this.#working, command);
    for (const id of touched) this.#unsaved.add(id);
    this.#emit();
  }

  isUnsaved(id: string): boolean {
    return this.#unsaved.has(id);
  }

  unsavedIds(): string[] {
    return [...this.#unsaved];
  }

  /** Drops the in-memory edits of `id`: the entity goes back to its saved draft, or its file. */
  discardUnsaved(id: string): void {
    if (!this.#unsaved.delete(id)) return;
    this.#working = restoreFromBase(this.#working, this.#savedModel(), id);
    this.#emit();
  }

  get drafts(): readonly Draft[] {
    return [...this.#drafts.values()];
  }

  get staleDrafts(): readonly Draft[] {
    return this.#staleDrafts;
  }

  changeState(id: string): ChangeState {
    if (this.#unsaved.has(id)) return 'unsaved';
    const draft = this.#drafts.get(id);
    if (!draft) return 'clean';
    return draft.op === 'create' ? 'created' : draft.op === 'delete' ? 'deleted' : 'updated';
  }

  /** Entities deleted by a saved draft, as the files still have them (for the explorer). */
  deletedEntities(): Array<{
    id: string;
    name: string;
    kind: Draft['ref']['kind'];
    parentId: string | null;
    method?: string;
  }> {
    const deleted = [];
    for (const draft of this.#drafts.values()) {
      if (draft.op !== 'delete') continue;
      const found = locateEntity(this.#read.model, draft.ref.id);
      if (!found) continue;
      deleted.push({
        id: draft.ref.id,
        name: found.entity.name,
        kind: found.entity.kind,
        parentId: found.parentId,
        ...(found.entity.kind === 'request' ? { method: found.entity.method } : {}),
      });
    }
    return deleted;
  }

  /**
   * **Save** (file-format.md §5): turns the in-memory edits of `ids` (default: all) into drafts
   * in local state. New containers an entity lives in are saved with it. Project files don't
   * change.
   */
  async save(ids?: readonly string[]): Promise<void> {
    if (!this.#local) throw new Error('This project has no local state to save to.');
    const targets = new Set(ids ?? this.#unsaved);
    // Structural prerequisites: unsaved parents of created or moved entities.
    for (const id of [...targets]) {
      let parent = locateEntity(this.#working, id)?.parentId;
      while (parent && this.#unsaved.has(parent)) {
        targets.add(parent);
        parent = locateEntity(this.#working, parent)?.parentId;
      }
    }
    const now = new Date().toISOString();
    for (const id of targets) {
      if (!this.#unsaved.has(id) && ids !== undefined && !this.#drafts.has(id)) continue;
      const draft = createDraft(
        this.#read.model,
        this.#working,
        id,
        (entityId) => this.#baseHash(entityId),
        now,
      );
      if (draft) this.#drafts.set(id, draft);
      else this.#drafts.delete(id);
      this.#unsaved.delete(id);
    }
    await this.#persistDrafts();
    this.#emit();
  }

  /** Drops the draft and any unsaved edits of `id`: the entity is back to its file version. */
  async discard(id: string): Promise<void> {
    const created =
      this.#drafts.get(id)?.op === 'create' ||
      (!locateEntity(this.#read.model, id) && !!locateEntity(this.#working, id));
    // Discarding a new container discards what was created inside it too.
    const ids = created ? [id, ...descendantIds(this.#working, id)] : [id];
    for (const each of ids) {
      this.#drafts.delete(each);
      this.#unsaved.delete(each);
    }
    this.#staleDrafts = this.#staleDrafts.filter((draft) => !ids.includes(draft.ref.id));
    this.#working = restoreFromBase(this.#working, this.#read.model, id);
    await this.#persistDrafts();
    this.#emit();
  }

  /** The model with saved drafts only (no in-memory edits). */
  #savedModel(): ProjectModel {
    return applyDrafts(this.#read.model, [...this.#drafts.values()]).model;
  }

  #baseHash(id: string): string | null {
    const path = filePathIn(this.#read.model, id);
    return (path && this.#read.files.get(path)?.hash) ?? null;
  }

  async #persistDrafts(): Promise<void> {
    await this.#local?.update(
      { drafts: [...this.#drafts.values(), ...this.#staleDrafts] },
      { immediate: true },
    );
  }

  /** Problems reported for one file. */
  problemsFor(path: ProjectPath): Problem[] {
    return this.#read.problems.filter((problem) => problem.path === path);
  }

  findRequest(id: string): ProjectRequest | undefined {
    const found = this.locate(id)?.item;
    return found?.kind === 'request' ? found : undefined;
  }

  /** Where an item lives in the working model, or `undefined`. */
  locate(id: string): ItemLocation | undefined {
    for (const collection of this.getWorkingModel().collections) {
      const found = locateIn(collection.children, id, `collections/${collection.fileKey}`, []);
      if (found) return { ...found, collection };
    }
    return undefined;
  }

  /** The file path of an item (`folder.json` for folders) in the working model. */
  itemFilePath(id: string): ProjectPath | undefined {
    return filePathIn(this.getWorkingModel(), id);
  }

  /** Re-reads every file (manual refresh; the watcher arrives in PIGN-020). */
  async reload(): Promise<void> {
    this.#read = await readProject(this.fs);
    // Drafts and unsaved edits stay on top of the new files (conflicts arrive with PIGN-020).
    const before = this.#working;
    this.#loadDrafts([...this.#drafts.values(), ...this.#staleDrafts]);
    let working = this.#working;
    for (const id of [...this.#unsaved]) {
      const edited = findItem(before, id);
      if (!edited || !findItem(working, id)) {
        this.#unsaved.delete(id);
        continue;
      }
      working = replaceItem(working, id, (item) => keepChildren(edited, item));
    }
    this.#working = working;
    this.#emit();
  }

  onChange(listener: () => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

/**
 * `working` with entity `id` back to its file version: an edited entity takes the base fields
 * (keeping its current children), a created one disappears, a deleted one returns to its old
 * place when that container still exists.
 */
function restoreFromBase(working: ProjectModel, base: ProjectModel, id: string): ProjectModel {
  const baseCollection = base.collections.find((c) => c.id === id);
  const workingCollection = working.collections.find((c) => c.id === id);
  if (baseCollection || workingCollection) {
    if (!baseCollection)
      return { ...working, collections: working.collections.filter((c) => c.id !== id) };
    if (!workingCollection) {
      const index = base.collections.indexOf(baseCollection);
      const collections = [...working.collections];
      collections.splice(Math.min(index, collections.length), 0, baseCollection);
      return { ...working, collections };
    }
    return {
      ...working,
      collections: working.collections.map((c) =>
        c.id === id ? { ...baseCollection, children: c.children } : c,
      ),
    };
  }
  const baseItem = findItem(base, id);
  const current = findItem(working, id);
  if (current) {
    return replaceItem(working, id, (item) =>
      baseItem && baseItem.kind === item.kind ? keepChildren(baseItem, item) : null,
    );
  }
  const placement = baseItem ? placementOf(base, id) : undefined;
  if (!baseItem || !placement?.parentId) return working;
  const parentId = placement.parentId;
  const parentCollection = working.collections.find((c) => c.id === parentId);
  const insert = <T extends { children: ProjectItem[] }>(container: T): T => {
    const children = [...container.children];
    children.splice(Math.min(placement.index, children.length), 0, baseItem);
    return { ...container, children };
  };
  if (parentCollection) {
    return {
      ...working,
      collections: working.collections.map((c) => (c === parentCollection ? insert(c) : c)),
    };
  }
  if (findItem(working, parentId)?.kind !== 'folder') return working;
  return replaceItem(working, parentId, (folder) =>
    folder.kind === 'folder' ? insert(folder) : folder,
  );
}

/** The file of a collection, folder or request in `model`. */
function filePathIn(model: ProjectModel, id: string): ProjectPath | undefined {
  const collection = model.collections.find((c) => c.id === id);
  if (collection) return `collections/${collection.fileKey}/collection.json`;
  for (const c of model.collections) {
    const found = locateIn(c.children, id, `collections/${c.fileKey}`, []);
    if (found) {
      return found.item.kind === 'request'
        ? `${found.directory}/${found.item.fileKey}.request.json`
        : `${found.directory}/${found.item.fileKey}/folder.json`;
    }
  }
  return undefined;
}

function descendantIds(model: ProjectModel, id: string): string[] {
  const entity = locateEntity(model, id)?.entity;
  if (!entity || entity.kind === 'request') return [];
  const ids: string[] = [];
  const walk = (items: readonly ProjectItem[]) => {
    for (const item of items) {
      ids.push(item.id);
      if (item.kind === 'folder') walk(item.children);
    }
  };
  walk(entity.children);
  return ids;
}

/** `entity` with the children of `current` (folder edits never carry their children). */
function keepChildren(entity: ProjectItem, current: ProjectItem): ProjectItem {
  return entity.kind === 'folder' && current.kind === 'folder'
    ? { ...entity, children: current.children }
    : entity;
}

function locateIn(
  items: readonly ProjectItem[],
  id: string,
  directory: ProjectPath,
  ancestors: Folder[],
): Omit<ItemLocation, 'collection'> | undefined {
  for (const item of items) {
    if (item.id === id) return { item, ancestors, directory };
    if (item.kind === 'folder') {
      const found = locateIn(item.children, id, `${directory}/${item.fileKey}`, [
        ...ancestors,
        item,
      ]);
      if (found) return found;
    }
  }
  return undefined;
}

/** True when the folder already holds a Pigeon project. */
export async function isPigeonProject(fs: ProjectFileSystem): Promise<boolean> {
  return (await fs.stat('pigeon.json'))?.kind === 'file';
}

/**
 * Turns a folder into an empty Pigeon project: `pigeon.json`, `.gitattributes` (only if absent,
 * it is user-owned afterwards) and the `collections/`, `environments/`, `examples/` directories.
 */
export async function initializeProject(fs: ProjectFileSystem, name: string): Promise<void> {
  const { files } = createEmptyProject(name);
  for (const [path, bytes] of files) {
    if (path === '.gitattributes' && (await fs.exists(path))) continue;
    await fs.writeFileAtomic(path, bytes);
  }
  for (const dir of PROJECT_DIRECTORIES) await fs.mkdirp(dir);
}
