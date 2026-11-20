import type { ProjectSession } from '@pigeon/core';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState } from 'react';

import { DiffView } from '../../components/DiffView/DiffView';
import { useProjectState } from '../../stores/AppStoreProvider';

/**
 * Banners above the editor for the active request (file-format.md §8): a conflict between the
 * saved draft and the file (Keep mine / Take theirs / Compare), or unsaved edits whose file
 * changed on disk (Reload / Keep editing).
 */
export function ChangeBanners({
  session,
  requestId,
}: {
  session: ProjectSession;
  requestId: string;
}) {
  const conflicted = useProjectState((s) => s.changes[requestId] === 'conflict', false);
  const external = useProjectState((s) => s.external[requestId] === true, false);
  const [compare, setCompare] = useState<{ theirs: string; mine: string; path?: string } | null>(
    null,
  );
  const conflict = conflicted ? session.conflictOf(requestId) : undefined;

  return (
    <>
      {conflict && (
        <div
          role="alert"
          data-testid="conflict-banner"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-fail/10 px-3 py-1.5 text-xs text-fg"
        >
          <AlertTriangle size={14} className="shrink-0 text-fail" aria-hidden />
          <span className="min-w-0 flex-1">
            {conflict.reason === 'deleted-on-disk'
              ? 'This request was deleted on disk, but you have saved changes to it.'
              : 'This request changed on disk since you saved your changes.'}
          </span>
          <button
            type="button"
            data-testid="conflict-keep-mine"
            onClick={() => void session.resolveConflict(requestId, 'mine')}
            className="rounded border border-border bg-surface px-2 py-0.5 hover:bg-hover"
          >
            Keep mine
          </button>
          <button
            type="button"
            data-testid="conflict-take-theirs"
            onClick={() => void session.resolveConflict(requestId, 'theirs')}
            className="rounded border border-border bg-surface px-2 py-0.5 hover:bg-hover"
          >
            Take theirs
          </button>
          <button
            type="button"
            data-testid="conflict-compare"
            onClick={() =>
              void session.conflictTexts(requestId).then((texts) =>
                setCompare({
                  theirs: texts.theirs,
                  mine: texts.mine,
                  ...(texts.path ? { path: texts.path } : {}),
                }),
              )
            }
            className="rounded border border-border bg-surface px-2 py-0.5 hover:bg-hover"
          >
            Compare
          </button>
        </div>
      )}
      {!conflict && external && (
        <div
          role="alert"
          data-testid="external-change-banner"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-warn/10 px-3 py-1.5 text-xs text-fg"
        >
          <RefreshCw size={14} className="shrink-0 text-warn" aria-hidden />
          <span className="min-w-0 flex-1">File changed on disk. Reload or keep editing?</span>
          <button
            type="button"
            data-testid="external-reload"
            onClick={() => session.reloadEntity(requestId)}
            className="rounded border border-border bg-surface px-2 py-0.5 hover:bg-hover"
          >
            Reload
          </button>
          <button
            type="button"
            data-testid="external-keep"
            onClick={() => session.keepEditing(requestId)}
            className="rounded border border-border bg-surface px-2 py-0.5 hover:bg-hover"
          >
            Keep editing
          </button>
        </div>
      )}
      <Dialog.Root open={compare !== null} onOpenChange={(open) => !open && setCompare(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content
            data-testid="conflict-compare-dialog"
            className="fixed top-1/2 left-1/2 flex max-h-[80vh] w-[min(56rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
          >
            <Dialog.Title className="text-base font-semibold">
              Compare with the file on disk
            </Dialog.Title>
            <Dialog.Description className="text-xs text-fg-muted">
              <span className="text-fail">−</span> lines are in the file (
              {compare?.path ?? 'deleted'}), <span className="text-pass">+</span> lines are your
              saved changes.
            </Dialog.Description>
            <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
              {compare && (
                <DiffView before={compare.theirs} after={compare.mine} testId="conflict-diff" />
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
