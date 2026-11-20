import { isManagedPath } from '@pigeon/formats';
import type { ProjectFileSystem } from '@pigeon/platform';
import { FolderTree } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';

/** Folders never offered (VCS data, dependencies) and the most files listed. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.hg', '.svn']);
const MAX_FILES = 2000;

/** Files a request body can reference: everything except Pigeon's own files and skipped folders. */
export async function listReferenceableFiles(fs: ProjectFileSystem): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.list(dir)) {
      if (files.length >= MAX_FILES) return;
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
      if (entry.kind === 'dir') {
        if (!SKIPPED_DIRS.has(name)) await walk(entry.path);
      } else if (!isManagedPath(entry.path) && entry.path !== '.gitattributes') {
        files.push(entry.path);
      }
    }
  };
  await walk('');
  return files;
}

/**
 * "Pick from project folder" (PIGN-016): stores a project-relative `src`, which teammates
 * resolve against their own checkout (unlike a file picked this session).
 */
export function ProjectFileButton({
  fs,
  onPicked,
}: {
  fs: ProjectFileSystem;
  onPicked: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<string[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listReferenceableFiles(fs).then(
      (list) => !cancelled && setFiles(list),
      () => !cancelled && setFiles([]),
    );
    return () => {
      cancelled = true;
    };
  }, [open, fs]);

  const shown = useMemo(
    () => (files ?? []).filter((path) => path.toLowerCase().includes(filter.toLowerCase())),
    [files, filter],
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setFiles(null);
          setFilter('');
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          data-testid="project-file-button"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border px-2 text-xs text-fg hover:bg-hover"
        >
          <FolderTree size={12} aria-hidden />
          From project…
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="project-file-dialog"
          className="fixed top-1/2 left-1/2 flex max-h-[70vh] w-[min(32rem,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
        >
          <Dialog.Title className="text-base font-semibold">
            Pick a file from the project
          </Dialog.Title>
          <Dialog.Description className="text-xs text-fg-muted">
            The path is stored relative to the project folder, so it works for everyone who has the
            project.
          </Dialog.Description>
          <input
            aria-label="Filter files"
            data-testid="project-file-filter"
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter"
            className="h-8 rounded border border-border bg-bg px-2"
          />
          <ul className="min-h-24 flex-1 overflow-y-auto rounded border border-border">
            {files === null && <li className="p-2 text-fg-muted">Loading…</li>}
            {files !== null && shown.length === 0 && (
              <li className="p-2 text-fg-muted">No files outside Pigeon's own folders.</li>
            )}
            {shown.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  data-testid="project-file-option"
                  onClick={() => {
                    onPicked(path);
                    setOpen(false);
                  }}
                  className="w-full truncate px-2 py-1 text-left font-mono text-xs hover:bg-hover"
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
