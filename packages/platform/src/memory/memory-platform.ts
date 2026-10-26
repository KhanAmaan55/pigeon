import type { Capabilities } from '../capabilities';
import { defineCapabilities } from '../capabilities';
import type { ProjectFileSystem, ProjectLocation } from '../fs';
import { FsError } from '../fs';
import type { OperatingSystem, Platform } from '../platform';
import type { ProjectLocator } from '../projects';
import type { Transport } from '../transport';
import { MemoryFs } from './memory-fs';
import {
  MemoryAppState,
  MemoryDialogs,
  MemoryFileExchange,
  MemorySecretStore,
} from './memory-stores';
import { MockTransport } from './mock-transport';

/** Projects are `MemoryFs` instances keyed by `{ kind: 'memory', id }` locations. */
export class MemoryProjectLocator implements ProjectLocator {
  /** What `pickProjectFolder` returns next (default: cancelled). */
  pickResult: ProjectLocation | null = null;
  readonly #projects = new Map<string, MemoryFs>();

  async pickProjectFolder(): Promise<ProjectLocation | null> {
    return this.pickResult;
  }

  async createProject(_name: string): Promise<ProjectLocation> {
    const id = crypto.randomUUID();
    const fs = new MemoryFs({ id });
    this.#projects.set(id, fs);
    return fs.root;
  }

  async reopen(loc: ProjectLocation): Promise<'ok' | 'missing'> {
    return loc.kind === 'memory' && this.#projects.has(loc.id) ? 'ok' : 'missing';
  }

  async open(loc: ProjectLocation): Promise<ProjectFileSystem> {
    const fs = loc.kind === 'memory' ? this.#projects.get(loc.id) : undefined;
    if (!fs) throw new FsError('not-found', '', `No memory project for ${JSON.stringify(loc)}`);
    return fs;
  }
}

/** The platform services that stay memory-backed until their real implementations land. */
export interface MemoryServices {
  readonly projects: MemoryProjectLocator;
  openProjectFs(loc: ProjectLocation): Promise<ProjectFileSystem>;
  readonly appState: MemoryAppState;
  readonly secrets: MemorySecretStore;
  readonly dialogs: MemoryDialogs;
  readonly files: MemoryFileExchange;
}

export function createMemoryServices(): MemoryServices {
  const projects = new MemoryProjectLocator();
  return {
    projects,
    openProjectFs: (loc) => projects.open(loc),
    appState: new MemoryAppState(),
    secrets: new MemorySecretStore(),
    dialogs: new MemoryDialogs(),
    files: new MemoryFileExchange(),
  };
}

/** Desktop-like defaults; tests override what they exercise. */
export const MEMORY_CAPABILITIES: Readonly<Capabilities> = defineCapabilities({
  transport: 'native',
  bypassesCors: true,
  canSetAnyHeader: true,
  canReadAllResponseHeaders: true,
  canControlRedirects: true,
  canDisableTlsVerification: true,
  canSendBodyWithGet: true,
  detailedTimings: true,
  projectFolders: 'native',
  browserWorkspace: false,
  fileWatch: true,
  persistentFolderAccess: true,
  fileReferencesByPath: true,
  secretStorage: 'memory',
  multiWindow: false,
  offline: true,
});

/** A `Platform` whose services expose their memory implementations for tests to program. */
export type MemoryPlatform = Omit<Platform, keyof MemoryServices | 'kind'> &
  MemoryServices & { readonly kind: 'memory' };

export function createMemoryPlatform(
  opts: { capabilities?: Partial<Capabilities>; os?: OperatingSystem; transport?: Transport } = {},
): MemoryPlatform {
  return {
    kind: 'memory',
    os: opts.os ?? 'unknown',
    capabilities: defineCapabilities({ ...MEMORY_CAPABILITIES, ...opts.capabilities }),
    transport: opts.transport ?? new MockTransport(),
    ...createMemoryServices(),
  };
}
