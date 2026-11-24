import { GLOBALS_ENTITY_ID, PIGEON_VERSION } from '@pigeon/core';
import { exportEnvironment, exportGlobals } from '@pigeon/formats';
import { Download, FileInput, Globe, Plus, Variable } from 'lucide-react';
import { ContextMenu } from 'radix-ui';
import { useState } from 'react';

import { usePlatform } from '../../app/PlatformProvider';
import { IconButton } from '../../components/IconButton';
import { Badge, Callout, cx, EmptyState, menu } from '../../components/ui';
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
  if (!project) return <EmptyState title="No project open" />;
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
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3">
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
        <Callout role="alert" tone="fail" className="m-2">
          {error}
        </Callout>
      )}
      {environments.length === 0 && (
        <p className="px-4 py-3 text-fg-muted">
          No environments yet. Environments hold variables like the base URL per stage.
        </p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <li
          data-testid="globals-item"
          onClick={() => store.getState().openTab(GLOBALS_ENTITY_ID, { pin: true })}
          className="group mb-1 flex h-7 cursor-default items-center gap-2 rounded px-2 transition-colors hover:bg-hover"
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
              className="flex size-5 items-center justify-center rounded text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-border hover:text-fg focus-visible:opacity-100"
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
                  className={cx(
                    'flex h-7 cursor-default items-center gap-2 rounded px-2 transition-colors',
                    environment.id === selected ? 'bg-selected' : 'hover:bg-hover',
                  )}
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
                      className="h-6 min-w-0 flex-1 rounded border border-accent bg-bg px-1.5 ring-3 ring-focus outline-none"
                    />
                  ) : (
                    <span
                      className={`min-w-0 flex-1 truncate ${change === 'unsaved' ? 'italic' : ''}`}
                    >
                      {environment.name}
                    </span>
                  )}
                  {environment.id === selected && <Badge tone="accent">active</Badge>}
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
                  className={menu.content}
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
                      className={testId === 'env-menu-delete' ? menu.danger : menu.item}
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
