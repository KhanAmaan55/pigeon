/** `window.__pigeonTest`, installed by apps/web/src/test-hooks.ts in E2E builds. */
declare global {
  interface Window {
    __pigeonTest?: {
      openHandle(handle: FileSystemDirectoryHandle): void;
      preloadProject(files: Record<string, string>, folderName?: string): Promise<void>;
      simulatePermissionPromptAfterReload(): void;
      runFsConformance(): Promise<Array<{ name: string; error: string }>>;
    };
  }
}

export {};
