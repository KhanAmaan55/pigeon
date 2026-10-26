/** Secret variable values. They are never written to project files. */

export type SecretBackend = 'os-keychain' | 'local-state' | 'indexeddb' | 'memory';

export interface SecretStore {
  get(projectId: string, key: string): Promise<string | undefined>;
  set(projectId: string, key: string, value: string): Promise<void>;
  delete(projectId: string, key: string): Promise<void>;
  readonly backend: SecretBackend;
}
