/** Secret variable values. They are never written to project files. */

export type SecretBackend = 'os-keychain' | 'local-state' | 'indexeddb' | 'memory';

export interface SecretStore {
  /** Every secret of a project (loaded once when the project opens). */
  getAll(projectId: string): Promise<Record<string, string>>;
  get(projectId: string, key: string): Promise<string | undefined>;
  set(projectId: string, key: string, value: string): Promise<void>;
  delete(projectId: string, key: string): Promise<void>;
  /** "Forget all secrets for this project" (PIGN-053): every value of the project, gone. */
  clear(projectId: string): Promise<void>;
  /** Where values are kept now (a keychain store reports `local-state` after falling back). */
  readonly backend: SecretBackend;
  /** Why the preferred backend is not in use (e.g. no Secret Service on Linux), for the UI. */
  readonly notice?: string | undefined;
}
