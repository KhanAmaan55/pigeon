import { GLOBALS_ENTITY_ID, PIGEON_VERSION } from '@pigeon/core';
import { exportEnvironment, exportGlobals } from '@pigeon/formats';
import { Download, FileInput, Globe, Plus, Variable } from 'lucide-react';
import { ContextMenu } from 'radix-ui';
import { useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import { IconButton } from '../../components/IconButton';
import type { OpenProject } from '../../stores/app-store';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';
import { disposeTabEditor } from '../tabs/editor-registry';

const BADGES: Record<string, { label: string; className: string }> = {
  created: { label: 'A', className: 'text-pass' },
  updated: { label: 'M', className: 'text-warn' },
  deleted: { label: 'D', className: 'text-fail' },
  conflict: { label: '!', className: 'text-fail' },
};

/** Environments view (docs/ui-ux.md §3.4): the project's environments; each opens in a tab. */
export function EnvironmentsView() {
  const project = useAppStore((s) => s.project);
  if (!project) return <p className="p-4 text-center text-sm text-fg-muted">No project open</p>;
  return <ProjectEnvironments project={project} />;
}

function ProjectEnvironments({ project }: { project: OpenProject }) {
  const { session, store } = project;
  const { files } = usePlatform();
  const notify = useAppStore((s) => s.notify);
  const pickImportFile = useAppStore((s) => s.pickImportFile);
  const model = useProjectState((s) => s.model, null);
  const changes = useProjectState((s) => s.changes, null);
  const selected = useProjectState((s) => s.selectedEnvironmentId, null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Deleted (saved) environments stay listed, struck through, until committed.
  const deleted = session
    .getBaseModel()
    .environments.filter(
      (e) => changes?.[e.id] === 'deleted' && !model?.environments.some((w) => w.id === e.id),
    );
  const environments = [...(model?.environments ?? []), ...deleted];

  const edit = (action: () => void) => {
    try {
      setError(null);
      action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  /** Postman environment / globals file: shared values only (PIGN-030). */
  const saveExport = (result: { data: unknown; fileName: string }) => {
    void files
      .saveFile(result.fileName, `${JSON.stringify(result.data, null, '\t')}\n`, 'application/json')
      .then(
        (outcome) => outcome === 'saved' && notify(`Exported ${result.fileName}.`),
        (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
      );
  };
  const globals = model?.globals;

  const create = () =>
    edit(() => {
      const id = crypto.randomUUID();
      session.apply({ type: 'createEnvironment', id, name: 'New Environment' });
      store.getState().openTab(id, { pin: true });
      setRenaming(id);
    });

  return (
    <div data-testid="environments-view" className="flex min-h-0 flex-1 flex-col text-sm">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
          {environments.length} environment{environments.length === 1 ? '' : 's'}
        </span>
        <IconButton
          label="Import Postman environments (Ctrl/⌘ O)"
          icon={<FileInput size={14} />}
          data-testid="environments-import"
          disabled={session.readOnly}
          onClick={() => void pickImportFile()}
        />
        <IconButton
          label="New environment"
          icon={<Plus size={14} />}
          data-testid="new-environment"
          disabled={session.readOnly}
          onClick={create}
        />
      </div>
      {error && (
        <p role="alert" className="border-b border-border bg-fail/10 px-3 py-1 text-xs">
          {error}
        </p>
      )}
      {environments.length === 0 && (
        <p className="p-3 text-fg-muted">
          No environments yet. Environments hold variables like the base URL per stage.
        </p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        <li
          data-testid="globals-item"
          onClick={() => store.getState().openTab(GLOBALS_ENTITY_ID, { pin: true })}
          className="flex cursor-default items-center gap-2 border-b border-border px-3 py-1 hover:bg-hover"
        >
          <Globe size={14} className="shrink-0 text-fg-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Globals</span>
          {globals && (
            <button
              type="button"
              data-testid="globals-export"
              aria-label="Export globals as a Postman globals file"
              title="Export as a Postman globals file"
              onClick={(event) => {
                event.stopPropagation();
                saveExport(exportGlobals(globals, { version: PIGEON_VERSION }));
              }}
              className="rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Download size={12} aria-hidden />
            </button>
          )}
          {changes?.[GLOBALS_ENTITY_ID] &&
            changes[GLOBALS_ENTITY_ID] !== 'unsaved' &&
            BADGES[changes[GLOBALS_ENTITY_ID]] && (
              <span
                className={`font-mono text-[10px] font-bold ${BADGES[changes[GLOBALS_ENTITY_ID]]!.className}`}
              >
                {BADGES[changes[GLOBALS_ENTITY_ID]]!.label}
              </span>
            )}
        </li>
        {environments.map((environment) => {
          const change = changes?.[environment.id];
          return (
            <ContextMenu.Root key={environment.id}>
              <ContextMenu.Trigger asChild>
                <li
                  data-testid="environment-item"
                  data-selected={environment.id === selected || undefined}
                  data-deleted={change === 'deleted' || undefined}
                  onClick={() => change !== 'deleted' && store.getState().openTab(environment.id)}
                  onDoubleClick={() =>
                    change !== 'deleted' && store.getState().openTab(environment.id, { pin: true })
                  }
                  className="flex cursor-default items-center gap-2 px-3 py-1 hover:bg-hover"
                >
                  <Variable size={14} className="shrink-0 text-fg-muted" aria-hidden />
                  {renaming === environment.id ? (
                    <input
                      aria-label="Environment name"
                      data-testid="environment-rename-input"
                      autoFocus
                      defaultValue={environment.name}
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setRenaming(null);
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                      onBlur={(event) => {
                        const name = event.currentTarget.value;
                        setRenaming(null);
                        if (name.trim() && name !== environment.name) {
                          edit(() =>
                            session.apply({ type: 'renameEnvironment', id: environment.id, name }),
                          );
                        }
                      }}
                      className="h-6 min-w-0 flex-1 rounded-sm border border-accent bg-bg px-1"
                    />
                  ) : (
                    <span
                      className={`min-w-0 flex-1 truncate ${change === 'unsaved' ? 'italic' : ''}`}
                    >
                      {environment.name}
                    </span>
                  )}
                  {environment.id === selected && (
                    <span className="text-xs text-accent">active</span>
                  )}
                  {change && change !== 'unsaved' && BADGES[change] && (
                    <span
                      data-testid="environment-badge"
                      className={`font-mono text-[10px] font-bold ${BADGES[change].className}`}
                    >
                      {BADGES[change].label}
                    </span>
                  )}
                  {change === 'unsaved' && (
                    <span aria-label="(unsaved)" className="size-1.5 rounded-full bg-fg-muted" />
                  )}
                </li>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  className="z-50 min-w-40 rounded-md border border-border bg-surface-raised p-1 text-sm shadow-lg"
                >
                  {[
                    [
                      'Use this environment',
                      'env-menu-select',
                      () => session.selectEnvironment(environment.id),
                    ],
                    ['Rename', 'env-menu-rename', () => setRenaming(environment.id)],
                    [
                      'Export as Postman environment…',
                      'env-menu-export',
                      () => saveExport(exportEnvironment(environment, { version: PIGEON_VERSION })),
                    ],
                    [
                      'Duplicate',
                      'env-menu-duplicate',
                      () =>
                        edit(() =>
                          session.apply({
                            type: 'duplicateEnvironment',
                            id: environment.id,
                            newId: crypto.randomUUID(),
                          }),
                        ),
                    ],
                    [
                      'Delete',
                      'env-menu-delete',
                      () =>
                        edit(() => {
                          session.apply({ type: 'deleteEnvironment', id: environment.id });
                          store.getState().closeTab(environment.id);
                          disposeTabEditor(session, environment.id);
                        }),
                    ],
                  ].map(([label, testId, onSelect]) => (
                    <ContextMenu.Item
                      key={testId as string}
                      data-testid={testId as string}
                      disabled={
                        session.readOnly &&
                        testId !== 'env-menu-select' &&
                        testId !== 'env-menu-export'
                      }
                      onSelect={onSelect as () => void}
                      className="cursor-default rounded px-2 py-1 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover"
                    >
                      {label as string}
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </ul>
    </div>
  );
}
