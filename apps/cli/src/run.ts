/**
 * `pigeon run` (PIGN-054, docs/cli.md): sends a project's collections or a folder with one
 * environment and compares every response with its baseline — the same core code as the apps'
 * runner (`runRegression`, `executeProjectRequest`, `compareProjectResult`).
 *
 * The project is read-only (`ReadOnlyFs`); local app state and secrets are in memory and start
 * empty, so secrets come only from `--var`, `PIGEON_VAR_<key>` or an `--env` file.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ComparisonOutcome, ProjectModel, RunReport, RunTarget } from '@pigeon/core';
import {
  compareProjectResult,
  createQuickJsRunner,
  DEFAULT_PREFERENCES,
  executeProjectRequest,
  findContainer,
  maskSecrets,
  ProjectSession,
  RequestExecutor,
  runRegression,
  runTargets,
} from '@pigeon/core';
import { importPostmanEnvironment } from '@pigeon/formats';
import type { Transport } from '@pigeon/platform';
import { MemoryAppState, MemorySecretStore } from '@pigeon/platform';
import { NODE_CAPABILITIES, NodeFs, NodeTransport } from '@pigeon/platform-node';

import type { RunArgs } from './args';
import { UsageError } from './args';
import { ReadOnlyFs } from './readonly-fs';
import type { EntryDetail } from './reporters';
import { createPrettyReporter, renderJson, renderJunit } from './reporters';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  /** ANSI colours on stdout. */
  color: boolean;
  writeFile(path: string, text: string): Promise<void>;
  /** Tests inject a transport; `NodeTransport` otherwise. */
  transport?: Transport;
}

export const VAR_PREFIX = 'PIGEON_VAR_';
/** The in-memory environment holding `--var` values when no `--env` is given. */
const CLI_ENVIRONMENT_ID = 'pigeon-cli';

/** Opens a project folder read-only, with empty in-memory local state and secrets. */
export async function openProject(dir: string): Promise<ProjectSession> {
  const info = await stat(resolve(dir, 'pigeon.json')).catch(() => null);
  if (!info?.isFile()) throw new UsageError(`${dir} is not a Pigeon project (no pigeon.json).`);
  return ProjectSession.fromFs(new ReadOnlyFs(new NodeFs(dir)), {
    appState: new MemoryAppState(),
    secrets: new MemorySecretStore(),
  });
}

interface Scope {
  report: RunReport['scope'];
  /** `Collection/Folder/…`, for JUnit class names. */
  path: string;
}

const sameName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

function describeChoices(names: string[]): string {
  return names.length === 0 ? 'none' : names.map((n) => `"${n}"`).join(', ');
}

/** The collections and folders to run, from `--collection` and `--folder`. */
export function resolveScopes(
  model: ProjectModel,
  args: Pick<RunArgs, 'collection' | 'folder'>,
): Scope[] {
  const collections = model.collections.filter((c) => !c.broken);
  let candidates = collections;
  if (args.collection !== undefined) {
    const wanted = args.collection;
    const byId = collections.filter((c) => c.id === wanted);
    candidates = byId.length > 0 ? byId : collections.filter((c) => sameName(c.name, wanted));
    if (candidates.length === 0) {
      throw new UsageError(
        `No collection "${wanted}". Collections: ${describeChoices(collections.map((c) => c.name))}.`,
      );
    }
    if (candidates.length > 1) {
      throw new UsageError(`More than one collection is named "${wanted}"; use its id.`);
    }
  }
  if (args.folder === undefined) {
    return candidates.map((c) => ({
      report: { kind: 'collection', id: c.id, name: c.name },
      path: c.name,
    }));
  }
  const folder = args.folder;
  const byId = findContainer(model, folder);
  if (byId && !collections.some((c) => c.id === byId.id)) {
    const owner = candidates.find((c) => findContainer({ ...model, collections: [c] }, folder));
    if (owner)
      return [
        {
          report: { kind: 'folder', id: byId.id, name: byId.name },
          path: `${owner.name}/${byId.name}`,
        },
      ];
  }
  const parts = folder.split('/').filter((p) => p !== '');
  const matches: Scope[] = [];
  for (const collection of candidates) {
    let children = collection.children;
    let found: { id: string; name: string } | undefined;
    const names = [collection.name];
    for (const part of parts) {
      const next = children.find((item) => item.kind === 'folder' && sameName(item.name, part));
      if (!next || next.kind !== 'folder') {
        found = undefined;
        break;
      }
      found = next;
      names.push(next.name);
      children = next.children;
    }
    if (found)
      matches.push({
        report: { kind: 'folder', id: found.id, name: found.name },
        path: names.join('/'),
      });
  }
  if (matches.length === 0)
    throw new UsageError(
      `No folder "${folder}"${args.collection ? ` in "${args.collection}"` : ''}.`,
    );
  if (matches.length > 1) {
    throw new UsageError(
      `"${folder}" is in more than one collection (${matches.map((m) => m.path).join(', ')}); add --collection.`,
    );
  }
  return matches;
}

