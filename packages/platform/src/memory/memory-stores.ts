import type { AppStateNamespace, AppStateStore } from '../app-state';
import type { ConfirmOptions, Dialogs, MessageOptions } from '../dialogs';
import type { FileExchange, PickedFile } from '../files';
import type { SecretStore } from '../secrets';

/** `AppStateStore` that keeps JSON text in memory, so values behave as if persisted. */
export class MemoryAppState implements AppStateStore {
  readonly #docs = new Map<string, Map<string, string>>();

  async get<T>(ns: AppStateNamespace, key: string): Promise<T | undefined> {
    const json = this.#docs.get(ns)?.get(key);
    return json === undefined ? undefined : (JSON.parse(json) as T);
  }

  async set<T>(ns: AppStateNamespace, key: string, value: T): Promise<void> {
    const json = JSON.stringify(value);
    if (json === undefined)
      throw new TypeError(`App state "${ns}/${key}" is not JSON-serializable`);
    let docs = this.#docs.get(ns);
    if (!docs) this.#docs.set(ns, (docs = new Map()));
    docs.set(key, json);
  }

  async delete(ns: string, key: string): Promise<void> {
    this.#docs.get(ns)?.delete(key);
  }

  async clearNamespace(ns: string): Promise<void> {
    this.#docs.delete(ns);
  }
}

export class MemorySecretStore implements SecretStore {
  readonly backend = 'memory';
  readonly #values = new Map<string, Map<string, string>>();

  async get(projectId: string, key: string): Promise<string | undefined> {
    return this.#values.get(projectId)?.get(key);
  }

  async set(projectId: string, key: string, value: string): Promise<void> {
    let values = this.#values.get(projectId);
    if (!values) this.#values.set(projectId, (values = new Map()));
    values.set(key, value);
  }

  async delete(projectId: string, key: string): Promise<void> {
    this.#values.get(projectId)?.delete(key);
  }
}

export type ShownDialog =
  { type: 'confirm'; opts: ConfirmOptions } | { type: 'message'; opts: MessageOptions };

/** Records every dialog. `confirm` answers `confirmAnswer`, which defaults to cancel. */
export class MemoryDialogs implements Dialogs {
  confirmAnswer = false;
  readonly shown: ShownDialog[] = [];

  async confirm(opts: ConfirmOptions): Promise<boolean> {
    this.shown.push({ type: 'confirm', opts });
    return this.confirmAnswer;
  }

  async message(opts: MessageOptions): Promise<void> {
    this.shown.push({ type: 'message', opts });
  }
}

export interface SavedFile {
  name: string;
  data: Uint8Array | string;
  mime: string;
}

/** `pickFiles` returns what `queuePick` queued (else `[]`, i.e. cancelled); `saveFile` records. */
export class MemoryFileExchange implements FileExchange {
  readonly saved: SavedFile[] = [];
  readonly #picks: PickedFile[][] = [];

  queuePick(files: PickedFile[]): void {
    this.#picks.push(files);
  }

  async pickFiles(): Promise<PickedFile[]> {
    return this.#picks.shift() ?? [];
  }

  async saveFile(name: string, data: Uint8Array | string, mime: string): Promise<'saved'> {
    this.saved.push({ name, data, mime });
    return 'saved';
  }
}
