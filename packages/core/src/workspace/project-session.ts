/**
 * One open project (docs/architecture.md §3.2): the base model (what the files say), drafts
 * saved in local state (PIGN-018), in-memory edits on top, and change notifications. The UI
 * subscribes through `createProjectStore(session)`; nothing here knows about React.
 *
 * Change states (data-model.md §10): clean → *unsaved* (in memory) → *saved* (a draft in local
 * state) → clean again after Save for Commit (PIGN-019) or Discard.
 */

import type { ProjectEnvironment, ProjectReadResult } from '@pigeon/formats';
import {
  createEmptyProject,
  isManagedPath,
  readProject,
  serializeProject,
  sha256Hex,
} from '@pigeon/formats';
import type {
  AppStateStore,
  Platform,
  ProjectFileSystem,
  ProjectLocation,
  ProjectPath,
} from '@pigeon/platform';

import type { EditCommand } from './commands';
import type { CommitPlan, DiskState } from './commit-planner';
import { planCommit } from './commit-planner';
import type { Draft } from './drafts';
import { applyDrafts, createDraft, locateEntity } from './drafts';
import type { LocalProjectState } from './local-state';
import { LocalStateStore } from './local-state';
import {
  applyCommand,
  findItem,
  placementOf,
  GLOBALS_ENTITY_ID,
  PROJECT_ENTITY_ID,
  replaceItem,
  touchedIds,
} from './commands';
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

export interface CommitResult {
  written: ProjectPath[];
  deleted: ProjectPath[];
  removedDirs: ProjectPath[];
}

