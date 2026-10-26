import { describe, expect, it } from 'vitest';

import { detectWebCapabilities, detectWebOs } from '../src/index';

describe('detectWebCapabilities', () => {
  it('offers project folders when the File System Access API exists (Chromium)', () => {
    const capabilities = detectWebCapabilities({ showDirectoryPicker() {}, indexedDB: {} });
    expect(capabilities).toMatchObject({
      transport: 'fetch',
      bypassesCors: false,
      projectFolders: 'fs-access',
      browserWorkspace: true,
      fileReferencesByPath: true,
      fileWatch: false,
      secretStorage: 'indexeddb',
    });
  });

  it('falls back to no project folders elsewhere (Firefox, Safari)', () => {
    const capabilities = detectWebCapabilities({ indexedDB: {} });
    expect(capabilities.projectFolders).toBe('none');
    expect(capabilities.fileReferencesByPath).toBe(false);
    expect(capabilities.browserWorkspace).toBe(true);
  });

  it('reports no browser workspace without IndexedDB', () => {
    expect(detectWebCapabilities({}).browserWorkspace).toBe(false);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(detectWebCapabilities({}))).toBe(true);
  });
});

describe('detectWebOs', () => {
  it.each([
    [{ userAgentData: { platform: 'macOS' } }, 'macos'],
    [{ platform: 'MacIntel' }, 'macos'],
    [{ userAgentData: { platform: 'Windows' } }, 'windows'],
    [{ platform: 'Win32' }, 'windows'],
    [{ platform: 'Linux x86_64' }, 'linux'],
    [{ userAgentData: { platform: 'Android' }, platform: 'Linux armv8l' }, 'unknown'],
    [{ platform: 'iPhone' }, 'unknown'],
    [{}, 'unknown'],
  ])('%j → %s', (nav, os) => {
    expect(detectWebOs(nav)).toBe(os);
  });
});
