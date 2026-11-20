/** `window.__pigeonTest`, installed by apps/web/src/test-hooks.ts in E2E builds. */
declare global {
  interface Window {
    __pigeonTest?: {
      preloadProject(files: Record<string, string>): Promise<void>;
    };
  }
}

export {};
