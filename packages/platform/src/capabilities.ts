import type { SecretBackend } from './secrets';

/**
 * What the current platform can do (docs/platform.md §3–4). The UI branches on these values,
 * never on `Platform.kind`.
 */
export interface Capabilities {
  transport: 'native' | 'fetch' | 'node';
  bypassesCors: boolean;
  /** False in browsers (forbidden headers). */
  canSetAnyHeader: boolean;
  /** False in browsers (Set-Cookie, non-exposed headers). */
  canReadAllResponseHeaders: boolean;
  /** Observe each hop / stop at 3xx. */
  canControlRedirects: boolean;
  canDisableTlsVerification: boolean;
  /** fetch throws for GET/HEAD with a body. */
  canSendBodyWithGet: boolean;
  /** Total + TTFB (true) or total only (false). */
  detailedTimings: boolean;
  /** Can open a real folder. */
  projectFolders: 'native' | 'fs-access' | 'none';
  browserWorkspace: boolean;
  fileWatch: boolean;
  /** Reopen a folder without re-prompting. */
  persistentFolderAccess: boolean;
  /** Form-data/binary file by path at send time (web: only inside the opened project folder). */
  fileReferencesByPath: boolean;
  secretStorage: SecretBackend;
  multiWindow: boolean;
  /** Full offline for local workflows. */
  offline: boolean;
}

/** Returns a frozen copy, so no feature can flip a capability at runtime. */
export function defineCapabilities(capabilities: Capabilities): Readonly<Capabilities> {
  return Object.freeze({ ...capabilities });
}
