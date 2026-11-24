import type { ProjectSession } from '@pigeon/core';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { DiffView } from '../../components/DiffView/DiffView';
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui';
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
        <Callout
          role="alert"
          data-testid="conflict-banner"
          tone="fail"
          icon={<AlertTriangle size={14} className="shrink-0 self-center text-fail" aria-hidden />}
          className="mx-3 mt-2 shrink-0 items-center"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="min-w-0 flex-1">
              {conflict.reason === 'deleted-on-disk'
                ? 'This request was deleted on disk, but you have saved changes to it.'
                : 'This request changed on disk since you saved your changes.'}
            </span>
            <Button
              size="xs"
              data-testid="conflict-keep-mine"
              onClick={() => void session.resolveConflict(requestId, 'mine')}
            >
              Keep mine
            </Button>
            <Button
              size="xs"
              data-testid="conflict-take-theirs"
              onClick={() => void session.resolveConflict(requestId, 'theirs')}
            >
              Take theirs
            </Button>
            <Button
              size="xs"
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
            >
              Compare
            </Button>
          </div>
        </Callout>
      )}
      {!conflict && external && (
        <Callout
          role="alert"
          data-testid="external-change-banner"
          tone="warn"
          icon={<RefreshCw size={14} className="shrink-0 self-center text-warn" aria-hidden />}
          className="mx-3 mt-2 shrink-0 items-center"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="min-w-0 flex-1">File changed on disk. Reload or keep editing?</span>
            <Button
              size="xs"
              data-testid="external-reload"
              onClick={() => session.reloadEntity(requestId)}
            >
              Reload
            </Button>
            <Button
              size="xs"
              data-testid="external-keep"
              onClick={() => session.keepEditing(requestId)}
            >
              Keep editing
            </Button>
          </div>
        </Callout>
      )}
      <Dialog open={compare !== null} onOpenChange={(open) => !open && setCompare(null)}>
        <DialogContent width="2xl" data-testid="conflict-compare-dialog">
          <DialogTitle>Compare with the file on disk</DialogTitle>
          <DialogDescription className="text-xs">
            <span className="text-fail">−</span> lines are in the file ({compare?.path ?? 'deleted'}
            ), <span className="text-pass">+</span> lines are your saved changes.
          </DialogDescription>
          <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-border">
            {compare && (
              <DiffView before={compare.theirs} after={compare.mine} testId="conflict-diff" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
