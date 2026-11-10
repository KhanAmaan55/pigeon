import type { OperatingSystem, Platform } from '@pigeon/platform';
import { createMemoryServices } from '@pigeon/platform';
import { platform as osPlatform } from '@tauri-apps/plugin-os';

import { DESKTOP_CAPABILITIES } from './capabilities';
import { NativeTransport } from './native-transport';

export { DESKTOP_CAPABILITIES } from './capabilities';
export type { Invoke, NativeTransportOptions } from './native-transport';
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
 * Real capabilities and the native transport; fs, state, secrets and dialogs stay memory-backed
 * until their stories land.
 */
export function createDesktopPlatform(os: OperatingSystem = detectDesktopOs()): Platform {
  return {
    kind: 'desktop',
    os,
    capabilities: DESKTOP_CAPABILITIES,
    transport: new NativeTransport(),
    ...createMemoryServices(),
  };
}
