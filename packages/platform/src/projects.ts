import type { ProjectLocation } from './fs';

/** Finds project locations: pick, create, reopen. Opening the files is `Platform.openProjectFs`. */
export interface ProjectLocator {
  /** `null` when the user cancels. */
  pickProjectFolder(): Promise<ProjectLocation | null>;
  /** Desktop: folder picker; web: fs-access folder or browser workspace. `null` when cancelled. */
  createProject(name: string): Promise<ProjectLocation | null>;
  reopen(loc: ProjectLocation): Promise<'ok' | 'needs-permission' | 'missing'>;
  /** Web fs-access only; must run inside a user gesture. */
  requestPermission?(loc: ProjectLocation): Promise<boolean>;
  /** Web only (`capabilities.browserWorkspace`): a new, empty IndexedDB-backed project. */
  createBrowserWorkspace?(name: string): Promise<ProjectLocation>;
  /** Web only: whether the browser agreed to keep Pigeon's storage; `undefined` until asked. */
  storagePersisted?(): boolean | undefined;
}
