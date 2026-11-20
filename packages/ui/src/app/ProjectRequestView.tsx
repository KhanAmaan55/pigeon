import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { BrokenFilePanel } from '../features/explorer/BrokenFilePanel';
import { useScratchRequestStore } from '../features/request-editor/ScratchRequestProvider';
import { useAppStore, useProjectState } from '../stores/AppStoreProvider';

/**
 * Opens the request selected in the explorer in the editor (a copy; editing and saving arrive
 * with PIGN-016/018), shows broken files instead of the editor, and falls back to the scratch
 * request when the project closes.
 */
export function ProjectRequestView({ children }: { children: ReactNode }) {
  const project = useAppStore((s) => s.project);
  const selectedId = useProjectState((s) => s.selectedId, null);
  const scratch = useScratchRequestStore();
  const session = project?.session;
  const location = selectedId && session ? session.locate(selectedId) : undefined;
  const item = location?.item.kind === 'request' ? location.item : undefined;
  const filePath = item && session ? session.itemFilePath(item.id) : undefined;

  useEffect(() => {
    if (!session) {
      if (scratch.getState().source) scratch.getState().openScratch();
      return;
    }
    if (!item || item.broken || !filePath) return;
    scratch
      .getState()
      .openProjectRequest(
        item,
        { projectId: session.id, projectName: session.name, filePath },
        session.fs,
      );
  }, [session, item, filePath, scratch]);

  if (item?.broken && session && filePath) {
    const problem = session.problemsFor(filePath)[0];
    return (
      <BrokenFilePanel
        name={item.name}
        path={filePath}
        message={problem?.message ?? 'The file is invalid.'}
      />
    );
  }
  return <>{children}</>;
}
