import { isManagedPath } from '@pigeon/formats';
import type { ProjectFileSystem } from '@pigeon/platform';
import { FolderTree } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
} from '../../../components/ui';

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setFiles(null);
          setFilter('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="xs" data-testid="project-file-button" icon={<FolderTree aria-hidden />}>
          From project…
        </Button>
      </DialogTrigger>
      <DialogContent width="md" data-testid="project-file-dialog">
        <DialogTitle>Pick a file from the project</DialogTitle>
        <DialogDescription>
          The path is stored relative to the project folder, so it works for everyone who has the
          project.
        </DialogDescription>
        <Input
          aria-label="Filter files"
          data-testid="project-file-filter"
          autoFocus
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter"
          className="mt-4"
        />
        <ul className="mt-3 min-h-24 flex-1 overflow-y-auto rounded-lg border border-border p-1">
          {files === null && <li className="px-2 py-1.5 text-fg-muted">Loading…</li>}
          {files !== null && shown.length === 0 && (
            <li className="px-2 py-1.5 text-fg-muted">No files outside Pigeon's own folders.</li>
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
                className="block w-full cursor-default truncate rounded px-2 py-1 text-left font-mono text-xs leading-5 hover:bg-hover"
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