interface Override {
  value: string;
  /** From `PIGEON_VAR_*`: always a secret (masked). */
  secret: boolean;
}

export function collectOverrides(env: CliIo['env'], vars: RunArgs['vars']): Map<string, Override> {
  const overrides = new Map<string, Override>();
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith(VAR_PREFIX) && name.length > VAR_PREFIX.length && value !== undefined) {
      overrides.set(name.slice(VAR_PREFIX.length), { value, secret: true });
    }
  }
  for (const [key, value] of vars) {
    overrides.set(key, { value, secret: overrides.get(key)?.secret ?? false });
  }
  return overrides;
}

/** Selects `--env` (a project environment, or a file loaded in memory) and applies overrides. */
async function prepareEnvironment(
  session: ProjectSession,
  args: RunArgs,
  io: CliIo,
  overrides: Map<string, Override>,
): Promise<RunReport['environment']> {
  const model = session.getWorkingModel();
  let environment: RunReport['environment'] = null;
  if (args.env !== undefined) {
    const wanted = args.env;
    const usable = model.environments.filter((e) => !e.broken);
    const found =
      usable.find((e) => e.id === wanted) ?? usable.find((e) => sameName(e.name, wanted));
    if (found) {
      environment = { id: found.id, name: found.name };
    } else {
      const file = resolve(io.cwd, wanted);
      const text = await readFile(file, 'utf8').catch(() => null);
      if (text === null) {
        throw new UsageError(
          `No environment "${wanted}" in the project and no such file. Environments: ${describeChoices(usable.map((e) => e.name))}.`,
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new UsageError(`${wanted} is not valid JSON.`);
      }
      if (
        typeof json !== 'object' ||
        json === null ||
        !Array.isArray((json as { values?: unknown }).values)
      ) {
        throw new UsageError(
          `${wanted} is not an environment file (it needs "name" and "values").`,
        );
      }
      const imported = importPostmanEnvironment(json as Record<string, never>, {
        existingIds: new Set(model.environments.map((e) => e.id)),
      });
      session.apply({
        type: 'createEnvironment',
        id: imported.environment.id,
        name: imported.environment.name,
        values: imported.values,
      });
      for (const [key, value] of Object.entries(imported.currentValues)) {
        session.setCurrentValue(`env:${imported.environment.id}`, key, value);
      }
      environment = { id: imported.environment.id, name: imported.environment.name };
    }
  }
  if (overrides.size > 0) {
    let id = environment?.id;
    if (!id) {
      session.apply({
        type: 'createEnvironment',
        id: CLI_ENVIRONMENT_ID,
        name: 'Command line',
        values: [],
      });
      id = CLI_ENVIRONMENT_ID;
    }
    const values = [...session.findEnvironment(id)!.values];
    for (const [key, override] of overrides) {
      const at = values.findIndex((v) => v.key === key && v.enabled);
      if (at === -1) {
        values.push({
          key,
          value: '',
          type: override.secret ? 'secret' : 'default',
          enabled: true,
        });
      } else if (override.secret && values[at]!.type !== 'secret') {
        values[at] = { ...values[at]!, type: 'secret' };
      }
    }
    session.apply({ type: 'setEnvironmentValues', id, values });
    for (const [key, override] of overrides)
      session.setCurrentValue(`env:${id}`, key, override.value);
    // The run resolves against this environment; the report names the one the user chose.
    return environment ?? { id: CLI_ENVIRONMENT_ID, name: 'Command line' };
  }
  return environment;
}

export interface RunOutcome {
  reports: RunReport[];
  exitCode: 0 | 1;
}

export async function runCommand(args: RunArgs, io: CliIo): Promise<RunOutcome> {
  const dir = resolve(io.cwd, args.projectDir);
  const session = await openProject(dir);
  const errors = session.problems.filter((p) => p.severity === 'error');
  if (errors.length > 0) {
    io.stderr(
      `warning: ${errors.length} project file${errors.length === 1 ? '' : 's'} could not be read; ` +
        'requests in them are not run (see pigeon validate).\n',
    );
  }
  const scopes = resolveScopes(session.getWorkingModel(), args);
  const overrides = collectOverrides(io.env, args.vars);
  const environment = await prepareEnvironment(session, args, io, overrides);
  const shownEnvironment = args.env === undefined ? null : environment;
  const envSecrets = [...overrides.values()].filter((o) => o.secret).map((o) => o.value);

  const executor = new RequestExecutor(io.transport ?? new NodeTransport());
  const scriptRunner = createQuickJsRunner();
  const preferences = {
    ...DEFAULT_PREFERENCES,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  };
  const toFile = args.out !== undefined;
  const pretty =
    !toFile && args.reporter !== 'pretty'
      ? null
      : createPrettyReporter({ write: io.stdout, color: io.color });

  const reports: RunReport[] = [];
  const details = new Map<string, EntryDetail>();
  for (const scope of scopes) {
    const model = session.getWorkingModel();
    const targets = runTargets(model, scope.report.id);
    const secretsOf = new Map<string, readonly string[]>();
    const mask = (requestId: string, text: string) =>
      maskSecrets(text, [...(secretsOf.get(requestId) ?? []), ...envSecrets]);
    pretty?.scope(scope.report, shownEnvironment, targets.length);
    const generator = runRegression(
      targets,
      {
        execute: (target: RunTarget, signal: AbortSignal) =>
          executeProjectRequest(session, target.requestId, {
            executor,
            capabilities: NODE_CAPABILITIES,
            preferences,
            environmentId: environment?.id ?? null,
            scripts: {
              runner: scriptRunner,
              enabled: args.scripts,
              onLogs: (entries) => {
                for (const entry of entries) {
                  if (entry.level === 'error' || entry.level === 'warn') {
                    io.stderr(`[${target.name}] ${mask(target.requestId, entry.message)}\n`);
                  }
                }
              },
            },
            signal,
            onPrepared: (prepared) => secretsOf.set(target.requestId, prepared.meta.secretValues),
          }),
        compare: (target, result) => compareProjectResult(session, target.requestId, result),
      },
      {
        scope: scope.report,
        environment: shownEnvironment,
        transport: NODE_CAPABILITIES.transport,
        stopOnFail: args.bail,
        testsAffectOutcome: true,
      },
    );
    const shown = new Set<number>();
    let step = await generator.next();
    while (!step.done) {
      const event = step.value;
      if (event.type === 'request-finished') {
        shown.add(event.index);
        const entry = maskEntry(event.entry, (text) => mask(event.entry.requestId, text));
        const detail = detailOf(
          event.comparison,
          (text) => mask(event.entry.requestId, text),
          scope.path,
          entry.folders,
        );
        details.set(`${scope.report.id}/${entry.requestId}`, detail);
        pretty?.entry(entry, detail);
      }
      step = await generator.next();
    }
    const report = {
      ...step.value,
      entries: step.value.entries.map((entry) =>
        maskEntry(entry, (text) => mask(entry.requestId, text)),
      ),
    };
    reports.push(report);
    // Requests skipped after --bail have no event of their own.
    report.entries.forEach((entry, index) => {
      if (!shown.has(index)) pretty?.entry(entry, {});
    });
    pretty?.totals(report);
    if (report.stoppedOnFail) break;
  }

  const failed = reports.some(
    (r) => r.totals.fail + r.totals.error > 0 || (args.failOnWarn && r.totals.warn > 0),
  );
  const exitCode = failed ? 1 : 0;
  if (scopes.length === 0 || reports.every((r) => r.entries.length === 0)) {
    io.stderr('warning: nothing to run (no requests in the selection).\n');
  }

  const rendered =
    args.reporter === 'json'
      ? renderJson(session.getWorkingModel().name, reports, exitCode)
      : args.reporter === 'junit'
        ? renderJunit(reports, details, { failOnWarn: args.failOnWarn })
        : null;
  if (toFile) {
    const text =
      rendered ??
      (() => {
        let buffer = '';
        const plain = createPrettyReporter({ write: (t) => (buffer += t), color: false });
        for (const report of reports) {
          plain.scope(report.scope, report.environment, report.entries.length);
          for (const entry of report.entries) {
            plain.entry(entry, details.get(`${report.scope.id}/${entry.requestId}`) ?? {});
          }
          plain.totals(report);
        }
        return buffer;
      })();
    await io.writeFile(resolve(io.cwd, args.out!), text);
  } else if (rendered !== null) {
    io.stdout(rendered);
  }
  return { reports, exitCode };
}

function maskEntry<T extends RunReport['entries'][number]>(
  entry: T,
  mask: (text: string) => string,
): T {
  return {
    ...entry,
    ...(entry.message === undefined ? {} : { message: mask(entry.message) }),
    ...(entry.tests?.failures
      ? {
          tests: {
            ...entry.tests,
            failures: entry.tests.failures.map((f) => ({
              name: mask(f.name),
              ...(f.message === undefined ? {} : { message: mask(f.message) }),
            })),
          },
        }
      : {}),
  };
}

/** What the reporters show for one request beyond the stored entry: findings, masked. */
function detailOf(
  comparison: ComparisonOutcome | undefined,
  mask: (text: string) => string,
  scopePath: string,
  folders: string[],
): EntryDetail {
  const className = [scopePath, ...folders].join('/');
  if (comparison?.kind !== 'compared') return { className };
  return {
    className,
    findings: comparison.result.findings
      .filter((f) => f.severity !== 'info')
      .map((f) => ({
        severity: f.severity === 'fail' ? 'fail' : 'warn',
        text: mask(`${f.path ? `${f.path}: ` : ''}${f.message}`),
      })),
  };
}
