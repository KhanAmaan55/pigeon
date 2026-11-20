import type { CommitPlan, ProjectSession } from '@pigeon/core';
import { locateEntity, PROJECT_ENTITY_ID } from '@pigeon/core';
import { AlertTriangle, FileCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DiffView } from '../../components/DiffView/DiffView';
import type { OpenProject } from '../../stores/app-store';
import { useAppStore, useProjectState } from '../../stores/AppStoreProvider';

const decoder = new TextDecoder();

interface PendingEntity {
  id: string;
  name: string;
  kind: 'project' | 'collection' | 'folder' | 'request' | 'environment';
  state: 'unsaved' | 'created' | 'updated' | 'deleted' | 'conflict';
}

/** The project's pending entities: saved drafts and unsaved edits (data-model.md §10). */
function pendingEntities(
  session: ProjectSession,
  changes: Readonly<Record<string, string>>,
): PendingEntity[] {
  const entities: PendingEntity[] = [];
  for (const [id, state] of Object.entries(changes)) {
    if (id === PROJECT_ENTITY_ID) {
      entities.push({
        id,
        name: 'Project (pigeon.json)',
        kind: 'project',
        state: state as PendingEntity['state'],
      });
      continue;
    }
    const environment =
      session.getWorkingModel().environments.find((e) => e.id === id) ??
      session.getBaseModel().environments.find((e) => e.id === id);
    if (environment) {
      entities.push({
        id,
        name: environment.name,
        kind: 'environment',
        state: state as PendingEntity['state'],
      });
      continue;
    }
    const found =
      locateEntity(session.getWorkingModel(), id) ?? locateEntity(session.getBaseModel(), id);
    if (!found) continue;
    entities.push({
      id,
      name: found.entity.name,
      kind: found.entity.kind,
      state: state as PendingEntity['state'],
    });
  }
  return entities.sort((a, b) => a.name.localeCompare(b.name));
}

const BADGES: Record<PendingEntity['state'], { label: string; className: string; title: string }> =
  {
    created: { label: 'A', className: 'text-pass', title: 'Added' },
    updated: { label: 'M', className: 'text-warn', title: 'Modified' },
    deleted: { label: 'D', className: 'text-fail', title: 'Deleted' },
    unsaved: { label: '●', className: 'text-fg-muted', title: 'Unsaved (saved first)' },
    conflict: { label: '!', className: 'text-fail', title: 'Conflict: the file changed on disk' },
  };

