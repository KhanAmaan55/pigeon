import type { Capabilities, OperatingSystem, Platform, Transport } from '@pigeon/platform';
import { createMemoryServices, defineCapabilities, PickedFileStore } from '@pigeon/platform';

import { FetchTransport } from './fetch-transport';
import { WebFileExchange } from './files';
import { openPigeonDb } from './idb';
import { IdbAppState } from './idb-app-state';
import { WebProjectLocator } from './project-locator';
import { IdbHistoryStore } from './history-store';
import { ProxyTransport, WebCorsProxy } from './proxy-transport';
import { IdbSecretStore } from './secrets';
import { createWebOAuth } from './oauth';

export type { FetchTransportOptions } from './fetch-transport';
export { FetchTransport } from './fetch-transport';
export type { FileEnvironment } from './files';
export { WebFileExchange } from './files';
export { FsAccessFs } from './fs-access-fs';
export { DB_NAME, openPigeonDb } from './idb';
export { IdbAppState } from './idb-app-state';
export { IdbHistoryStore } from './history-store';
export type { ProxyTransportOptions } from './proxy-transport';
export { checkProxy, fromBase64, ProxyTransport, toBase64, WebCorsProxy } from './proxy-transport';
export type { WorkspaceRecord } from './idb-fs';
export { deleteWorkspace, IdbFs } from './idb-fs';
export type { HandleRecord, HandleStore, WebProjectLocatorOptions } from './project-locator';
export { WebProjectLocator } from './project-locator';
export { IdbSecretStore } from './secrets';
/** Re-exported for existing callers; the list lives in `@pigeon/platform`. */
export { isForbiddenHeader } from '@pigeon/platform';

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

/**
 * Capabilities while requests go through a self-hosted CORS proxy (PIGN-052): the proxy sends
 * natively, so CORS, forbidden headers, hidden response headers, redirects and TLS settings no
 * longer limit the browser. Timings are the proxy's total only.
 */
export function proxyModeCapabilities(web: Readonly<Capabilities>): Readonly<Capabilities> {
  return defineCapabilities({
    ...web,
    transport: 'proxy',
    bypassesCors: true,
    canSetAnyHeader: true,
    canReadAllResponseHeaders: true,
    canControlRedirects: true,
    canDisableTlsVerification: true,
    canSendBodyWithGet: true,
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

/**
 * Real capabilities, transport, project folders / browser workspaces, app state (IndexedDB) and
 * file exchange; secrets and dialogs stay memory-backed until their stories land. Without
 * IndexedDB (rare: some private modes) everything local stays in memory.
 */
export function createWebPlatform(): Platform {
  const pickedFiles = new PickedFileStore();
  const memory = createMemoryServices();
  // Proxy mode (PIGN-052): the transport and capabilities follow the active project's setting.
  const corsProxy = new WebCorsProxy();
  const fetchTransport = new FetchTransport({ pickedFiles });
  const proxyTransport = new ProxyTransport({ config: () => corsProxy.config, pickedFiles });
  const transport: Transport = {
    send: (req, opts) => (corsProxy.config ? proxyTransport : fetchTransport).send(req, opts),
  };
  const webCapabilities = detectWebCapabilities(window);
  const proxyCapabilities = proxyModeCapabilities(webCapabilities);
  const base = {
    kind: 'web' as const,
    os: detectWebOs(navigator as Navigator & { userAgentData?: { platform?: string } }),
    capabilities: webCapabilities,
    transport,
    pickedFiles,
    ...memory,
    files: new WebFileExchange(),
    oauth: createWebOAuth(),
    corsProxy,
  };
  const dynamic = (platform: Platform): Platform =>
    Object.defineProperty(platform, 'capabilities', {
      get: () => (corsProxy.config ? proxyCapabilities : webCapabilities),
      enumerable: true,
    });
  if (!('indexedDB' in window)) return dynamic(base);

  let db: Promise<IDBDatabase> | undefined;
  const getDb = () => (db ??= openPigeonDb());
  const win = window as Window & {
    showDirectoryPicker?: (opts?: {
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
  };
  const projects = new WebProjectLocator({
    db: getDb,
    ...(win.showDirectoryPicker
      ? { pickDirectory: () => win.showDirectoryPicker!({ mode: 'readwrite' }) }
      : {}),
    ...(navigator.storage?.persist ? { persistStorage: () => navigator.storage.persist() } : {}),
  });
  return dynamic({
    ...base,
    projects,
    openProjectFs: (loc) => projects.open(loc),
    appState: new IdbAppState(getDb),
    secrets: new IdbSecretStore(getDb),
    history: new IdbHistoryStore(getDb),
  });
}
export { callbackUrl, createWebOAuth } from './oauth';
