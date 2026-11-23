import type { AppStateStore } from './app-state';
import type { Capabilities } from './capabilities';
import type { Dialogs } from './dialogs';
import type { CorsProxyControl } from './cors-proxy';
import type { FileExchange } from './files';
import type { HistoryStore } from './history';
import type { OAuthBrowser } from './oauth';
import type { ProjectFileSystem, ProjectLocation } from './fs';
import type { ProjectLocator } from './projects';
import type { PickedFileStore } from './picked-files';
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
  /** Files picked this session for request bodies; the transport reads `picked` refs from it. */
  readonly pickedFiles: PickedFileStore;
  readonly appState: AppStateStore;
  readonly secrets: SecretStore;
  /** Local request history (PIGN-051); outside project folders. */
  readonly history: HistoryStore;
  readonly dialogs: Dialogs;
  readonly files: FileExchange;
  /** OAuth 2.0 authorization-code browser step (PIGN-047); absent where it can't run. */
  readonly oauth?: OAuthBrowser;
  /**
   * Web only (PIGN-052): route requests through a self-hosted CORS proxy. While it is on,
   * `transport` sends through it and `capabilities` report proxy mode.
   */
  readonly corsProxy?: CorsProxyControl;
}
