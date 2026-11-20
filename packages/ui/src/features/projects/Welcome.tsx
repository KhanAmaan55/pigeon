import { AlertTriangle, FolderOpen, FolderPlus, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';

import { useCapabilities } from '../../app/PlatformProvider';
import type { RecentProject } from '../../stores/app-store';
import { useAppStore } from '../../stores/AppStoreProvider';
import { locationKey, locationLabel } from '../../stores/locations';

/**
 * Shown in the Collections sidebar when no project is open (docs/ui-ux.md §3.1): Create project,
 * Open folder and recent projects. The scratch request stays usable meanwhile.
 */
export function Welcome() {
  const canOpenFolders = useCapabilities().projectFolders !== 'none';
  const busy = useAppStore((s) => s.busy);
  const error = useAppStore((s) => s.error);
  const recents = useAppStore((s) => s.recentProjects);
  const openFolder = useAppStore((s) => s.openFolder);
  const createProject = useAppStore((s) => s.createProject);
  const clearError = useAppStore((s) => s.clearError);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void createProject(name).then(() => setCreating(false));
  };

  return (
    <div
      data-testid="welcome"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm"
    >
      <p className="text-fg-muted">
        No project open. Open a folder with a Pigeon project, or create one.
      </p>
      {canOpenFolders ? (
        <div className="flex flex-col gap-2">
          {creating ? (
            <form aria-label="Create project" className="flex flex-col gap-2" onSubmit={submit}>
              <input
                aria-label="Project name"
                data-testid="create-project-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Project name"
                className="h-8 rounded border border-border bg-bg px-2 text-fg"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy || name.trim() === ''}
                  data-testid="create-project-submit"
                  className="h-8 flex-1 rounded bg-accent px-3 font-semibold text-accent-fg disabled:opacity-60"
                >
                  Choose location…
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="h-8 rounded border border-border px-3 hover:bg-hover"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              data-testid="create-project"
              disabled={busy}
              onClick={() => setCreating(true)}
              className="inline-flex h-8 items-center gap-2 rounded bg-accent px-3 font-semibold text-accent-fg disabled:opacity-60"
            >
              <FolderPlus size={16} aria-hidden />
              Create project
            </button>
          )}
          <button
            type="button"
            data-testid="open-folder"
            disabled={busy}
            onClick={() => void openFolder()}
            className="inline-flex h-8 items-center gap-2 rounded border border-border px-3 hover:bg-hover disabled:opacity-60"
          >
            <FolderOpen size={16} aria-hidden />
            Open folder…
          </button>
        </div>
      ) : (
        <p className="text-fg-muted">This browser cannot open project folders.</p>
      )}
      {error && (
        <div
          role="alert"
          data-testid="welcome-error"
          className="flex items-start gap-2 rounded border border-fail/40 bg-fail/10 p-2 text-fg"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-fail" aria-hidden />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={clearError}
            className="text-fg-muted hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {recents.length > 0 && <RecentProjects recents={recents} />}
    </div>
  );
}

function RecentProjects({ recents }: { recents: RecentProject[] }) {
  const status = useAppStore((s) => s.recentStatus);
  const busy = useAppStore((s) => s.busy);
  const openRecent = useAppStore((s) => s.openRecent);
  const forgetRecent = useAppStore((s) => s.forgetRecent);

  return (
    <section aria-label="Recent projects" className="flex flex-col gap-1">
      <h2 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Recent</h2>
      <ul className="flex flex-col">
        {recents.map((recent) => {
          const key = locationKey(recent.location);
          const missing = status[key] === 'missing';
          return (
            <li
              key={key}
              data-testid="recent-project"
              data-status={status[key] ?? 'unknown'}
              className="group flex items-center gap-1"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void openRecent(recent)}
                title={locationLabel(recent.location)}
                className="flex min-w-0 flex-1 flex-col items-start rounded px-2 py-1 text-left hover:bg-hover disabled:opacity-60"
              >
                <span
                  className={`truncate font-medium ${missing ? 'text-fg-muted line-through' : 'text-fg'}`}
                >
                  {recent.name}
                </span>
                <span className="w-full truncate text-xs text-fg-muted">
                  {missing ? 'Folder not found · ' : ''}
                  {locationLabel(recent.location)}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${recent.name} from recent projects`}
                onClick={() => void forgetRecent(recent)}
                className="rounded p-1 text-fg-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg focus:opacity-100"
              >
                <X size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
