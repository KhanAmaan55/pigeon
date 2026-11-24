import type { CommitPlan, ProjectSession } from '@pigeon/core';
import { GLOBALS_ENTITY_ID, locateEntity, PROJECT_ENTITY_ID } from '@pigeon/core';
import { AlertTriangle, FileCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DiffView } from '../../components/DiffView/DiffView';
import type { Tone } from '../../components/ui';
import { Badge, Button, Callout, Checkbox, EmptyState, SectionLabel } from '../../components/ui';
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
    if (id === GLOBALS_ENTITY_ID) {
      entities.push({
        id,
        name: 'Globals',
        kind: 'environment',
        state: state as PendingEntity['state'],
      });
      continue;
    }
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

const BADGES: Record<PendingEntity['state'], { label: string; tone: Tone; title: string }> = {
  created: { label: 'A', tone: 'pass', title: 'Added' },
  updated: { label: 'M', tone: 'warn', title: 'Modified' },
  deleted: { label: 'D', tone: 'fail', title: 'Deleted' },
  unsaved: { label: '●', tone: 'neutral', title: 'Unsaved (saved first)' },
  conflict: { label: '!', tone: 'fail', title: 'Conflict: the file changed on disk' },
};

/** Badge tone of a file-plan row's change letter. */
const FILE_TONES: Record<'A' | 'M' | 'D' | 'R', Tone> = {
  A: 'pass',
  M: 'warn',
  D: 'fail',
  R: 'info',
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
    return <EmptyState title="No project open" />;
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
      <EmptyState
        data-testid="pending-empty"
        icon={<FileCheck aria-hidden />}
        title="Everything is written to files. Use Git to commit."
      />
    );
  }

  // Nothing selected → no plan; the diff belongs to the open file only.
  const plan = effective.size === 0 ? null : loadedPlan;
  const diff = loadedDiff && loadedDiff.path === openFile ? loadedDiff : null;
  const rows = plan ? planRows(plan) : [];
  return (
    <div data-testid="pending-changes" className="flex min-h-0 flex-1 flex-col text-sm">
      <section aria-label="Changes" className="border-b border-border">
        <SectionLabel className="px-4 pt-3 pb-1">
          <h3>Collections</h3>
        </SectionLabel>
        <ul className="max-h-60 overflow-y-auto px-1.5 pb-2">
          {entities.map((entity) => (
            <li key={entity.id}>
              <label
                data-testid="pending-changes-item"
                className="flex h-7 cursor-default items-center gap-2 rounded px-2.5 hover:bg-hover"
              >
                <Checkbox
                  checked={effective.has(entity.id)}
                  onChange={() => toggle(entity.id)}
                  aria-label={`Include ${entity.name}`}
                />
                <Badge
                  title={BADGES[entity.state].title}
                  tone={BADGES[entity.state].tone}
                  className="font-mono"
                >
                  {BADGES[entity.state].label}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{entity.name}</span>
                <span className="text-xs text-fg-muted">{entity.kind}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="File plan" className="flex min-h-0 flex-1 flex-col">
        <SectionLabel className="px-4 pt-3 pb-1">
          <h3>Files</h3>
        </SectionLabel>
        <ul className="max-h-48 overflow-y-auto px-1.5">
          {rows.map((row) => (
            <li key={`${row.kind}:${row.path}`}>
              <button
                type="button"
                data-testid="pending-file"
                data-kind={row.kind}
                onClick={() => setOpenFile(row.kind === 'D' ? null : row.path)}
                className={`flex h-7 w-full items-center gap-2 rounded px-2.5 text-left font-mono text-xs ${openFile === row.path ? 'bg-selected text-fg' : 'hover:bg-hover'}`}
              >
                <Badge tone={FILE_TONES[row.kind]} className="font-mono">
                  {row.kind}
                </Badge>
                <span className="min-w-0 flex-1 truncate">
                  {row.from ? `${row.from} → ${row.path}` : row.path}
                </span>
              </button>
            </li>
          ))}
          {plan && rows.length === 0 && (
            <li className="px-2.5 py-1 text-xs text-fg-muted">No file changes.</li>
          )}
        </ul>
        {plan?.blocked.map((conflict) => (
          <Callout
            key={conflict.entityId}
            role="alert"
            data-testid="pending-blocked"
            tone="fail"
            icon={<AlertTriangle size={12} className="mt-0.5 shrink-0 text-fail" aria-hidden />}
            className="mx-4 mt-2"
          >
            <p className="text-xs text-fail">
              {conflict.path ?? conflict.entityId}:{' '}
              {conflict.reason === 'broken-file'
                ? 'the file could not be read; fix it on disk first.'
                : conflict.reason === 'deleted-on-disk'
                  ? 'the file was deleted on disk.'
                  : 'the file changed on disk since you saved.'}
            </p>
          </Callout>
        ))}
        {plan?.warnings.map((warning) => (
          <Callout key={warning} data-testid="pending-warning" tone="warn" className="mx-4 mt-2">
            <p className="text-xs text-warn">{warning}</p>
          </Callout>
        ))}
        {diff && (
          <div className="mt-3 min-h-0 flex-1 overflow-auto border-t border-border">
            <DiffView before={diff.before} after={diff.after} />
          </div>
        )}
      </section>
      {error && (
        <p
          role="alert"
          data-testid="pending-error"
          className="border-t border-border px-4 py-1.5 text-xs text-fail"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-t border-border p-3">
        <Button
          size="sm"
          variant="primary"
          data-testid="commit-selected"
          disabled={busy || effective.size === 0 || session.localState === undefined}
          onClick={() => void commit('selected')}
        >
          Save selected for commit
        </Button>
        <Button
          size="sm"
          data-testid="commit-all"
          disabled={busy || session.localState === undefined}
          onClick={() => void commit('all')}
        >
          Save all for commit
        </Button>
        <Button
          size="sm"
          variant="danger"
          data-testid="discard-selected"
          disabled={busy || effective.size === 0}
          onClick={() => void discard()}
          className="ml-auto"
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
