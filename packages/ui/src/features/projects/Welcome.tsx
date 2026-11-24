import {
  AlertTriangle,
  Database,
  FileArchive,
  FileInput,
  FolderOpen,
  FolderPlus,
  X,
} from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';

import { useCapabilities, usePlatform } from '../../app/PlatformProvider';
import { Button, Callout, Input, SectionLabel } from '../../components/ui';
import { HelpLink } from '../help/WebLimitations';
import type { RecentProject } from '../../stores/app-store';
import { useAppStore } from '../../stores/AppStoreProvider';
import { locationKey, locationLabel } from '../../stores/locations';

/**
 * Shown in the Collections sidebar when no project is open (docs/ui-ux.md §3.1): Create project,
 * Open folder and recent projects. The scratch request stays usable meanwhile.
 */
export function Welcome() {
  const capabilities = useCapabilities();
  const canOpenFolders = capabilities.projectFolders !== 'none';
  const canUseWorkspaces = capabilities.browserWorkspace;
  const busy = useAppStore((s) => s.busy);
  const error = useAppStore((s) => s.error);
  const recents = useAppStore((s) => s.recentProjects);
  const openFolder = useAppStore((s) => s.openFolder);
  const createProject = useAppStore((s) => s.createProject);
  const createWorkspace = useAppStore((s) => s.createWorkspace);
  const importProjectZip = useAppStore((s) => s.importProjectZip);
  const importIntoNewProject = useAppStore((s) => s.importIntoNewProject);
  const clearError = useAppStore((s) => s.clearError);
  /** Which "new project" form is open. */
  const [creating, setCreating] = useState<'folder' | 'workspace' | null>(null);
  const [name, setName] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const create = creating === 'workspace' ? createWorkspace : createProject;
    void create(name).then(() => setCreating(null));
  };

  return (
    <div
      data-testid="welcome"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm"
    >
      {capabilities.transport === 'fetch' && <WebFirstRunNotice />}
      <p className="text-fg-muted">
        No project open. Open a folder with a Pigeon project, or create one.
      </p>
      {canOpenFolders || canUseWorkspaces ? (
        <div className="flex flex-col gap-2">
          {creating ? (
            <form aria-label="Create project" className="flex flex-col gap-2" onSubmit={submit}>
              <Input
                aria-label="Project name"
                data-testid="create-project-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Project name"
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || name.trim() === ''}
                  data-testid="create-project-submit"
                  className="flex-1"
                >
                  {creating === 'workspace' ? 'Create workspace' : 'Choose location…'}
                </Button>
                <Button onClick={() => setCreating(null)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <>
              {canOpenFolders && (
                <Button
                  variant="primary"
                  data-testid="create-project"
                  disabled={busy}
                  onClick={() => setCreating('folder')}
                  icon={<FolderPlus aria-hidden />}
                  className="w-full"
                >
                  Create project
                </Button>
              )}
              {canUseWorkspaces && (
                <Button
                  variant={canOpenFolders ? 'secondary' : 'primary'}
                  data-testid="new-browser-workspace"
                  disabled={busy}
                  onClick={() => setCreating('workspace')}
                  icon={<Database aria-hidden />}
                  className="w-full"
                >
                  New browser workspace
                </Button>
              )}
            </>
          )}
          {canOpenFolders && (
            <Button
              data-testid="open-folder"
              disabled={busy}
              onClick={() => void openFolder()}
              icon={<FolderOpen aria-hidden />}
              className="w-full"
            >
              Open folder…
            </Button>
          )}
          <Button
            data-testid="import-postman-file"
            disabled={busy}
            onClick={() => void importIntoNewProject()}
            icon={<FileInput aria-hidden />}
            className="w-full"
          >
            Import Postman file…
          </Button>
          {canUseWorkspaces && (
            <Button
              data-testid="import-project-zip"
              disabled={busy}
              onClick={() => void importProjectZip()}
              icon={<FileArchive aria-hidden />}
              className="w-full"
            >
              Import project (.zip)…
            </Button>
          )}
          {canUseWorkspaces && !canOpenFolders && (
            <Callout tone="info" className="mt-1">
              <p className="text-xs text-fg-muted">
                This browser can't open folders: projects live in browser storage. Export a zip
                regularly to keep a copy. <HelpLink section="folders" />
              </p>
            </Callout>
          )}
        </div>
      ) : (
        <p className="text-fg-muted">This browser cannot store projects.</p>
      )}
      {error && (
        <Callout
          role="alert"
          data-testid="welcome-error"
          tone="fail"
          icon={<AlertTriangle size={14} className="mt-0.5 shrink-0 text-fail" aria-hidden />}
        >
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={clearError}
              className="-mr-1 rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
            >
              <X size={14} />
            </button>
          </div>
        </Callout>
      )}
      {recents.length > 0 && <RecentProjects recents={recents} />}
    </div>
  );
}

