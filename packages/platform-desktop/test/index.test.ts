import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'linux' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import {
  createDesktopPlatform,
  DESKTOP_CAPABILITIES,
  NativeTransport,
  toOperatingSystem,
} from '../src/index';

describe('createDesktopPlatform', () => {
  it('reports desktop capabilities and the OS from plugin-os', () => {
    const platform = createDesktopPlatform();
    expect(platform.kind).toBe('desktop');
    expect(platform.os).toBe('linux');
    expect(platform.capabilities).toBe(DESKTOP_CAPABILITIES);
    expect(platform.capabilities).toMatchObject({
      transport: 'native',
      bypassesCors: true,
      canSetAnyHeader: true,
      canReadAllResponseHeaders: true,
      canControlRedirects: true,
      canDisableTlsVerification: true,
      canSendBodyWithGet: true,
      detailedTimings: true,
      projectFolders: 'native',
      fileWatch: true,
    });
    expect(Object.isFrozen(platform.capabilities)).toBe(true);
  });

  it('sends through the native Rust transport', () => {
    expect(createDesktopPlatform('macos').transport).toBeInstanceOf(NativeTransport);
  });
});

describe('toOperatingSystem', () => {
  it.each([
    ['macos', 'macos'],
    ['windows', 'windows'],
    ['linux', 'linux'],
    ['ios', 'unknown'],
    ['freebsd', 'unknown'],
  ])('%s → %s', (name, os) => {
    expect(toOperatingSystem(name)).toBe(os);
  });
});
