/**
 * Read-only Git status of the open project (PIGN-057, desktop): branch and which project files
 * differ from `HEAD`, for the explorer decorations and the status bar. Refreshed when the
 * project opens, when the window gets focus, and shortly after the project changes (Save for
 * Commit, files changed outside Pigeon). Pigeon never runs a Git command that writes.
 *
 * It also warns when Git ignores the project folder (PIGN-061), e.g. a project created under a
 * gitignored `dist/`: its files would never reach teammates and build steps may delete them.
 */

import type { ProjectSession } from '@pigeon/core';
import type { GitFileState, GitStatus, Platform } from '@pigeon/platform';
import { exampleDirectory } from '@pigeon/formats';
import { GitBranch } from 'lucide-react';
import { useEffect } from 'react';
import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';

import { usePlatform } from '../../app/PlatformProvider';
import { Callout } from '../../components/ui/Callout';
import { useAppStore } from '../../stores/AppStoreProvider';
import type { TreeRow } from '../explorer/tree';

export interface GitState {
  status: GitStatus | null;
  /** Project-relative path → state. */
  files: ReadonlyMap<string, GitFileState>;
  refresh: () => Promise<void>;
}

/** How long after a project change the status is read again. */
export const GIT_REFRESH_DELAY_MS = 400;

const stores = new WeakMap<ProjectSession, StoreApi<GitState>>();
const EMPTY = new Map<string, GitFileState>();

export function gitStoreFor(
  session: ProjectSession,
  platform: Pick<Platform, 'git'>,
): StoreApi<GitState> {
  let store = stores.get(session);
  if (!store) {
    let running: Promise<void> | null = null;
    let again = false;
    const read = async (): Promise<void> => {
      const reader = platform.git;
      if (!reader) return;
      const status = await reader
        .status(session.fs.root)
        .catch((): GitStatus => ({ available: false, repository: null }));
      const files = new Map<string, GitFileState>();
      for (const file of status.repository?.files ?? []) files.set(file.path, file.state);
      store!.setState({ status, files });
    };
    store = createStore<GitState>()(() => ({
      status: null,
      files: EMPTY,
      // One read at a time; a refresh asked for meanwhile runs once more after it.
      refresh: async () => {
        if (running) {
          again = true;
          return running;
        }
        running = (async () => {
          do {
            again = false;
            await read();
          } while (again);
        })().finally(() => (running = null));
        return running;
      },
    }));
    stores.set(session, store);
  }
  return store;
}

const NO_GIT: StoreApi<GitState> = createStore<GitState>()(() => ({
  status: null,
  files: EMPTY,
  refresh: async () => undefined,
}));

function useGitStore(): StoreApi<GitState> {
  const platform = usePlatform();
  const session = useAppStore((s) => s.project?.session ?? null);
  return session && platform.capabilities.gitStatus && platform.git
    ? gitStoreFor(session, platform)
    : NO_GIT;
}

export function useGitState<T>(selector: (state: GitState) => T): T {
  return useStore(useGitStore(), selector);
}

/** Mounted once (AppShell): keeps the open project's Git status fresh. */
export function useGitTracking(): void {
  const store = useGitStore();
  const session = useAppStore((s) => s.project?.session ?? null);
  useEffect(() => {
    if (store === NO_GIT || !session) return;
    void store.getState().refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void store.getState().refresh(), GIT_REFRESH_DELAY_MS);
    };
    const unsubscribe = session.onChange(soon);
    const onFocus = () => void store.getState().refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [store, session]);
}

const STATE_RANK: Record<GitFileState, number> = {
  staged: 1,
  untracked: 2,
  modified: 3,
  conflicted: 4,
};

/**
 * The Git state of an explorer row: its own file, plus a request's example files. When several
 * files differ, the most pressing state wins (conflicted > modified > untracked > staged).
 */
export function gitStateOfRow(
  row: Pick<TreeRow, 'kind' | 'path'>,
  files: ReadonlyMap<string, GitFileState>,
): GitFileState | undefined {
  if (files.size === 0 || !row.path) return undefined;
  let found = files.get(row.path);
  if (row.kind === 'request' && row.path.endsWith('.request.json')) {
    const slash = row.path.lastIndexOf('/');
    const directory = row.path.slice(0, slash);
    const fileKey = row.path.slice(slash + 1, -'.request.json'.length);
    const prefix = `${exampleDirectory(directory, fileKey)}/`;
    for (const [path, state] of files) {
      if (path.startsWith(prefix) && (!found || STATE_RANK[state] > STATE_RANK[found])) {
        found = state;
      }
    }
  }
  return found;
}

export const GIT_STATE_LABELS: Record<GitFileState, string> = {
  modified: 'Git: changed since the last commit (not staged)',
  staged: 'Git: changes staged for the next commit',
  untracked: 'Git: new file, not committed yet',
  conflicted: 'Git: merge conflict',
};

const GIT_STATE_CLASSES: Record<GitFileState, string> = {
  modified: 'bg-warn',
  staged: 'bg-accent',
  untracked: 'bg-pass',
  conflicted: 'bg-fail',
};

/** The explorer's Git dot (distinct from Pigeon's A / M / D draft badges). */
export function GitDot({ row }: { row: Pick<TreeRow, 'kind' | 'path'> }) {
  const state = useGitState((s) => gitStateOfRow(row, s.files));
  if (!state) return null;
  return (
    <span
      data-testid="explorer-git"
      data-git={state}
      title={GIT_STATE_LABELS[state]}
      aria-label={`(${GIT_STATE_LABELS[state]})`}
      className={`size-1.5 shrink-0 rounded-full ${GIT_STATE_CLASSES[state]}`}
    />
  );
}

/** Status bar: branch and how many project files differ from HEAD; click to refresh. */
export function GitStatusItem() {
  const status = useGitState((s) => s.status);
  const refresh = useGitState((s) => s.refresh);
  const repository = status?.available ? status.repository : null;
  if (!repository) return null;
  const changed = repository.files.length;
  const branch = repository.branch ?? 'detached HEAD';
  return (
    <button
      type="button"
      data-testid="status-git"
      title={`Git branch ${branch}: ${changed} project file${changed === 1 ? '' : 's'} differ from the last commit (read-only; click to refresh).`}
      onClick={() => void refresh()}
      className="inline-flex cursor-pointer items-center gap-1 hover:text-fg"
    >
      <GitBranch size={12} aria-hidden />
      <span data-testid="status-git-branch">{branch}</span>
      {changed > 0 && <span data-testid="status-git-changes">· {changed} changed</span>}
    </button>
  );
}

/**
 * The explorer's warning when Git ignores the project folder (PIGN-061). Non-blocking; hidden
 * on web, without `git` and outside a repository. Goes away on the next refresh (window focus)
 * once the folder is no longer ignored.
 */
export function GitIgnoredBanner() {
  const repository = useGitState((s) => (s.status?.available ? s.status.repository : null));
  if (!repository?.ignored) return null;
  const folder = repository.path.replace(/\/$/, '') || '.';
  return (
    <Callout role="status" data-testid="git-ignored-banner" tone="warn" className="mx-2 mb-2">
      <p className="text-xs break-words">
        This folder is ignored by Git (<code data-testid="git-ignored-path">{folder}</code>):
        changes here won't be committed. Move the project out of it to share it.
      </p>
    </Callout>
  );
}
