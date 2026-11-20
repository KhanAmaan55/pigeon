/**
 * Minimal in-memory File System Access handles with the DOMException names Chromium uses, so
 * `FsAccessFs` can run `fsConformance` in Node. Real OPFS handles are covered in Playwright.
 */

class DomError extends Error {
  constructor(name: string, message = name) {
    super(message);
    this.name = name;
  }
}

type Node = FakeFile | FakeDirectory;

class FakeFile {
  readonly kind = 'file';
  data = new Uint8Array();
  lastModified = Date.now();
  constructor(readonly name: string) {}

  async getFile() {
    const data = this.data;
    return {
      size: data.byteLength,
      lastModified: this.lastModified,
      arrayBuffer: async () => data.slice().buffer,
    };
  }

  async createWritable() {
    let pending = new Uint8Array();
    return {
      write: async (bytes: Uint8Array) => {
        // Yield, like a real stream, so concurrent reads can interleave.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const next = new Uint8Array(pending.byteLength + bytes.byteLength);
        next.set(pending);
        next.set(bytes, pending.byteLength);
        pending = next;
      },
      close: async () => {
        this.data = pending;
        this.lastModified = Date.now();
      },
      abort: async () => undefined,
    };
  }
}

export class FakeDirectory {
  readonly kind = 'directory';
  readonly children = new Map<string, Node>();
  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeDirectory> {
    const existing = this.children.get(name);
    if (existing instanceof FakeDirectory) return existing;
    if (existing) throw new DomError('TypeMismatchError');
    if (!opts.create) throw new DomError('NotFoundError');
    const dir = new FakeDirectory(name);
    this.children.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeFile> {
    const existing = this.children.get(name);
    if (existing instanceof FakeFile) return existing;
    if (existing) throw new DomError('TypeMismatchError');
    if (!opts.create) throw new DomError('NotFoundError');
    const file = new FakeFile(name);
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string, opts: { recursive?: boolean } = {}): Promise<void> {
    const existing = this.children.get(name);
    if (!existing) throw new DomError('NotFoundError');
    if (existing instanceof FakeDirectory && existing.children.size > 0 && !opts.recursive) {
      throw new DomError('InvalidModificationError');
    }
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, Node]> {
    for (const entry of [...this.children]) yield entry;
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const key of [...this.children.keys()]) yield key;
  }

  /** As a real handle, for code typed against the DOM. */
  asHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }
}
