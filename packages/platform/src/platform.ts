import type { AppStateStore } from './app-state';
import type { Capabilities } from './capabilities';
import type { Dialogs } from './dialogs';
import type { FileExchange } from './files';
import type { ProjectFileSystem, ProjectLocation } from './fs';
import type { ProjectLocator } from './projects';
import type { SecretStore } from './secrets';
import type { Transport } from './transport';

export type PlatformKind = 'desktop' | 'web' | 'node' | 'memory';
export type OperatingSystem = 'macos' | 'windows' | 'linux' | 'unknown';

/** Everything platform-specific the UI and core need, created once at startup (architecture.md §4). */
export interface Platform {
  /** For diagnostics and logs only: features branch on `capabilities`. */
  readonly kind: PlatformKind;
  readonly os: OperatingSystem;
  readonly capabilities: Readonly<Capabilities>;
  readonly projects: ProjectLocator;
  openProjectFs(loc: ProjectLocation): Promise<ProjectFileSystem>;
  readonly transport: Transport;
  readonly appState: AppStateStore;
  readonly secrets: SecretStore;
  readonly dialogs: Dialogs;
  readonly files: FileExchange;
}
