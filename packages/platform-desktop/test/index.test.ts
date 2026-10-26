import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'linux' }));

import { createDesktopPlatform, DESKTOP_CAPABILITIES, toOperatingSystem } from '../src/index';

describe('createDesktopPlatform', () => {
  it('reports desktop capabilities and the OS from plugin-os', () => {
    const platform = createDesktopPlatform();
    expect(platform.kind).toBe('desktop');
    expect(platform.os).toBe('linux');
    expect(platform.capabilities).toBe(DESKTOP_CAPABILITIES);
    expect(platform.capabilities).toMatchObject({
      transport: 'native',
      bypassesCors: true,
      projectFolders: 'native',
      fileWatch: true,
    });
    expect(Object.isFrozen(platform.capabilities)).toBe(true);
  });

  it('has no transport until PIGN-007', async () => {
    const send = createDesktopPlatform('macos').transport.send({} as never, {
      signal: new AbortController().signal,
    });
    await expect(send).rejects.toThrow('PIGN-007');
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
