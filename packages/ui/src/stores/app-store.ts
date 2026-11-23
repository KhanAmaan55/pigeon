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
import { detectFormat, sha256Hex, slugify } from '@pigeon/formats';
import type { PickedFile, Platform, ProjectFileSystem, ProjectLocation } from '@pigeon/platform';
import { createStore } from 'zustand';

import { locationFolderName, locationKey } from './locations';
import type { ProjectStore } from './project-store';
import { createProjectStore } from './project-store';

export const RECENT_PROJECTS_KEY = 'recentProjects';
/** `app` keys: open projects (in tab order) and the active one, restored on restart. */
export const OPEN_PROJECTS_KEY = 'openProjects';
export const ACTIVE_PROJECT_KEY = 'activeProject';
/** `app` key: project id → location key of the first folder seen with it (duplicate detection). */
export const PROJECT_LOCATIONS_KEY = 'projectLocations';
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
  /** `locationKey` of the folder: unique among open projects. */
  key: string;
  session: ProjectSession;
  /** Set for a copy of a project known at another location: that location, for the banner. */
  duplicateOf?: ProjectLocation;
  store: ProjectStore;
  /** `watching`: native watcher; `focus`: re-check on window focus (web, or a watcher failed). */
  changeDetection: 'watching' | 'focus' | 'watch-failed';
  stopWatching: () => void;
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
  /** Open projects, in tab order (PIGN-021). Each has its own session and store. */
  projects: OpenProject[];
  /** The active project (one of `projects`), or `null` while the Welcome panel shows. */
  project: OpenProject | null;
  busy: boolean;
  error: string | null;
  /** A short message for the toast (background results, e.g. "Wrote 3 files"). */
  notice: { id: number; message: string } | null;
  notify: (message: string) => void;
  /** The Web limitations help (PIGN-039), open at a section (`''`: the top), or `null`. */
  help: string | null;
  openHelp: (section?: string) => void;
  closeHelp: () => void;
  /** A picked folder without `pigeon.json`, waiting for "Initialize Pigeon project here?". */
  pendingInit: PendingInit | null;
  loadRecents: () => Promise<void>;
  openFolder: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  /** Web: a new IndexedDB-backed project. */
  createWorkspace: (name: string) => Promise<void>;
  /** Web: a new browser workspace from a project zip the user picks. */
  importProjectZip: () => Promise<void>;
  /** Files waiting in the import dialog of the active project (PIGN-028/030). */
  pendingImport: PickedFile[] | null;
  setPendingImport: (files: PickedFile[] | null) => void;
  /** Picks a file to import into the active project (the import dialog opens). */
  pickImportFile: () => Promise<void>;
  /**
   * Welcome → "Import Postman file": picks a collection, creates a project named after it
   * (asking where on desktop; a browser workspace on the web), then opens the import dialog.
   */
  importIntoNewProject: () => Promise<void>;
  /** Downloads / saves the open project's files as a zip. */
  exportProjectZip: () => Promise<void>;
  openLocation: (location: ProjectLocation) => Promise<void>;
  openRecent: (recent: RecentProject) => Promise<void>;
  confirmInit: (name: string) => Promise<void>;
  cancelInit: () => void;
  /** Closes the active project (or `key`); unsaved edits are lost, drafts stay. */
  closeProject: (key?: string) => void;
  switchProject: (key: string) => void;
  /** Activates the next (`1`) or previous (`-1`) project tab. */
  cycleProject: (delta: 1 | -1) => void;
  /** "+": shows the Welcome panel to open or create another project. */
  showWelcome: () => void;
  forgetRecent: (recent: RecentProject) => Promise<void>;
  clearError: () => void;
}

export type AppStore = ReturnType<typeof createAppStore>;

/** What the import file picker offers. */
const IMPORT_ACCEPT = ['.json', 'application/json', '.txt', '.sh', '.curl', 'text/plain'];

