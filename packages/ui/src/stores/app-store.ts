/**
 * App-wide state (docs/architecture.md §8): the open project and recent projects. Recent
 * projects persist in `AppStateStore` (`app` / `recentProjects`), so they survive restarts.
 * Multiple open projects arrive with PIGN-021.
 */

import {
  exportProjectZip,
  initializeProject,
  isPigeonProject,
  ProjectSession,
  readProjectZip,
} from '@pigeon/core';
import { slugify } from '@pigeon/formats';
import type { Platform, ProjectFileSystem, ProjectLocation } from '@pigeon/platform';
import { createStore } from 'zustand';

import { locationFolderName, locationKey } from './locations';
import type { ProjectStore } from './project-store';
import { createProjectStore } from './project-store';

export const RECENT_PROJECTS_KEY = 'recentProjects';
export const MAX_RECENT_PROJECTS = 10;

export interface RecentProject {
  projectId: string;
  name: string;
  location: ProjectLocation;
  /** ISO time. */
  lastOpenedAt: string;
}

export type RecentStatus = 'ok' | 'missing' | 'needs-permission';

export interface OpenProject {
  session: ProjectSession;
  store: ProjectStore;
}

export interface PendingInit {
  location: ProjectLocation;
  fs: ProjectFileSystem;
  suggestedName: string;
}

export interface AppState {
  recentProjects: RecentProject[];
  /** By `locationKey`. */
  recentStatus: Record<string, RecentStatus>;
  project: OpenProject | null;
  busy: boolean;
  error: string | null;
  /** A short message for the toast (background results, e.g. "Wrote 3 files"). */
  notice: { id: number; message: string } | null;
  notify: (message: string) => void;
  /** A picked folder without `pigeon.json`, waiting for "Initialize Pigeon project here?". */
  pendingInit: PendingInit | null;
  loadRecents: () => Promise<void>;
  openFolder: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  /** Web: a new IndexedDB-backed project. */
  createWorkspace: (name: string) => Promise<void>;
  /** Web: a new browser workspace from a project zip the user picks. */
  importProjectZip: () => Promise<void>;
  /** Downloads / saves the open project's files as a zip. */
  exportProjectZip: () => Promise<void>;
  openLocation: (location: ProjectLocation) => Promise<void>;
  openRecent: (recent: RecentProject) => Promise<void>;
  confirmInit: (name: string) => Promise<void>;
  cancelInit: () => void;
  closeProject: () => void;
  forgetRecent: (recent: RecentProject) => Promise<void>;
  clearError: () => void;
}

export type AppStore = ReturnType<typeof createAppStore>;

type AppPlatform = Pick<Platform, 'projects' | 'openProjectFs' | 'appState'> &
  Partial<Pick<Platform, 'files'>>;

