/**
 * `FileExchange` on desktop. Saving goes through the Rust `save_file` command
 * (apps/desktop/src-tauri/src/files.rs), which shows the native Save dialog and writes the bytes,
 * so the webview needs no filesystem permission. Picking uses the webview's own file input, which
 * opens the native Open dialog.
 */

import type { FileExchange, PickedFile } from '@pigeon/platform';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { Invoke } from './native-transport';

const encoder = new TextEncoder();

export class DesktopFileExchange implements FileExchange {
  readonly #invoke: Invoke;
  readonly #document: Document | undefined;

  constructor(opts: { invoke?: Invoke; document?: Document } = {}) {
    this.#invoke = opts.invoke ?? tauriInvoke;
    this.#document = opts.document ?? globalThis.document;
  }

  async saveFile(
    suggestedName: string,
    data: Uint8Array | string,
    mime: string,
  ): Promise<'saved' | 'cancelled'> {
    try {
      return await this.#invoke<'saved' | 'cancelled'>(
        'save_file',
        encodeSaveFrame(suggestedName, data, mime),
      );
    } catch (error) {
      throw new Error(typeof error === 'string' ? error : 'The file could not be saved.', {
        cause: error,
      });
    }
  }

  pickFiles(opts: { accept: string[]; multiple?: boolean }): Promise<PickedFile[]> {
    const doc = this.#document;
    if (!doc) return Promise.resolve([]);
    const input = doc.createElement('input');
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
}

/** `[u32 LE JSON length][{ suggestedName, mime }][bytes]`, as files.rs reads it. */
export function encodeSaveFrame(
  suggestedName: string,
  data: Uint8Array | string,
  mime: string,
): Uint8Array {
  const json = encoder.encode(JSON.stringify({ suggestedName, mime }));
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const frame = new Uint8Array(4 + json.byteLength + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, json.byteLength, true);
  frame.set(json, 4);
  frame.set(bytes, 4 + json.byteLength);
  return frame;
}