type AppPlatform = Pick<Platform, 'projects' | 'openProjectFs' | 'appState'> &
  Partial<Pick<Platform, 'files' | 'capabilities' | 'secrets' | 'history'>>;

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

    /** Persists the open projects and the active one (`app` namespace). */
    const persistOpen = () => {
      const { projects, project } = get();
      void platform.appState
        .set(
          'app',
          OPEN_PROJECTS_KEY,
          projects.map((p) => p.session.location),
        )
        .catch(() => undefined);
      void platform.appState
        .set('app', ACTIVE_PROJECT_KEY, project?.key ?? null)
        .catch(() => undefined);
    };

    const activate = (key: string | null) => {
      const project = get().projects.find((p) => p.key === key) ?? null;
      set({ project, pendingInit: null });
      persistOpen();
    };

    const dispose = (project: OpenProject) => {
      project.store.dispose();
      project.stopWatching();
      void project.session.flushLocalState();
    };

    /** Adds an opened session as a project tab (or focuses it if that folder is already open). */
    const show = async (session: ProjectSession, duplicateOf?: ProjectLocation) => {
      const key = locationKey(session.location);
      const existing = get().projects.find((p) => p.key === key);
      if (existing) {
        activate(key);
        return;
      }
      // External changes (file-format.md §8): a native watcher where available, else (and if it
      // fails) a re-check whenever the window gets focus.
      const watching = platform.capabilities?.fileWatch === true;
      const stop = watching
        ? session.watch(() => {
            set({
              projects: get().projects.map((p) =>
                p.session === session ? { ...p, changeDetection: 'watch-failed' as const } : p,
              ),
            });
            const active = get().project;
            if (active?.session === session)
              set({ project: get().projects.find((p) => p.key === key) ?? null });
          })
        : null;
      const project: OpenProject = {
        key,
        session,
        store: createProjectStore(session),
        changeDetection: stop ? 'watching' : 'focus',
        stopWatching: stop ?? (() => undefined),
        ...(duplicateOf ? { duplicateOf } : {}),
      };
      set({ projects: [...get().projects, project] });
      activate(key);
      await remember(session);
    };

    /**
     * Local-state key of a project at `location` (file-format.md §6): its id, unless another
     * folder already uses that id — then `<id>@<hash(location)>`, and `duplicateOf` names it.
     */
    const resolveLocalKey = async (projectId: string, location: ProjectLocation) => {
      const key = locationKey(location);
      const owners =
        (await platform.appState.get<Record<string, ProjectLocation>>(
          'app',
          PROJECT_LOCATIONS_KEY,
        )) ?? {};
      const owner = owners[projectId];
      if (!owner) {
        await platform.appState.set('app', PROJECT_LOCATIONS_KEY, {
          ...owners,
          [projectId]: location,
        });
        return { localKey: projectId };
      }
      if (locationKey(owner) === key) return { localKey: projectId };
      const hash = (await sha256Hex(new TextEncoder().encode(key))).slice(0, 8);
      return { localKey: `${projectId}@${hash}`, duplicateOf: owner };
    };

    const openSession = async (fs: ProjectFileSystem) => {
      let duplicateOf: ProjectLocation | undefined;
      const session = await ProjectSession.fromFs(fs, {
        appState: platform.appState,
        ...(platform.secrets ? { secrets: platform.secrets } : {}),
        ...(platform.history ? { history: platform.history } : {}),
        localKey: async (projectId) => {
          const resolved = await resolveLocalKey(projectId, fs.root);
          duplicateOf = resolved.duplicateOf;
          return resolved.localKey;
        },
      });
      await show(session, duplicateOf);
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
      await openSession(fs);
    };

    /** Opens a location unless it is already open (then it is just activated). */
    const openLocation = async (location: ProjectLocation) => {
      const key = locationKey(location);
      if (get().projects.some((p) => p.key === key)) {
        activate(key);
        return;
      }
      await openFs(location, await platform.openProjectFs(location));
    };

    return {
      recentProjects: [],
      recentStatus: {},
      projects: [],
      project: null,
      busy: false,
      error: null,
      notice: null,
      notify: (message) => set({ notice: { id: (get().notice?.id ?? 0) + 1, message } }),
      help: null,
      openHelp: (section = '') => set({ help: section }),
      closeHelp: () => set({ help: null }),
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
        // Reopen the projects that were open at the last exit (PIGN-021), silently.
        if (get().projects.length > 0) return;
        const open =
          (await platform.appState.get<ProjectLocation[]>('app', OPEN_PROJECTS_KEY)) ?? [];
        const active = await platform.appState.get<string | null>('app', ACTIVE_PROJECT_KEY);
        for (const location of Array.isArray(open) ? open : []) {
          try {
            if ((await platform.projects.reopen(location)) !== 'ok') continue;
            const fs = await platform.openProjectFs(location);
            if (await isPigeonProject(fs)) await openSession(fs);
          } catch {
            // A folder that can't be reopened stays in the recent list with its status.
          }
        }
        if (get().projects.length > 0) {
          activate(get().projects.some((p) => p.key === active) ? active! : get().projects[0]!.key);
        }
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
          await openSession(fs);
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
          await openSession(fs);
        }),

      pendingImport: null,
      setPendingImport: (files) => set({ pendingImport: files && files.length > 0 ? files : null }),

      pickImportFile: async () => {
        if (!platform.files) return;
        const picked = await platform.files.pickFiles({ accept: IMPORT_ACCEPT, multiple: true });
        if (picked.length > 0) set({ pendingImport: picked });
      },

      importIntoNewProject: () =>
        run(async () => {
          if (!platform.files) throw new Error('Importing files is not available here.');
          const [picked] = await platform.files.pickFiles({ accept: IMPORT_ACCEPT });
          if (!picked) return;
          const detected = detectFormat(picked.bytes);
          if (detected.kind !== 'postman-collection') {
            throw new Error(
              detected.kind === 'rejected' || detected.kind === 'unknown'
                ? detected.message
                : 'Choose a Postman collection (v2.1 or v2.0).',
            );
          }
          const info = detected.data['info'];
          const name =
            (typeof info === 'object' &&
            info !== null &&
            typeof (info as { name?: unknown }).name === 'string'
              ? (info as { name: string }).name
              : '') ||
            picked.name.replace(/\.(postman_collection\.)?json$/i, '') ||
            'Imported project';
          let location: ProjectLocation | null;
          if (platform.capabilities?.projectFolders !== 'none') {
            location = await platform.projects.createProject(name);
          } else if (platform.projects.createBrowserWorkspace) {
            location = await platform.projects.createBrowserWorkspace(name);
          } else {
            throw new Error('This browser cannot store projects.');
          }
          if (!location) return;
          const fs = await platform.openProjectFs(location);
          if (!(await isPigeonProject(fs))) await initializeProject(fs, name);
          await openSession(fs);
          set({ pendingImport: [picked] });
        }),

      importProjectZip: () =>
        run(async () => {
          if (!platform.files || !platform.projects.createBrowserWorkspace) {
            throw new Error('Importing a project zip needs browser workspaces.');
          }
          const [picked] = await platform.files.pickFiles({ accept: ['.zip', 'application/zip'] });
          if (!picked) return;
          const contents = await readProjectZip(picked.bytes);
          const name =
            contents.projectName || picked.name.replace(/\.zip$/i, '') || 'Imported project';
          const location = await platform.projects.createBrowserWorkspace(name);
          const fs = await platform.openProjectFs(location);
          for (const [path, bytes] of contents.files) await fs.writeFileAtomic(path, bytes);
          await openSession(fs);
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

      openLocation: (location) => run(() => openLocation(location)),

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
          await openLocation(recent.location);
        }),

      confirmInit: (name) =>
        run(async () => {
          const pending = get().pendingInit;
          if (!pending) return;
          const trimmed = name.trim() || pending.suggestedName || 'Untitled project';
          await initializeProject(pending.fs, trimmed);
          await openSession(pending.fs);
        }),

      cancelInit: () => set({ pendingInit: null }),

      closeProject: (key) => {
        const { projects, project } = get();
        const target = projects.find((p) => p.key === (key ?? project?.key));
        if (!target) return;
        dispose(target);
        const index = projects.indexOf(target);
        const rest = projects.filter((p) => p !== target);
        set({ projects: rest });
        const next =
          project === target
            ? (rest[Math.min(index, rest.length - 1)]?.key ?? null)
            : (project?.key ?? null);
        activate(next);
      },

      switchProject: (key) => activate(key),

      cycleProject: (delta) => {
        const { projects, project } = get();
        if (projects.length === 0) return;
        const index = projects.findIndex((p) => p === project);
        const next = projects[(index + delta + projects.length) % projects.length]!;
        activate(next.key);
      },

      showWelcome: () => activate(null),

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
