import type { OperatingSystem, Platform } from '@pigeon/platform';
import { createMemoryServices, PickedFileStore } from '@pigeon/platform';
import { platform as osPlatform } from '@tauri-apps/plugin-os';

import { FileAppState } from './app-state';
import { DESKTOP_CAPABILITIES } from './capabilities';
import { DesktopFileExchange } from './files';
import { NativeTransport } from './native-transport';
import { DesktopProjectLocator } from './project-locator';
import { FileSecretStore } from './secrets';

export { FileAppState } from './app-state';
export { DESKTOP_CAPABILITIES } from './capabilities';
export { DesktopFileExchange, encodeSaveFrame } from './files';
export type { Invoke, NativeTransportOptions, WireBody, WireFileRef } from './native-transport';
export { decodeResponseFrame, encodeRequestFrame, NativeTransport } from './native-transport';
export { fromNativePath, isWindowsPath, nativeBaseName, toNativePath } from './paths';
export { DesktopProjectLocator } from './project-locator';
export { FileSecretStore } from './secrets';
export type { Listen } from './tauri-fs';
export { encodeWriteFrame, TauriFs, toFsError } from './tauri-fs';

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
 * Real capabilities, transport, project folders, app state, secrets and file exchange; dialogs stay
 * memory-backed until their story lands.
 */
export function createDesktopPlatform(os: OperatingSystem = detectDesktopOs()): Platform {
  const pickedFiles = new PickedFileStore();
  const projects = new DesktopProjectLocator();
  return {
    kind: 'desktop',
    os,
    capabilities: DESKTOP_CAPABILITIES,
    transport: new NativeTransport({ pickedFiles }),
    pickedFiles,
    ...createMemoryServices(),
    projects,
    openProjectFs: async (loc) => projects.open(loc),
    appState: new FileAppState(),
    secrets: new FileSecretStore(),
    files: new DesktopFileExchange(),
  };
}
