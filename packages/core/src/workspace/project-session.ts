/**
 * One open project (docs/architecture.md §3.2). PIGN-014 covers the read side: load the files,
 * expose the working model (= base model until drafts arrive in PIGN-018) and notify listeners.
 * The UI subscribes through `createProjectStore(session)`; nothing here knows about React.
 */

import type { ProjectReadResult } from '@pigeon/formats';
import { createEmptyProject, readProject } from '@pigeon/formats';
import type { Platform, ProjectFileSystem, ProjectLocation, ProjectPath } from '@pigeon/platform';

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

export class ProjectSession {
  readonly location: ProjectLocation;
  readonly fs: ProjectFileSystem;
  #read: ProjectReadResult;
  readonly #listeners = new Set<() => void>();

  private constructor(location: ProjectLocation, fs: ProjectFileSystem, read: ProjectReadResult) {
    this.location = location;
    this.fs = fs;
    this.#read = read;
  }

  /** Opens and reads a project. Rejects only when the folder can't be opened at all. */
  static async open(
    location: ProjectLocation,
    platform: Pick<Platform, 'openProjectFs'>,
  ): Promise<ProjectSession> {
    const fs = await platform.openProjectFs(location);
    return ProjectSession.fromFs(fs);
  }

  static async fromFs(fs: ProjectFileSystem): Promise<ProjectSession> {
    return new ProjectSession(fs.root, fs, await readProject(fs));
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

  /** What the UI shows: base + drafts (no drafts until PIGN-018). */
  getWorkingModel(): ProjectModel {
    return this.#read.model;
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

  /** The file path of an item (`folder.json` for folders). */
  itemFilePath(id: string): ProjectPath | undefined {
    const found = this.locate(id);
    if (!found) return undefined;
    return found.item.kind === 'request'
      ? `${found.directory}/${found.item.fileKey}.request.json`
      : `${found.directory}/${found.item.fileKey}/folder.json`;
  }

  /** Re-reads every file (manual refresh; the watcher arrives in PIGN-020). */
  async reload(): Promise<void> {
    this.#read = await readProject(this.fs);
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
