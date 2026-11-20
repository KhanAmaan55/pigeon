/**
 * E2E-only hooks (docs/testing.md §3.9), compiled in only by `vite build --mode e2e`
 * (`VITE_PIGEON_TEST_HOOKS`). Never part of the production bundle.
 *
 * The native folder picker and permission prompts can't be automated, so tests inject Origin
 * Private File System (OPFS) handles, which have the same type as picked folders.
 */

import type { Platform } from '@pigeon/platform';
import { fsConformanceCases } from '@pigeon/platform/conformance/fs-cases';
import { FsAccessFs, WebProjectLocator } from '@pigeon/platform-web';

/** Survives a reload: the next app start sees folder permissions as "prompt". */
const PERMISSION_KEY = 'pigeon-test:permission-prompt';

export interface PigeonTestHooks {
  /** Makes the next "Open folder" (or "Create project") pick `handle`. */
  openHandle(handle: FileSystemDirectoryHandle): void;
  /** Writes `files` into a fresh OPFS folder and makes the next "Open folder" pick it. */
  preloadProject(files: Record<string, string>, folderName?: string): Promise<void>;
  /** After the next reload, stored folders need permission again (Reconnect). */
  simulatePermissionPromptAfterReload(): void;
  /** Runs `fsConformanceCases()` against `FsAccessFs` on OPFS; returns failures. */
  runFsConformance(): Promise<Array<{ name: string; error: string }>>;
}

declare global {
  interface Window {
    __pigeonTest?: PigeonTestHooks;
  }
}

async function freshOpfsFolder(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(name, { recursive: true }).catch(() => undefined);
  return root.getDirectoryHandle(name, { create: true });
}

export function installTestHooks(platform: Platform): void {
  const locator = platform.projects;
  if (!(locator instanceof WebProjectLocator))
    throw new Error('test hooks need the web project locator');
  if (sessionStorage.getItem(PERMISSION_KEY) === 'prompt') {
    sessionStorage.removeItem(PERMISSION_KEY);
    locator.permissionOverride = 'prompt';
  }

  window.__pigeonTest = {
    openHandle(handle) {
      locator.nextPickedHandle = handle;
    },
    async preloadProject(files, folderName = 'fixture-project') {
      const folder = await freshOpfsFolder(folderName);
      const fs = new FsAccessFs(folder, {
        kind: 'fs-access',
        handleKey: 'preload',
        name: folderName,
      });
      for (const [path, text] of Object.entries(files)) await fs.writeFileAtomic(path, text);
      locator.nextPickedHandle = folder;
    },
    simulatePermissionPromptAfterReload() {
      sessionStorage.setItem(PERMISSION_KEY, 'prompt');
    },
    async runFsConformance() {
      const failures: Array<{ name: string; error: string }> = [];
      for (const [index, testCase] of fsConformanceCases().entries()) {
        const folder = await freshOpfsFolder(`conformance-${index}`);
        try {
          await testCase.run(
            new FsAccessFs(folder, { kind: 'fs-access', handleKey: 'c', name: 'c' }),
          );
        } catch (error) {
          failures.push({
            name: testCase.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(`conformance-${index}`, { recursive: true }).catch(() => undefined);
      }
      return failures;
    },
  };
}
