import type { Capabilities } from '@pigeon/platform';
import { defineCapabilities } from '@pigeon/platform';

/** Desktop capabilities are the same on macOS, Windows and Linux (docs/platform.md §4). */
export const DESKTOP_CAPABILITIES: Readonly<Capabilities> = defineCapabilities({
  transport: 'native', // NativeTransport → Rust http_send (reqwest)
  bypassesCors: true,
  canSetAnyHeader: true,
  canReadAllResponseHeaders: true,
  canControlRedirects: true,
  canDisableTlsVerification: true,
  canSendBodyWithGet: true,
  detailedTimings: true,
  projectFolders: 'native',
  browserWorkspace: false,
  fileWatch: true,
  persistentFolderAccess: true,
  fileReferencesByPath: true,
  secretStorage: 'os-keychain', // falls back to secrets.json when unavailable (PIGN-053)
  multiWindow: false, // later
  offline: true,
});
