/**
 * `FileRef { kind: 'project' }` resolution (PIGN-014): files referenced by project-relative paths
 * are read through the project's `ProjectFileSystem` and handed to the transport as files picked
 * for this send only, so every transport (native, fetch) reads them the same way.
 */

import type {
  FileRef,
  PickedFileStore,
  PreparedRequest,
  ProjectFileSystem,
} from '@pigeon/platform';
import { baseName, TransportError } from '@pigeon/platform';

export interface ResolvedFiles {
  request: PreparedRequest;
  /** Drops the temporary picked files; call after the send. */
  release(): void;
}

export async function resolveProjectFiles(
  req: PreparedRequest,
  fs: ProjectFileSystem | undefined,
  pickedFiles: PickedFileStore | undefined,
): Promise<ResolvedFiles> {
  const temporary: string[] = [];
  const release = () => {
    for (const id of temporary) pickedFiles?.delete(id);
  };
  const resolve = async (ref: FileRef): Promise<FileRef> => {
    if (ref.kind !== 'project') return ref;
    if (!fs || !pickedFiles) {
      throw new TransportError(
        'file-unavailable',
        `"${ref.path}" is a project file, but no project is open.`,
        {
          hint: 'Open the project or select the file again.',
        },
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(ref.path);
    } catch (error) {
      throw new TransportError(
        'file-unavailable',
        `The project file "${ref.path}" cannot be read.`,
        {
          detail: error instanceof Error ? error.message : String(error),
          hint: 'Check that the file exists inside the project folder.',
        },
      );
    }
    const picked = pickedFiles.add({ name: baseName(ref.path), bytes });
    temporary.push(picked.id);
    return picked;
  };

  const { body } = req;
  try {
    if (body?.kind === 'file') {
      return { request: { ...req, body: { ...body, ref: await resolve(body.ref) } }, release };
    }
    if (body?.kind === 'multipart') {
      const parts = [];
      for (const part of body.parts) {
        parts.push(part.kind === 'file' ? { ...part, file: await resolve(part.file) } : part);
      }
      return { request: { ...req, body: { ...body, parts } }, release };
    }
  } catch (error) {
    release();
    throw error;
  }
  return { request: req, release };
}