/** A Save for Commit that failed part-way; drafts are intact and the base follows the disk. */
export class CommitError extends Error {
  override readonly name = 'CommitError';
  constructor(
    message: string,
    readonly written: ProjectPath[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Where an entity stands (data-model.md §10); drafts carry their operation for badges. */
export type ChangeState = 'clean' | 'unsaved' | 'created' | 'updated' | 'deleted' | 'conflict';

/**
 * A draft that no longer fits the files (file-format.md §8): the entity's file changed on disk
 * since the draft was saved, or it was deleted on disk while a draft edits it.
 */
export interface Conflict {
  entityId: string;
  kind: Draft['ref']['kind'];
  name: string;
  reason: 'changed-on-disk' | 'deleted-on-disk';
  /** The entity's file (in the new files, or where it was). */
  path: ProjectPath | undefined;
}

/** How often the watcher looks at changed files at most (file-format.md §8). */
export const WATCH_DEBOUNCE_MS = 250;

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
  /** Drafts in conflict with the files, by entity id. */
  readonly #conflicts = new Map<string, Conflict>();
  /** Entities with unsaved edits whose file changed on disk ("Reload or keep editing?"). */
  readonly #externallyChanged = new Set<string>();
  /** Hashes of files this session wrote, so the watcher (PIGN-020) can ignore its own writes. */
  readonly #ownWrites = new Map<ProjectPath, string>();
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
    this.#detectConflicts();
  }

  /** Opens and reads a project. Rejects only when the folder can't be opened at all. */
  static async open(
    location: ProjectLocation,
    platform: Pick<Platform, 'openProjectFs'> & Partial<Pick<Platform, 'appState'>>,
  ): Promise<ProjectSession> {
    const fs = await platform.openProjectFs(location);
    return ProjectSession.fromFs(fs, platform.appState ? { appState: platform.appState } : {});
  }

  /**
   * With `appState`, drafts and UI state are loaded from and saved to local state under
   * `project:<localKey>` — the project id, or `<id>@<hash>` for a copy of a project that is
   * already known at another location (file-format.md §6).
   */
  static async fromFs(
    fs: ProjectFileSystem,
    opts: {
      appState?: AppStateStore;
      localKey?: (projectId: string) => string | Promise<string>;
    } = {},
  ): Promise<ProjectSession> {
    const read = await readProject(fs);
    const persistable = opts.appState !== undefined && read.model.id !== '' && !read.readOnly;
    const localKey = persistable
      ? await (opts.localKey?.(read.model.id) ?? read.model.id)
      : read.model.id;
    const local = persistable ? await LocalStateStore.load(opts.appState!, localKey) : undefined;
    const session = new ProjectSession(fs.root, fs, read, local);
    session.localKey = localKey;
    return session;
  }

  /** Key of this project's local state (and transport pool): the id, or `<id>@<hash>`. */
  localKey = '';

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

  /** The selected environment (PIGN-022), if it still exists; `null` = No environment. */
  get selectedEnvironmentId(): string | null {
    const id = this.#local?.state.selectedEnvironmentId ?? null;
    return id && this.#working.environments.some((e) => e.id === id) ? id : null;
  }

  selectEnvironment(id: string | null): void {
    void this.#local?.update({ selectedEnvironmentId: id }, { immediate: true });
    this.#emit();
  }

  /** Current values of a scope (`env:<id>`, `collection:<id>`, `globals`): local only, never drafts. */
  currentValues(scope: string): Readonly<Record<string, string>> {
    return this.#local?.state.currentValues?.[scope] ?? {};
  }

  /** Sets (or with `undefined` clears) a current value; written at once, never to files. */
  setCurrentValue(scope: string, key: string, value: string | undefined): void {
    const all = { ...this.#local?.state.currentValues };
    const values = { ...all[scope] };
    if (value === undefined) delete values[key];
    else values[key] = value;
    if (Object.keys(values).length === 0) delete all[scope];
    else all[scope] = values;
    void this.#local?.update({ currentValues: all }, { immediate: true });
    this.#emit();
  }

  /** "Reset current values": back to the shared values. */
  resetCurrentValues(scope: string): void {
    const all = { ...this.#local?.state.currentValues };
    delete all[scope];
    void this.#local?.update({ currentValues: all }, { immediate: true });
    this.#emit();
  }

  /**
   * "Persist current as shared": copies an environment's current values into its shared values
   * as an unsaved edit (to be saved / committed like any change) and clears the current values.
   */
  persistCurrentAsShared(environmentId: string): void {
    const environment = this.#working.environments.find((e) => e.id === environmentId);
    if (!environment) return;
    const scope = `env:${environmentId}`;
    const current = this.currentValues(scope);
    const values = environment.values.map((v) =>
      v.key in current ? { ...v, value: current[v.key]! } : v,
    );
    this.apply({ type: 'setEnvironmentValues', id: environmentId, values });
    this.resetCurrentValues(scope);
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
    if (this.#conflicts.has(id)) return 'conflict';
    if (this.#unsaved.has(id)) return 'unsaved';
    const draft = this.#drafts.get(id);
    if (!draft) return 'clean';
    return draft.op === 'create' ? 'created' : draft.op === 'delete' ? 'deleted' : 'updated';
  }

  /** Entities deleted by a saved draft, as the files still have them (for the explorer). */
  deletedEntities(): Array<{
    id: string;
    name: string;
    kind: Exclude<Draft['ref']['kind'], 'project' | 'environment' | 'globals'>;
    parentId: string | null;
    method?: string;
  }> {
    const deleted = [];
    for (const draft of this.#drafts.values()) {
      if (
        draft.op !== 'delete' ||
        draft.ref.kind === 'project' ||
        draft.ref.kind === 'environment'
      ) {
        continue;
      }
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
      this.#conflicts.delete(each);
      this.#externallyChanged.delete(each);
    }
    this.#staleDrafts = this.#staleDrafts.filter((draft) => !ids.includes(draft.ref.id));
    this.#working = restoreFromBase(this.#working, this.#read.model, id);
    await this.#persistDrafts();
    this.#emit();
  }

  /**
   * Plans Save for Commit of `ids` (default: every draft) against what is on disk now
   * (file-format.md §5.1). Unsaved edits are not included: save them first.
   */
  async planCommit(ids?: readonly string[]): Promise<CommitPlan> {
    return this.#plan([...this.#drafts.values()], ids);
  }

  /**
   * Like `planCommit`, but as if the unsaved edits of `ids` (default: all) were saved first;
   * nothing is saved. For previews in Pending Changes.
   */
  async previewCommit(ids?: readonly string[]): Promise<CommitPlan> {
    const drafts = new Map(this.#drafts);
    for (const id of ids ?? this.unsavedIds()) {
      if (!this.#unsaved.has(id)) continue;
      const draft = createDraft(this.#read.model, this.#working, id, (e) => this.#baseHash(e));
      if (draft) drafts.set(id, draft);
      else drafts.delete(id);
    }
    // Unsaved parents are prerequisites too (as in `save`).
    for (const id of ids ?? []) {
      let parent = locateEntity(this.#working, id)?.parentId;
      while (parent && this.#unsaved.has(parent)) {
        const draft = createDraft(this.#read.model, this.#working, parent, (e) =>
          this.#baseHash(e),
        );
        if (draft) drafts.set(parent, draft);
        parent = locateEntity(this.#working, parent)?.parentId;
      }
    }
    return this.#plan([...drafts.values()], ids);
  }

  async #plan(drafts: Draft[], ids?: readonly string[]): Promise<CommitPlan> {
    const brokenPaths = new Set(
      this.#read.problems.filter((p) => p.severity === 'error').map((p) => p.path),
    );
    return planCommit({
      base: this.#read.model,
      drafts,
      ...(ids ? { selection: ids } : {}),
      disk: await this.scanDisk(),
      knownPaths: new Set(this.#read.files.keys()),
      brokenPaths,
      hash: sha256Hex,
    });
  }

  /** Managed project files on disk (path → sha-256) and other files below `collections/` (`null`). */
  async scanDisk(): Promise<DiskState> {
    const disk = new Map<ProjectPath, string | null>();
    const add = async (path: ProjectPath) =>
      disk.set(path, isManagedPath(path) ? await sha256Hex(await this.fs.readFile(path)) : null);
    if ((await this.fs.stat('pigeon.json'))?.kind === 'file') await add('pigeon.json');
    for (const dir of ['collections', 'environments', 'examples']) {
      if ((await this.fs.stat(dir))?.kind !== 'dir') continue;
      for (const entry of await this.fs.list(dir, { recursive: true })) {
        if (entry.kind === 'file') await add(entry.path);
      }
    }
    return disk;
  }

  /**
   * Applies a plan: writes (atomically, per file), deletes, then removes empty directories. On
   * success the committed drafts are cleared and the base re-read. On failure nothing is lost:
   * drafts stay, the base follows the disk, and the error lists what was written.
   */
  async commit(plan: CommitPlan): Promise<CommitResult> {
    if (this.readOnly) throw new Error('This project is read-only.');
    const written: ProjectPath[] = [];
    try {
      for (const write of plan.writes) {
        await this.fs.writeFileAtomic(write.path, write.bytes);
        this.#ownWrites.set(write.path, await sha256Hex(write.bytes));
        written.push(write.path);
      }
      for (const path of plan.deletes) {
        if (await this.fs.exists(path)) await this.fs.remove(path);
        this.#ownWrites.delete(path);
      }
    } catch (error) {
      await this.reload();
      throw new CommitError(
        `Save for Commit stopped after ${written.length} of ${plan.writes.length} files: ${error instanceof Error ? error.message : String(error)}`,
        written,
        { cause: error },
      );
    }
    const removedDirs: ProjectPath[] = [];
    for (const dir of plan.rmdirs) {
      try {
        await this.fs.remove(dir);
        removedDirs.push(dir);
      } catch {
        // Not empty after all (a file appeared) or already gone: keep it.
      }
    }
    for (const id of plan.entityIds) this.#drafts.delete(id);
    await this.reload();
    await this.#persistDrafts();
    return { written, deleted: [...plan.deletes], removedDirs };
  }

  /** Save (if needed) and Save for Commit of `ids` (default: everything), in one step. */
  async saveForCommit(
    ids?: readonly string[],
  ): Promise<{ plan: CommitPlan; result: CommitResult }> {
    const unsaved = (ids ?? this.unsavedIds()).filter((id) => this.#unsaved.has(id));
    if (unsaved.length > 0) await this.save(unsaved);
    const plan = await this.planCommit(ids);
    const result = await this.commit(plan);
    return { plan, result };
  }

  /** True when `path` was last written by this session with exactly `hash`. */
  isOwnWrite(path: ProjectPath, hash: string): boolean {
    return this.#ownWrites.get(path) === hash;
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

  findEnvironment(id: string): ProjectEnvironment | undefined {
    return this.getWorkingModel().environments.find((e) => e.id === id);
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

  /**
   * Re-reads the files (file-format.md §8): drafts and unsaved edits stay on top of the new
   * base; drafts whose file changed become conflicts; unsaved entities whose file changed are
   * flagged for "Reload or keep editing?".
   */
  async reload(): Promise<void> {
    const previousBase = this.#read.model;
    this.#read = await readProject(this.fs);
    const before = this.#working;
    this.#loadDrafts([...this.#drafts.values(), ...this.#staleDrafts]);
    let working = this.#working;
    for (const id of [...this.#unsaved]) {
      const edited = findItem(before, id);
      if (!edited || !findItem(working, id)) {
        this.#unsaved.delete(id);
        this.#externallyChanged.delete(id);
        continue;
      }
      working = replaceItem(working, id, (item) => keepChildren(edited, item));
      const oldFile = locateEntity(previousBase, id)?.entity;
      const newFile = locateEntity(this.#read.model, id)?.entity;
      if (JSON.stringify(withoutChildren(oldFile)) !== JSON.stringify(withoutChildren(newFile))) {
        this.#externallyChanged.add(id);
      }
    }
    this.#working = working;
    this.#detectConflicts();
    this.#emit();
  }

  get conflicts(): readonly Conflict[] {
    return [...this.#conflicts.values()];
  }

  conflictOf(id: string): Conflict | undefined {
    return this.#conflicts.get(id);
  }

  /**
   * Resolves a conflict: `mine` keeps the draft and rebases it on the new file (a draft on a
   * file deleted on disk becomes a create), `theirs` drops the draft (the file wins).
   */
  async resolveConflict(id: string, choice: 'mine' | 'theirs'): Promise<void> {
    const conflict = this.#conflicts.get(id);
    if (!conflict) return;
    if (choice === 'theirs') {
      this.#conflicts.delete(id);
      await this.discard(id);
      return;
    }
    const draft = this.#drafts.get(id) ?? this.#staleDrafts.find((d) => d.ref.id === id);
    if (!draft) return;
    const rebased: Draft =
      conflict.reason === 'deleted-on-disk'
        ? { ...draft, op: draft.op === 'delete' ? 'delete' : 'create', baseHash: null }
        : { ...draft, baseHash: this.#baseHash(id) };
    this.#staleDrafts = this.#staleDrafts.filter((d) => d.ref.id !== id);
    this.#drafts.set(id, rebased);
    const before = this.#working;
    this.#loadDrafts([...this.#drafts.values(), ...this.#staleDrafts]);
    this.#working = reapplyUnsaved(this.#working, before, this.#unsaved);
    this.#detectConflicts();
    await this.#persistDrafts();
    this.#emit();
  }

  /** File text on disk vs what the draft would write, for "Compare" (empty when missing). */
  async conflictTexts(
    id: string,
  ): Promise<{ theirs: string; mine: string; path: ProjectPath | undefined }> {
    const conflict = this.#conflicts.get(id);
    const draft = this.#drafts.get(id) ?? this.#staleDrafts.find((d) => d.ref.id === id);
    const mineModel = draft
      ? applyDrafts(this.#read.model, [
          conflict?.reason === 'deleted-on-disk' ? { ...draft, op: 'create' } : draft,
        ]).model
      : this.#read.model;
    const minePath = filePathIn(mineModel, id);
    const bytes = minePath ? serializeProject(mineModel).get(minePath) : undefined;
    const path = conflict?.path ?? minePath;
    const theirs = path && (await this.fs.exists(path)) ? await this.fs.readText(path) : '';
    return { theirs, mine: bytes ? new TextDecoder().decode(bytes) : '', path };
  }

  /** Unsaved entities whose file changed on disk since they were edited. */
  externallyChanged(): string[] {
    return [...this.#externallyChanged];
  }

  /** "Keep editing": the unsaved edits stay; the notice goes away. */
  keepEditing(id: string): void {
    if (this.#externallyChanged.delete(id)) this.#emit();
  }

  /** "Reload": drops the unsaved edits of `id` in favour of the new file (or its draft). */
  reloadEntity(id: string): void {
    this.#externallyChanged.delete(id);
    this.discardUnsaved(id);
    this.#emit();
  }

  /**
   * Compares managed files on disk with what was read (hashes; watcher events are only hints)
   * and reloads when they differ. Returns whether anything changed.
   */
  async checkForChanges(): Promise<boolean> {
    const disk = await this.scanDisk();
    const known = this.#read.files;
    let changed = false;
    for (const [path, hash] of disk) {
      if (hash !== null && known.get(path)?.hash !== hash) changed = true;
    }
    for (const path of known.keys()) if (!disk.has(path) && isManagedPath(path)) changed = true;
    if (changed) await this.reload();
    return changed;
  }

  /**
   * Watches the project folder when the filesystem can (`capabilities.fileWatch`): events are
   * coalesced for `WATCH_DEBOUNCE_MS` (a branch switch produces hundreds), then verified by
   * hash. Returns `null` when watching isn't available.
   */
  watch(onError?: (error: unknown) => void): Unsubscribe | null {
    if (!this.fs.watch) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running: Promise<unknown> = Promise.resolve();
    const unsubscribe = this.fs.watch((events) => {
      if (
        !events.some(
          (event) =>
            event.path === 'pigeon.json' ||
            /^(collections|environments|examples)(\/|$)/.test(event.path),
        )
      )
        return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        running = running
          .then(() => this.checkForChanges())
          .catch((error: unknown) => onError?.(error));
      }, WATCH_DEBOUNCE_MS);
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
  }

  #detectConflicts(): void {
    this.#conflicts.clear();
    const base = this.#read.model;
    for (const draft of [...this.#drafts.values(), ...this.#staleDrafts]) {
      if (draft.op === 'create' || !draft.baseHash) continue;
      const environment = base.environments.find((e) => e.id === draft.ref.id);
      const found =
        locateEntity(base, draft.ref.id) ?? (environment ? { entity: environment } : undefined);
      const name =
        found?.entity.name ??
        (typeof draft.data?.['name'] === 'string' ? draft.data['name'] : draft.ref.id);
      if (!found) {
        if (draft.op === 'update') {
          this.#conflicts.set(draft.ref.id, {
            entityId: draft.ref.id,
            kind: draft.ref.kind,
            name,
            reason: 'deleted-on-disk',
            path: undefined,
          });
        }
        continue;
      }
      const path = filePathIn(base, draft.ref.id);
      const hash = path ? this.#read.files.get(path)?.hash : undefined;
      if (hash !== draft.baseHash) {
        this.#conflicts.set(draft.ref.id, {
          entityId: draft.ref.id,
          kind: draft.ref.kind,
          name,
          reason: 'changed-on-disk',
          path,
        });
      }
    }
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
  if (id === PROJECT_ENTITY_ID) return { ...working, id: base.id, name: base.name };
  if (id === GLOBALS_ENTITY_ID) {
    const { globals: _globals, ...rest } = working;
    return base.globals ? { ...rest, globals: base.globals } : rest;
  }
  const baseEnvironment = base.environments.find((e) => e.id === id);
  if (baseEnvironment || working.environments.some((e) => e.id === id)) {
    const others = working.environments.filter((e) => e.id !== id);
    const environments = baseEnvironment ? [...others, baseEnvironment] : others;
    return {
      ...working,
      environments: environments.sort((a, b) =>
        a.fileKey < b.fileKey ? -1 : a.fileKey > b.fileKey ? 1 : 0,
      ),
    };
  }
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
  if (id === PROJECT_ENTITY_ID) return 'pigeon.json';
  if (id === GLOBALS_ENTITY_ID)
    return model.globals ? 'environments/globals.postman_globals.json' : undefined;
  const environment = model.environments.find((e) => e.id === id);
  if (environment) return `environments/${environment.fileKey}.postman_environment.json`;
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

function withoutChildren(entity: Collection | ProjectItem | undefined): unknown {
  if (!entity || entity.kind === 'request') return entity;
  const { children: _children, ...rest } = entity;
  return rest;
}

/** `model` with the unsaved edits of `ids` (taken from `edited`) re-applied. */
function reapplyUnsaved(
  model: ProjectModel,
  edited: ProjectModel,
  ids: ReadonlySet<string>,
): ProjectModel {
  let working = model;
  for (const id of ids) {
    const item = findItem(edited, id);
    if (item && findItem(working, id))
      working = replaceItem(working, id, (current) => keepChildren(item, current));
  }
  return working;
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
