import type { OperatingSystem, Platform } from '@pigeon/platform';
import { createMemoryServices, PickedFileStore } from '@pigeon/platform';
import { platform as osPlatform } from '@tauri-apps/plugin-os';

import { DESKTOP_CAPABILITIES } from './capabilities';
import { DesktopFileExchange } from './files';
import { NativeTransport } from './native-transport';

export { DESKTOP_CAPABILITIES } from './capabilities';
export { DesktopFileExchange, encodeSaveFrame } from './files';
export type { Invoke, NativeTransportOptions, WireBody, WireFileRef } from './native-transport';
export { decodeResponseFrame, encodeRequestFrame, NativeTransport } from './native-transport';

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
 * Real capabilities, native transport and file exchange; fs, state, secrets and dialogs stay
 * memory-backed until their stories land.
 */
export function createDesktopPlatform(os: OperatingSystem = detectDesktopOs()): Platform {
  const pickedFiles = new PickedFileStore();
  return {
    kind: 'desktop',
    os,
    capabilities: DESKTOP_CAPABILITIES,
    transport: new NativeTransport({ pickedFiles }),
    pickedFiles,
    ...createMemoryServices(),
    files: new DesktopFileExchange(),
  };
}
