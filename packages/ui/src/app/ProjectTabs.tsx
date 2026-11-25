import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '../components/IconButton';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../components/ui';
import type { OpenProject } from '../stores/app-store';
import { useAppStore, useAppStoreApi } from '../stores/AppStoreProvider';
import { locationLabel } from '../stores/locations';
import { useCommand } from '../features/command-palette/CommandsProvider';

/** One tab per open project; each is a fully isolated session and store (PIGN-021). */
export function ProjectTabs() {
  const api = useAppStoreApi();
  const projects = useAppStore((s) => s.projects);
  const active = useAppStore((s) => s.project);
  const [closing, setClosing] = useState<OpenProject | null>(null);

  // Cmd/Ctrl+Alt+←/→ (docs/ui-ux.md §3.1).
  useCommand('project.next', () => api.getState().cycleProject(1));
  useCommand('project.previous', () => api.getState().cycleProject(-1));

  const close = (project: OpenProject) => {
    if (project.session.unsavedIds().length > 0) setClosing(project);
    else api.getState().closeProject(project.key);
  };

  return (
    <div
      data-testid="project-tabs"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm text-fg-muted"
    >
      {projects.length === 0 && <span className="truncate">No project open</span>}
      {/* Only tabs inside the tablist (axe aria-required-children). */}
      <div
        role={projects.length > 0 ? 'tablist' : undefined}
        aria-label={projects.length > 0 ? 'Open projects' : undefined}
        className="flex min-w-0 items-center gap-1"
      >
        {projects.map((project) => {
          const selected = project === active;
          return (
            <div
              key={project.key}
              role="tab"
              aria-selected={selected}
              data-testid="project-tab"
              tabIndex={selected ? 0 : -1}
              title={locationLabel(project.session.location)}
              onClick={() => api.getState().switchProject(project.key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  api.getState().switchProject(project.key);
                }
              }}
              className={`flex h-8 max-w-56 shrink-0 cursor-default items-center gap-1 rounded-full pr-1 pl-3.5 font-medium transition-colors ${
                selected
                  ? 'bg-bg text-fg shadow-sm ring-1 ring-border'
                  : 'hover:bg-hover hover:text-fg'
              }`}
            >
              <span className="truncate">{project.session.name || 'Untitled project'}</span>
              {/* Not a button inside the tab (axe nested-interactive): the keyboard closes a
                project with File → Close Project or the command palette. */}
              <span
                aria-hidden
                title={`Close ${project.session.name || 'project'}`}
                data-testid="close-project"
                onClick={(event) => {
                  event.stopPropagation();
                  close(project);
                }}
                className="flex size-6 cursor-pointer items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
              >
                <X size={12} />
              </span>
            </div>
          );
        })}
      </div>
      {projects.length > 0 && (
        <IconButton
          label="Open another project"
          icon={<Plus size={14} />}
          data-testid="add-project"
          className="size-7"
          onClick={() => api.getState().showWelcome()}
        />
      )}
      <Dialog open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        <DialogContent width="sm" data-testid="close-project-dialog">
          <DialogTitle>Close “{closing?.session.name}”?</DialogTitle>
          <DialogDescription>
            It has unsaved changes, which will be lost. Saved changes stay in local state.
          </DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              data-testid="close-project-confirm"
              onClick={() => {
                if (closing) api.getState().closeProject(closing.key);
                setClosing(null);
              }}
            >
              Close without saving
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
