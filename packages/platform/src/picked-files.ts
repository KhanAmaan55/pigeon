/**
 * Files the user picked this session for form-data and binary bodies (docs/platform.md §6.5),
 * held in memory and referenced by `FileRef { kind: 'picked', id }`. The editor adds them, the
 * transport reads them. Nothing is persisted: after a restart the user picks the file again.
 */

import type { PickedFile } from './files';
import type { FileRef } from './transport';

export class PickedFileStore {
  readonly #files = new Map<string, PickedFile>();

  /** Stores a copy of `file` and returns its reference. */
  add(file: PickedFile): Extract<FileRef, { kind: 'picked' }> {
    const id = crypto.randomUUID();
    this.#files.set(id, { ...file, bytes: file.bytes.slice() });
    return { kind: 'picked', id };
  }

  get(id: string): PickedFile | undefined {
    return this.#files.get(id);
  }

  delete(id: string): boolean {
    return this.#files.delete(id);
  }

  get size(): number {
    return this.#files.size;
  }
}
