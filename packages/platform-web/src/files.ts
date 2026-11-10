/**
 * `FileExchange` in the browser (docs/platform.md §6.5): pick with `<input type="file">`, save
 * with `showSaveFilePicker` where available (Chromium) and a Blob download everywhere else.
 */

import type { FileExchange, PickedFile } from '@pigeon/platform';

/** The parts of `window` this module uses; tests pass a fake. */
export interface FileEnvironment {
  document: Document;
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<{
    createWritable(): Promise<{
      write(data: Blob | BufferSource | string): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
}

export class WebFileExchange implements FileExchange {
  readonly #env: FileEnvironment;

  constructor(env: FileEnvironment = window as unknown as FileEnvironment) {
    this.#env = env;
  }

  pickFiles(opts: { accept: string[]; multiple?: boolean }): Promise<PickedFile[]> {
    const input = this.#env.document.createElement('input');
    input.type = 'file';
    input.accept = opts.accept.join(',');
    input.multiple = opts.multiple ?? false;
    return new Promise<PickedFile[]>((resolve, reject) => {
      input.addEventListener('cancel', () => resolve([]), { once: true });
      input.addEventListener(
        'change',
        () => {
          Promise.all(
            Array.from(input.files ?? [], async (file) => ({
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
              ...(file.type ? { mime: file.type } : {}),
            })),
          ).then(resolve, reject);
        },
        { once: true },
      );
      input.click();
    });
  }

  async saveFile(
    suggestedName: string,
    data: Uint8Array | string,
    mime: string,
  ): Promise<'saved' | 'cancelled'> {
    const blob = new Blob([data as BlobPart], { type: mime });
    const { showSaveFilePicker } = this.#env;
    if (showSaveFilePicker) {
      let handle;
      try {
        handle = await showSaveFilePicker.call(this.#env, { suggestedName });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
        throw error;
      }
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    }
    // No picker: the browser saves to its downloads folder (or asks, per its settings).
    const url = this.#env.URL.createObjectURL(blob);
    try {
      const link = this.#env.document.createElement('a');
      link.href = url;
      link.download = suggestedName;
      link.rel = 'noopener';
      link.style.display = 'none';
      this.#env.document.body.append(link);
      link.click();
      link.remove();
    } finally {
      // Revoking right away can cancel the download in some browsers; give it a moment.
      setTimeout(() => this.#env.URL.revokeObjectURL(url), 60_000);
    }
    return 'saved';
  }
}
