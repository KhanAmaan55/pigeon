/**
 * One request-editor store per open tab, bound to the project session (PIGN-016), so each tab
 * keeps its own last response, body-mode drafts and in-flight send while others are shown.
 */

import type { ProjectRequest, ProjectSession, Request } from '@pigeon/core';
import type { Platform } from '@pigeon/platform';

import type { ScratchRequestEnvironment } from '../request-editor/scratch-store';
import { createScratchRequestStore } from '../request-editor/scratch-store';
import type { ProjectStore } from '../../stores/project-store';

export type TabEditorStore = ReturnType<typeof createScratchRequestStore>;

const registries = new WeakMap<ProjectSession, Map<string, TabEditorStore>>();
/** The editor view of each project request object (so unchanged requests keep their identity). */
const editorViews = new WeakMap<ProjectRequest, Request>();

/** A project request as the editor model sees it: auth and scripts stay in the file (PIGN-026/031). */
export function toEditorRequest(request: ProjectRequest): Request {
  let view = editorViews.get(request);
  if (!view) {
    const { auth: _auth, events: _events, broken: _broken, ...rest } = request;
    view = rest;
    editorViews.set(request, view);
  }
  return view;
}

export function getTabEditor(
  session: ProjectSession,
  projectStore: ProjectStore,
  requestId: string,
  platform: Pick<Platform, 'transport' | 'capabilities' | 'pickedFiles'>,
  env: ScratchRequestEnvironment,
): TabEditorStore {
  let registry = registries.get(session);
  if (!registry) registries.set(session, (registry = new Map()));
  let editor = registry.get(requestId);
  if (!editor) {
    const read = () => {
      const request = session.findRequest(requestId);
      if (!request) throw new Error(`Request "${requestId}" is not in the project`);
      return toEditorRequest(request);
    };
    editor = createScratchRequestStore(platform, env, {
      read,
      commit: (request) => {
        const { kind: _kind, id: _id, fileKey: _fileKey, ...patch } = request;
        session.apply({ type: 'updateRequest', id: requestId, patch });
        // Editing a preview tab keeps it (docs/ui-ux.md §3.2).
        projectStore.getState().pinTab(requestId);
      },
      subscribe: (listener) =>
        session.onChange(() => {
          if (session.findRequest(requestId)) listener();
        }),
      projectId: session.id,
      projectFs: session.fs,
    });
    registry.set(requestId, editor);
  }
  return editor;
}

/** Drops a closed tab's editor (and cancels its send). */
export function disposeTabEditor(session: ProjectSession, requestId: string): void {
  const registry = registries.get(session);
  registry?.get(requestId)?.dispose();
  registry?.delete(requestId);
}
