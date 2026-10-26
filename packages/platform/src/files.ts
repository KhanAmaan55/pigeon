/** Importing (pick/drop) and exporting (save/download) single files outside a project. */

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Media type when the platform reports one. */
  mime?: string;
}

export interface FileExchange {
  /** Resolves `[]` when the user cancels. `accept` lists extensions (`.json`) or media types. */
  pickFiles(opts: { accept: string[]; multiple?: boolean }): Promise<PickedFile[]>;
  saveFile(
    suggestedName: string,
    data: Uint8Array | string,
    mime: string,
  ): Promise<'saved' | 'cancelled'>;
}
