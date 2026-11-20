/**
 * App-wide state (docs/architecture.md §8): the open project and recent projects. Recent
 * projects persist in `AppStateStore` (`app` / `recentProjects`), so they survive restarts.
 * Multiple open projects arrive with PIGN-021.
 */

import { initializeProject, isPigeonProject, ProjectSession } from '@pigeon/core';
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
  /** A picked folder without `pigeon.json`, waiting for "Initialize Pigeon project here?". */
  pendingInit: PendingInit | null;
  loadRecents: () => Promise<void>;
  openFolder: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  openLocation: (location: ProjectLocation) => Promise<void>;
  openRecent: (recent: RecentProject) => Promise<void>;
  confirmInit: (name: string) => Promise<void>;
  cancelInit: () => void;
  closeProject: () => void;
  forgetRecent: (recent: RecentProject) => Promise<void>;
  clearError: () => void;
}

export type AppStore = ReturnType<typeof createAppStore>;

type AppPlatform = Pick<Platform, 'projects' | 'openProjectFs' | 'appState'>;

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
      await show(await ProjectSession.fromFs(fs));
    };

    return {
      recentProjects: [],
      recentStatus: {},
      project: null,
      busy: false,
      error: null,
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
          await show(await ProjectSession.fromFs(fs));
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
          await show(await ProjectSession.fromFs(pending.fs));
        }),

      cancelInit: () => set({ pendingInit: null }),

      closeProject: () => {
        get().project?.store.dispose();
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
