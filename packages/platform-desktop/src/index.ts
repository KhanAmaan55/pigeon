import type { Capabilities, OperatingSystem, Platform } from '@pigeon/platform';
import { createMemoryServices, defineCapabilities } from '@pigeon/platform';
// Temporary: the webview's fetch until the native transport lands (PIGN-007).
import { FetchTransport } from '@pigeon/platform-web';
import { platform as osPlatform } from '@tauri-apps/plugin-os';

/** Desktop capabilities are the same on macOS, Windows and Linux (docs/platform.md §4). */
export const DESKTOP_CAPABILITIES: Readonly<Capabilities> = defineCapabilities({
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
  secretStorage: 'local-state', // os-keychain with PIGN-053
  multiWindow: false, // later
  offline: true,
});

/** Maps `@tauri-apps/plugin-os` platform names to Pigeon's. */
export function toOperatingSystem(name: string): OperatingSystem {
  switch (name) {
    case 'macos':
      return 'macos';
    case 'windows':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

/** Reads the OS injected by the Rust `tauri-plugin-os` (synchronous, no IPC). */
export function detectDesktopOs(): OperatingSystem {
  return toOperatingSystem(osPlatform());
}

/**
 * Real capabilities; fs, state, secrets and dialogs stay memory-backed until their stories land.
 * Requests go through the webview's `fetch` (so CORS applies) until PIGN-007.
 */
export function createDesktopPlatform(os: OperatingSystem = detectDesktopOs()): Platform {
  return {
    kind: 'desktop',
    os,
    capabilities: DESKTOP_CAPABILITIES,
    transport: new FetchTransport(),
    ...createMemoryServices(),
  };
}
