interface ImportMetaEnv {
  /** `'true'` in E2E builds (`vite build --mode e2e`, apps/web/.env.e2e) only. */
  readonly VITE_PIGEON_TEST_HOOKS?: string;
  /** Where to get the desktop app (build-time `PIGEON_DESKTOP_URL`); `''` hides the link. */
  readonly PIGEON_DESKTOP_URL: string;
}
