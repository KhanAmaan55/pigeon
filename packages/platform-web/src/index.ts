import type { Capabilities, OperatingSystem, Platform, Transport } from '@pigeon/platform';
import { createMemoryServices, defineCapabilities } from '@pigeon/platform';

/**
 * Browser capabilities (docs/platform.md §4) by feature detection, never by user agent.
 * `env` is `window` in the app; tests pass a plain object.
 */
export function detectWebCapabilities(env: object = globalThis): Readonly<Capabilities> {
  const projectFolders = 'showDirectoryPicker' in env ? 'fs-access' : 'none';
  return defineCapabilities({
    transport: 'fetch',
    bypassesCors: false,
    canSetAnyHeader: false,
    canReadAllResponseHeaders: false,
    canControlRedirects: false,
    canDisableTlsVerification: false,
    canSendBodyWithGet: false,
    detailedTimings: false,
    projectFolders,
    browserWorkspace: 'indexedDB' in env,
    fileWatch: false,
    // Chromium re-prompts per session unless the browser grants persistent permission.
    persistentFolderAccess: false,
    // Only files inside an opened fs-access project folder; elsewhere files must be re-picked.
    fileReferencesByPath: projectFolders === 'fs-access',
    secretStorage: 'indexeddb',
    multiWindow: true, // browser tabs
    offline: false, // the app must be loaded from the network first
  });
}

/** OS for display and shortcut labels (`Cmd` vs `Ctrl`); never used to infer capabilities. */
export function detectWebOs(nav: {
  platform?: string;
  userAgentData?: { platform?: string };
}): OperatingSystem {
  const name = nav.userAgentData?.platform || nav.platform || '';
  if (/^mac/i.test(name)) return 'macos';
  if (/^win/i.test(name)) return 'windows';
  if (/linux/i.test(name) && !/android/i.test(name)) return 'linux';
  return 'unknown';
}

const pendingTransport: Transport = {
  send: () => Promise.reject(new Error('Sending requests arrives with PIGN-006 (FetchTransport).')),
};

/** Real capabilities; fs, state, secrets and dialogs stay memory-backed until their stories land. */
export function createWebPlatform(): Platform {
  return {
    kind: 'web',
    os: detectWebOs(navigator as Navigator & { userAgentData?: { platform?: string } }),
    capabilities: detectWebCapabilities(window),
    transport: pendingTransport,
    ...createMemoryServices(),
  };
}