export function createAppStore(platform: AppPlatform) {
  return createStore<AppState>()((set, get) => {
    const saveRecents = (recentProjects: RecentProject[]) => {
      set({ recentProjects });
      return platform.appState.set('app', RECENT_PROJECTS_KEY, recentProjects);
    };

    const remember = async (session: ProjectSession) => {
      const key = locationKey(session.location);
      const entry: RecentProject = {
        projectId: session.id,
        name: session.name || locationFolderName(session.location),
        location: session.location,
        lastOpenedAt: new Date().toISOString(),
      };
      const rest = get().recentProjects.filter((recent) => locationKey(recent.location) !== key);
      set({ recentStatus: { ...get().recentStatus, [key]: 'ok' } });
      await saveRecents([entry, ...rest].slice(0, MAX_RECENT_PROJECTS));
    };

    const show = async (session: ProjectSession) => {
      get().project?.store.dispose();
      void get().project?.session.flushLocalState();
      set({ project: { session, store: createProjectStore(session) }, pendingInit: null });
      await remember(session);
    };

    /** Runs `job` with `busy` set; failures become `error`. */
    const run = async (job: () => Promise<void>) => {
      set({ busy: true, error: null });
      try {
        await job();
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        set({ busy: false });
      }
    };

    const openFs = async (location: ProjectLocation, fs: ProjectFileSystem) => {
      if (!(await isPigeonProject(fs))) {
        set({ pendingInit: { location, fs, suggestedName: locationFolderName(location) } });
        return;
      }
      await show(await ProjectSession.fromFs(fs, { appState: platform.appState }));
    };

    return {
      recentProjects: [],
      recentStatus: {},
      project: null,
      busy: false,
      error: null,
      notice: null,
      notify: (message) => set({ notice: { id: (get().notice?.id ?? 0) + 1, message } }),
      pendingInit: null,

      loadRecents: async () => {
        const stored = await platform.appState.get<RecentProject[]>('app', RECENT_PROJECTS_KEY);
        const recentProjects = Array.isArray(stored) ? stored : [];
        set({ recentProjects });
        const statuses = await Promise.all(
          recentProjects.map(async (recent) => {
            try {
              return [
                locationKey(recent.location),
                await platform.projects.reopen(recent.location),
              ] as const;
            } catch {
              return [locationKey(recent.location), 'missing'] as const;
            }
          }),
        );
        set({ recentStatus: Object.fromEntries(statuses) });
      },

      openFolder: () =>
        run(async () => {
          const location = await platform.projects.pickProjectFolder();
          if (location) await openFs(location, await platform.openProjectFs(location));
        }),

      createProject: (name) =>
        run(async () => {
          const trimmed = name.trim();
          if (trimmed === '') throw new Error('Enter a project name.');
          const location = await platform.projects.createProject(trimmed);
          if (!location) return;
          const fs = await platform.openProjectFs(location);
          if (!(await isPigeonProject(fs))) await initializeProject(fs, trimmed);
          await show(await ProjectSession.fromFs(fs, { appState: platform.appState }));
        }),

      createWorkspace: (name) =>
        run(async () => {
          const trimmed = name.trim();
          if (trimmed === '') throw new Error('Enter a project name.');
          if (!platform.projects.createBrowserWorkspace) {
            throw new Error('Browser workspaces are not available here.');
          }
          const location = await platform.projects.createBrowserWorkspace(trimmed);
          const fs = await platform.openProjectFs(location);
          await initializeProject(fs, trimmed);
          await show(await ProjectSession.fromFs(fs, { appState: platform.appState }));
        }),

      importProjectZip: () =>
        run(async () => {
          if (!platform.files || !platform.projects.createBrowserWorkspace) {
            throw new Error('Importing a project zip needs browser workspaces.');
          }
          const [picked] = await platform.files.pickFiles({ accept: ['.zip', 'application/zip'] });
          if (!picked) return;
          const contents = readProjectZip(picked.bytes);
          const name =
            contents.projectName || picked.name.replace(/\.zip$/i, '') || 'Imported project';
          const location = await platform.projects.createBrowserWorkspace(name);
          const fs = await platform.openProjectFs(location);
          for (const [path, bytes] of contents.files) await fs.writeFileAtomic(path, bytes);
          await show(await ProjectSession.fromFs(fs, { appState: platform.appState }));
        }),

      exportProjectZip: () =>
        run(async () => {
          const project = get().project;
          if (!project || !platform.files) return;
          const zip = await exportProjectZip(project.session.fs);
          const base = slugify(project.session.name, {
            kind: 'project',
            id: project.session.id || 'export',
          });
          await platform.files.saveFile(`${base}.zip`, zip, 'application/zip');
        }),

      openLocation: (location) =>
        run(async () => openFs(location, await platform.openProjectFs(location))),

      openRecent: (recent) =>
        run(async () => {
          const key = locationKey(recent.location);
          let status = await platform.projects.reopen(recent.location);
          if (status === 'needs-permission' && platform.projects.requestPermission) {
            status = (await platform.projects.requestPermission(recent.location))
              ? 'ok'
              : 'needs-permission';
          }
          set({ recentStatus: { ...get().recentStatus, [key]: status } });
          if (status === 'missing')
            throw new Error(`The folder of "${recent.name}" was moved or deleted.`);
          if (status === 'needs-permission')
            throw new Error(`Pigeon has no access to "${recent.name}". Open the folder again.`);
          await openFs(recent.location, await platform.openProjectFs(recent.location));
        }),

      confirmInit: (name) =>
        run(async () => {
          const pending = get().pendingInit;
          if (!pending) return;
          const trimmed = name.trim() || pending.suggestedName || 'Untitled project';
          await initializeProject(pending.fs, trimmed);
          await show(await ProjectSession.fromFs(pending.fs, { appState: platform.appState }));
        }),

      cancelInit: () => set({ pendingInit: null }),

      closeProject: () => {
        const project = get().project;
        project?.store.dispose();
        void project?.session.flushLocalState();
        set({ project: null });
      },

      forgetRecent: async (recent) => {
        const key = locationKey(recent.location);
        await saveRecents(
          get().recentProjects.filter((entry) => locationKey(entry.location) !== key),
        );
      },

      clearError: () => set({ error: null }),
    };
  });
}
