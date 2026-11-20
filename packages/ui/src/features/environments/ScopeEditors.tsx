import type { ProjectSession } from '@pigeon/core';
import { findContainer, GLOBALS_ENTITY_ID, hasScripts, inheritedAuth } from '@pigeon/core';

import { useProjectState } from '../../stores/AppStoreProvider';
import { AuthEditor } from '../auth/AuthEditor';
import { ScriptsEditor } from '../scripts/ScriptsEditor';
import { moveToSecret } from '../tabs/editor-registry';
import { VariablesEditor } from './EnvironmentEditor';

/** Postman collection variable types, plus "secret" for masking. */
const CONTAINER_TYPES = [
  { value: '', label: 'default' },
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'any', label: 'any' },
  { value: 'secret', label: 'secret' },
];

/** Project globals (the lowest-precedence scope); the first variable creates the globals file. */
export function GlobalsEditor({ session }: { session: ProjectSession }) {
  const globals = useProjectState((s) => s.model.globals, undefined);
  return (
    <VariablesEditor
      session={session}
      title="Globals"
      file="environments/globals.postman_globals.json"
      values={globals?.values ?? []}
      onChange={(values) => session.apply({ type: 'setGlobals', values })}
      scope="globals"
      readOnly={session.readOnly}
      testId="globals-editor"
    />
  );
}

/** A collection's (or folder's) settings tab: its variables, used by everything inside it. */
export function ContainerSettings({
  session,
  containerId,
}: {
  session: ProjectSession;
  containerId: string;
}) {
  useProjectState((s) => s.model, null);
  const container = findContainer(session.getWorkingModel(), containerId);
  if (!container) return null;
  const kind = container.kind === 'collection' ? 'collection' : 'folder';
  const readOnly = session.readOnly || container.broken === true;
  const file =
    session.itemFilePath(containerId) ??
    (kind === 'collection' ? `collections/${container.fileKey}/collection.json` : '');
  return (
    <div data-testid="container-settings" className="flex h-full min-h-0 flex-col">
      {container.description && (
        <p className="shrink-0 border-b border-border px-3 py-2 text-sm text-fg-muted">
          {typeof container.description === 'string'
            ? container.description
            : container.description.content}
        </p>
      )}
      <section
        aria-label={`${kind} auth`}
        data-testid="container-auth"
        className="shrink-0 border-b border-border"
      >
        <h2 className="px-3 pt-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Auth
        </h2>
        <AuthEditor
          auth={container.auth}
          onChange={(auth) => session.apply({ type: 'setContainerAuth', id: containerId, auth })}
          level={kind}
          inherited={inheritedAuth(session.getWorkingModel(), containerId)}
          moveToSecret={(name, value) => moveToSecret(session, name, value)}
          readOnly={readOnly}
        />
      </section>
      <details data-testid="container-scripts" className="shrink-0 border-b border-border">
        <summary className="cursor-default px-3 py-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Scripts{hasScripts(container.events) ? ' ·  JS' : ''}
        </summary>
        <ScriptsEditor
          events={container.events}
          onChange={(events) =>
            session.apply({ type: 'setContainerEvents', id: containerId, events })
          }
          readOnly={readOnly}
          editorClassName="h-32"
        />
      </details>
      <div className="min-h-0 flex-1">
        <VariablesEditor
          session={session}
          title={`${container.name} · ${kind} variables`}
          file={file}
          values={container.variables}
          onChange={(values) =>
            session.apply({ type: 'setContainerVariables', id: containerId, values })
          }
          scope={`${kind}:${containerId}`}
          readOnly={readOnly}
          types={CONTAINER_TYPES}
          testId="collection-variables-editor"
        />
      </div>
      <p className="shrink-0 border-t border-border px-3 py-1.5 text-xs text-fg-muted">
        Requests inside use this auth when set to "Inherit from parent". Variable precedence:
        environment › folders › collection › globals.
      </p>
    </div>
  );
}

export { GLOBALS_ENTITY_ID };
