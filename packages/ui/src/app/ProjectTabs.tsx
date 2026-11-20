import { Plus, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';

import { IconButton } from '../components/IconButton';
import type { OpenProject } from '../stores/app-store';
import { useAppStore, useAppStoreApi } from '../stores/AppStoreProvider';
import { locationLabel } from '../stores/locations';

/** Cmd/Ctrl+Alt+←/→ (docs/ui-ux.md §3.1). `code`, since Alt changes `key` on macOS. */
export function projectCycleDelta(event: KeyboardEvent): 1 | -1 | 0 {
  if (!event.altKey || !(event.metaKey || event.ctrlKey) || event.shiftKey) return 0;
  return event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
}

/** One tab per open project; each is a fully isolated session and store (PIGN-021). */
export function ProjectTabs() {
  const api = useAppStoreApi();
  const projects = useAppStore((s) => s.projects);
  const active = useAppStore((s) => s.project);
  const [closing, setClosing] = useState<OpenProject | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const delta = projectCycleDelta(event);
      if (delta === 0) return;
      event.preventDefault();
      api.getState().cycleProject(delta);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api]);

  const close = (project: OpenProject) => {
    if (project.session.unsavedIds().length > 0) setClosing(project);
    else api.getState().closeProject(project.key);
  };

  return (
    <div
      role="tablist"
      aria-label="Open projects"
      data-testid="project-tabs"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm text-fg-muted"
    >
      {projects.length === 0 && <span className="truncate">No project open</span>}
      {projects.map((project) => {
        const selected = project === active;
        return (
          <div
            key={project.key}
            role="tab"
            aria-selected={selected}
            data-testid="project-tab"
            title={locationLabel(project.session.location)}
            onClick={() => api.getState().switchProject(project.key)}
            className={`flex h-7 max-w-56 shrink-0 cursor-default items-center gap-1 rounded border pr-0.5 pl-2 ${
              selected ? 'border-border bg-surface text-fg' : 'border-transparent hover:bg-hover'
            }`}
          >
            <span className="truncate">{project.session.name || 'Untitled project'}</span>
            <IconButton
              label={`Close ${project.session.name || 'project'}`}
              icon={<X size={12} />}
              data-testid="close-project"
              className="size-6"
              onClick={(event) => {
                event.stopPropagation();
                close(project);
              }}
            />
          </div>
        );
      })}
      {projects.length > 0 && (
        <IconButton
          label="Open another project"
          icon={<Plus size={14} />}
          data-testid="add-project"
          className="size-7"
          onClick={() => api.getState().showWelcome()}
        />
      )}
      <Dialog.Root open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content
            data-testid="close-project-dialog"
            className="fixed top-1/2 left-1/2 w-[min(26rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface-raised p-4 text-sm text-fg shadow-xl"
          >
            <Dialog.Title className="text-base font-semibold">
              Close “{closing?.session.name}”?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-fg-muted">
              It has unsaved changes, which will be lost. Saved changes stay in local state.
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="h-8 rounded border border-border px-3 hover:bg-hover"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                data-testid="close-project-confirm"
                onClick={() => {
                  if (closing) api.getState().closeProject(closing.key);
                  setClosing(null);
                }}
                className="h-8 rounded border border-fail px-3 font-semibold text-fail hover:bg-fail/10"
              >
                Close without saving
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