const FIRST_RUN_KEY = 'webFirstRunNoticeDismissed';

/**
 * Web, until dismissed (PIGN-039, docs/platform.md §6.3–6.4): where the web app keeps data, and
 * that secrets are stored unencrypted in this browser.
 */
function WebFirstRunNotice() {
  const { appState } = usePlatform();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void appState.get<boolean>('app', FIRST_RUN_KEY).then(
      (value) => !cancelled && setDismissed(value === true),
      () => !cancelled && setDismissed(false),
    );
    return () => {
      cancelled = true;
    };
  }, [appState]);
  if (dismissed !== false) return null;
  return (
    <Callout role="note" data-testid="web-first-run-notice" tone="warn">
      <div className="flex flex-col gap-1.5 text-xs">
        <p>
          Pigeon web keeps your workspaces, drafts and variable values in this browser's storage.
          The browser may clear it under storage pressure, so export projects regularly.{' '}
          <HelpLink section="storage" />
        </p>
        <p>
          Secrets are stored here unencrypted: don't use production credentials on shared machines.{' '}
          <HelpLink section="secrets" />
        </p>
        <Button
          size="xs"
          data-testid="web-first-run-dismiss"
          onClick={() => {
            setDismissed(true);
            void appState.set('app', FIRST_RUN_KEY, true);
          }}
          className="self-end"
        >
          Got it
        </Button>
      </div>
    </Callout>
  );
}

function RecentProjects({ recents }: { recents: RecentProject[] }) {
  const status = useAppStore((s) => s.recentStatus);
  const busy = useAppStore((s) => s.busy);
  const openRecent = useAppStore((s) => s.openRecent);
  const forgetRecent = useAppStore((s) => s.forgetRecent);

  return (
    <section aria-label="Recent projects" className="flex flex-col gap-1">
      <SectionLabel className="px-2">
        <h2>Recent</h2>
      </SectionLabel>
      <ul className="flex flex-col gap-0.5">
        {recents.map((recent) => {
          const key = locationKey(recent.location);
          const missing = status[key] === 'missing';
          const needsPermission = status[key] === 'needs-permission';
          return (
            <li
              key={key}
              data-testid="recent-project"
              data-status={status[key] ?? 'unknown'}
              className="group flex items-center gap-1 rounded-lg pr-1 hover:bg-hover"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void openRecent(recent)}
                title={locationLabel(recent.location)}
                className="flex min-w-0 flex-1 flex-col items-start rounded-lg px-2 py-1.5 text-left disabled:opacity-60"
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
              {needsPermission && (
                <Button
                  size="xs"
                  data-testid="recent-reconnect"
                  disabled={busy}
                  onClick={() => void openRecent(recent)}
                >
                  Reconnect
                </Button>
              )}
              <button
                type="button"
                aria-label={`Remove ${recent.name} from recent projects`}
                onClick={() => void forgetRecent(recent)}
                className="rounded p-1 text-fg-muted opacity-0 group-hover:opacity-100 hover:bg-selected hover:text-fg focus:opacity-100"
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