/** Files of a plan for the list: renames collapse their delete + write. */
function planRows(
  plan: CommitPlan,
): Array<{ kind: 'A' | 'M' | 'D' | 'R'; path: string; from?: string }> {
  const renamedTo = new Map(plan.renames.map((r) => [r.to, r.from]));
  const renamedFrom = new Set(plan.renames.map((r) => r.from));
  const rows: Array<{ kind: 'A' | 'M' | 'D' | 'R'; path: string; from?: string }> = [];
  for (const write of plan.writes) {
    const from = renamedTo.get(write.path);
    rows.push(
      from
        ? { kind: 'R', path: write.path, from }
        : { kind: write.kind === 'add' ? 'A' : 'M', path: write.path },
    );
  }
  for (const path of plan.deletes) if (!renamedFrom.has(path)) rows.push({ kind: 'D', path });
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

/** Pending Changes (docs/ui-ux.md §3.8): what Save for Commit will write, with per-file diffs. */
export function PendingChanges() {
  const project = useAppStore((s) => s.project);
  if (!project) {
    return <p className="p-4 text-center text-sm text-fg-muted">No project open</p>;
  }
  return <ProjectPendingChanges project={project} />;
}

function ProjectPendingChanges({ project }: { project: OpenProject }) {
  const { session } = project;
  const notify = useAppStore((s) => s.notify);
  const changes = useProjectState((s) => s.changes, null);
  const model = useProjectState((s) => s.model, null);
  const entities = useMemo(() => pendingEntities(session, changes ?? {}), [session, changes]);
  /** Unchecked entities; everything else (including new changes) is selected. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [loadedPlan, setPlan] = useState<CommitPlan | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [loadedDiff, setDiff] = useState<{ path: string; before: string; after: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effective = useMemo(
    () => new Set(entities.map((e) => e.id).filter((id) => !excluded.has(id))),
    [entities, excluded],
  );

  useEffect(() => {
    let cancelled = false;
    if (effective.size === 0) return;
    void session.previewCommit([...effective]).then(
      (next) => !cancelled && setPlan(next),
      (cause: unknown) =>
        !cancelled && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      cancelled = true;
    };
  }, [session, effective, model, changes]);

  useEffect(() => {
    let cancelled = false;
    if (!openFile || !loadedPlan) return;
    const write = loadedPlan.writes.find((w) => w.path === openFile);
    const after = write ? decoder.decode(write.bytes) : '';
    const original = loadedPlan.renames.find((r) => r.to === openFile)?.from ?? openFile;
    void session.fs.readText(original).then(
      (before) => !cancelled && setDiff({ path: openFile, before, after }),
      () => !cancelled && setDiff({ path: openFile, before: '', after }),
    );
    return () => {
      cancelled = true;
    };
  }, [openFile, loadedPlan, session]);

  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcluded(next);
  };

  const commit = async (which: 'selected' | 'all') => {
    setBusy(true);
    setError(null);
    try {
      const { result } = await session.saveForCommit(which === 'all' ? undefined : [...effective]);
      const count = result.written.length + result.deleted.length;
      notify(count === 0 ? 'Nothing to write.' : `Wrote ${count} file${count === 1 ? '' : 's'}.`);
      setOpenFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      for (const id of effective) await session.discard(id);
    } finally {
      setBusy(false);
    }
  };

  if (entities.length === 0) {
    return (
      <div
        data-testid="pending-empty"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-fg-muted"
      >
        <FileCheck size={24} aria-hidden />
        Everything is written to files. Use Git to commit.
      </div>
    );
  }

  // Nothing selected → no plan; the diff belongs to the open file only.
  const plan = effective.size === 0 ? null : loadedPlan;
  const diff = loadedDiff && loadedDiff.path === openFile ? loadedDiff : null;
  const rows = plan ? planRows(plan) : [];
  return (
    <div data-testid="pending-changes" className="flex min-h-0 flex-1 flex-col text-sm">
      <section aria-label="Changes" className="border-b border-border">
        <h3 className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Collections
        </h3>
        <ul className="max-h-60 overflow-y-auto pb-1">
          {entities.map((entity) => (
            <li key={entity.id}>
              <label
                data-testid="pending-changes-item"
                className="flex cursor-default items-center gap-2 px-3 py-0.5 hover:bg-hover"
              >
                <input
                  type="checkbox"
                  checked={effective.has(entity.id)}
                  onChange={() => toggle(entity.id)}
                  aria-label={`Include ${entity.name}`}
                />
                <span
                  title={BADGES[entity.state].title}
                  className={`w-3 shrink-0 font-mono text-[10px] font-bold ${BADGES[entity.state].className}`}
                >
                  {BADGES[entity.state].label}
                </span>
                <span className="min-w-0 flex-1 truncate">{entity.name}</span>
                <span className="text-xs text-fg-muted">{entity.kind}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="File plan" className="flex min-h-0 flex-1 flex-col">
        <h3 className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Files
        </h3>
        <ul className="max-h-48 overflow-y-auto">
          {rows.map((row) => (
            <li key={`${row.kind}:${row.path}`}>
              <button
                type="button"
                data-testid="pending-file"
                data-kind={row.kind}
                onClick={() => setOpenFile(row.kind === 'D' ? null : row.path)}
                className={`flex w-full items-center gap-2 px-3 py-0.5 text-left font-mono text-xs hover:bg-hover ${openFile === row.path ? 'bg-hover' : ''}`}
              >
                <span className="w-3 shrink-0 font-bold">{row.kind}</span>
                <span className="min-w-0 flex-1 truncate">
                  {row.from ? `${row.from} → ${row.path}` : row.path}
                </span>
              </button>
            </li>
          ))}
          {plan && rows.length === 0 && (
            <li className="px-3 py-1 text-xs text-fg-muted">No file changes.</li>
          )}
        </ul>
        {plan?.blocked.map((conflict) => (
          <p
            key={conflict.entityId}
            role="alert"
            data-testid="pending-blocked"
            className="mx-3 mt-1 flex items-start gap-1 text-xs text-fail"
          >
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
            {conflict.path ?? conflict.entityId}:{' '}
            {conflict.reason === 'broken-file'
              ? 'the file could not be read; fix it on disk first.'
              : conflict.reason === 'deleted-on-disk'
                ? 'the file was deleted on disk.'
                : 'the file changed on disk since you saved.'}
          </p>
        ))}
        {plan?.warnings.map((warning) => (
          <p key={warning} data-testid="pending-warning" className="mx-3 mt-1 text-xs text-warn">
            {warning}
          </p>
        ))}
        {diff && (
          <div className="mt-2 min-h-0 flex-1 overflow-auto border-t border-border">
            <DiffView before={diff.before} after={diff.after} />
          </div>
        )}
      </section>
      {error && (
        <p
          role="alert"
          data-testid="pending-error"
          className="border-t border-border px-3 py-1 text-xs text-fail"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-t border-border p-2">
        <button
          type="button"
          data-testid="commit-selected"
          disabled={busy || effective.size === 0 || session.localState === undefined}
          onClick={() => void commit('selected')}
          className="h-7 rounded bg-accent px-2 text-xs font-semibold text-accent-fg disabled:opacity-50"
        >
          Save selected for commit
        </button>
        <button
          type="button"
          data-testid="commit-all"
          disabled={busy || session.localState === undefined}
          onClick={() => void commit('all')}
          className="h-7 rounded border border-border px-2 text-xs hover:bg-hover disabled:opacity-50"
        >
          Save all for commit
        </button>
        <button
          type="button"
          data-testid="discard-selected"
          disabled={busy || effective.size === 0}
          onClick={() => void discard()}
          className="ml-auto h-7 rounded border border-border px-2 text-xs text-fail hover:bg-hover disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
