/**
 * Import (docs/architecture.md §7, PIGN-028): detect the file, map it, and describe what would
 * be added (`ImportPlan`) before anything changes. Applying is `importCollection` + Save for
 * Commit (or just saving as drafts).
 */

import type {
  Collection,
  ImportReport,
  ProjectEnvironment,
  ProjectGlobals,
  VariablesImportReport,
} from '@pigeon/formats';
import {
  detectFormat,
  importPostmanCollection,
  importPostmanEnvironment,
  importPostmanGlobals,
} from '@pigeon/formats';

import { GLOBALS_ENTITY_ID } from '../workspace/commands';
import type { ProjectSession } from '../workspace/project-session';

import type { ProjectItem, ProjectModel } from '../model/project';

export interface CollectionImportPlan {
  kind: 'collection';
  /** E.g. `Postman Collection v2.1`. */
  format: string;
  collection: Collection;
  report: ImportReport;
}

export type ImportPreview =
  { ok: true; plan: CollectionImportPlan } | { ok: false; message: string; format?: string };

/** Every id in use: collections, folders, requests, examples, environments. */
export function usedIds(model: ProjectModel): Set<string> {
  const ids = new Set<string>(model.environments.map((e) => e.id));
  const walk = (items: readonly ProjectItem[]) => {
    for (const item of items) {
      ids.add(item.id);
      if (item.kind === 'folder') walk(item.children);
      else for (const example of item.examples) ids.add(example.id);
    }
  };
  for (const collection of model.collections) {
    ids.add(collection.id);
    walk(collection.children);
  }
  for (const orphan of model.orphanExamples) ids.add(orphan.id);
  return ids;
}

/** What importing `input` into `model` would add, or why it can't be imported. */
export function previewImport(
  model: ProjectModel,
  input: string | Uint8Array,
  options: { newId?: () => string } = {},
): ImportPreview {
  return previewImportFile(input, usedIds(model), options);
}

/** `previewImport` given the ids in use (what a worker gets instead of the model). */
export function previewImportFile(
  input: string | Uint8Array,
  existingIds: ReadonlySet<string>,
  options: { newId?: () => string } = {},
): ImportPreview {
  const detected = detectFormat(input);
  switch (detected.kind) {
    case 'postman-collection': {
      const { collection, report } = importPostmanCollection(detected.data, detected.version, {
        existingIds,
        ...(options.newId ? { newId: options.newId } : {}),
      });
      return { ok: true, plan: { kind: 'collection', format: report.format, collection, report } };
    }
    case 'postman-environment':
    case 'postman-globals':
      return {
        ok: false,
        format: detected.kind === 'postman-environment' ? 'Postman environment' : 'Postman globals',
        message: 'Importing environments arrives with environment import (not yet available).',
      };
    case 'rejected':
      return { ok: false, format: detected.format, message: detected.message };
    case 'unknown':
      return { ok: false, message: detected.message };
  }
}

/** A collection plan with another name (the dialog's editable target name). */
export function renamePlan(plan: CollectionImportPlan, name: string): CollectionImportPlan {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === plan.collection.name) return plan;
  return { ...plan, collection: { ...plan.collection, name: trimmed } };
}

/** Ids of the entities an applied plan adds (for Save for Commit of just those). */
export function planEntityIds(plan: CollectionImportPlan): string[] {
  const ids = [plan.collection.id];
  const walk = (items: readonly ProjectItem[]) => {
    for (const item of items) {
      ids.push(item.id);
      if (item.kind === 'folder') walk(item.children);
    }
  };
  walk(plan.collection.children);
  return ids;
}

// --- Several files at once (PIGN-030) ---------------------------------------------------------

export type ImportItem =
  | ({ kind: 'collection'; fileName: string } & Omit<CollectionImportPlan, 'kind'>)
  | {
      kind: 'environment';
      fileName: string;
      format: string;
      environment: ProjectEnvironment;
      /** Every imported value (secrets included), for "use as my current values". */
      currentValues: Record<string, string>;
      report: VariablesImportReport;
      /** An environment with the same name already in the project. */
      collidesWith?: { id: string; name: string };
      regeneratedId?: string;
    }
  | {
      kind: 'globals';
      fileName: string;
      format: string;
      globals: ProjectGlobals;
      currentValues: Record<string, string>;
      report: VariablesImportReport;
    }
  | { kind: 'rejected'; fileName: string; format?: string; message: string };

export interface ImportContext {
  usedIds: ReadonlySet<string>;
  environments: ReadonlyArray<{ id: string; name: string }>;
}

/** What a preview needs from the project (plain data, so it can cross into a worker). */
export function importContext(model: ProjectModel): ImportContext {
  return {
    usedIds: usedIds(model),
    environments: model.environments.map((e) => ({ id: e.id, name: e.name })),
  };
}

/** One combined preview for every file dropped or picked together. */
export function previewImportFiles(
  files: ReadonlyArray<{ name: string; bytes: Uint8Array | string }>,
  context: ImportContext,
  options: { newId?: () => string } = {},
): ImportItem[] {
  const taken = new Set(context.usedIds);
  const items: ImportItem[] = [];
  for (const file of files) {
    const detected = detectFormat(file.bytes);
    switch (detected.kind) {
      case 'postman-collection': {
        const { collection, report } = importPostmanCollection(detected.data, detected.version, {
          existingIds: taken,
          ...(options.newId ? { newId: options.newId } : {}),
        });
        for (const id of planEntityIds({ kind: 'collection', format: '', collection, report }))
          taken.add(id);
        items.push({
          kind: 'collection',
          fileName: file.name,
          format: report.format,
          collection,
          report,
        });
        break;
      }
      case 'postman-environment': {
        const imported = importPostmanEnvironment(detected.data, {
          existingIds: taken,
          ...(options.newId ? { newId: options.newId } : {}),
        });
        taken.add(imported.environment.id);
        const name = imported.environment.name.toLowerCase();
        const collidesWith =
          context.environments.find((e) => e.name.toLowerCase() === name) ??
          items
            .flatMap((item) => (item.kind === 'environment' ? [item.environment] : []))
            .find((e) => e.name.toLowerCase() === name);
        items.push({
          kind: 'environment',
          fileName: file.name,
          format: 'Postman environment',
          environment: imported.environment,
          currentValues: imported.currentValues,
          report: imported.report,
          ...(collidesWith
            ? { collidesWith: { id: collidesWith.id, name: collidesWith.name } }
            : {}),
          ...(imported.regeneratedId ? { regeneratedId: imported.regeneratedId } : {}),
        });
        break;
      }
      case 'postman-globals': {
        const imported = importPostmanGlobals(detected.data);
        items.push({
          kind: 'globals',
          fileName: file.name,
          format: 'Postman globals',
          globals: imported.globals,
          currentValues: imported.currentValues,
          report: imported.report,
        });
        break;
      }
      case 'rejected':
        items.push({
          kind: 'rejected',
          fileName: file.name,
          format: detected.format,
          message: detected.message,
        });
        break;
      case 'unknown':
        items.push({ kind: 'rejected', fileName: file.name, message: detected.message });
        break;
    }
  }
  return items;
}

export interface ApplyImportOptions {
  /** New names for collections, by item index (the dialog's editable names). */
  names?: Readonly<Record<number, string>>;
  /** Also set the imported values (secrets included) as this machine's current values. */
  useAsCurrentValues?: boolean;
  /** An environment named like an existing one: add it as "Name (2)" or replace its variables. */
  onCollision?: 'keep-both' | 'replace';
}

/** `name`, or `name (2)`, `name (3)`, … when taken. */
function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Applies the importable items as in-memory edits and returns the ids of the entities they
 * created or changed (what "Import & write files" commits, or "local drafts" saves).
 */
export function applyImport(
  session: Pick<ProjectSession, 'apply' | 'getWorkingModel' | 'setCurrentValue'>,
  items: readonly ImportItem[],
  options: ApplyImportOptions = {},
): string[] {
  const ids: string[] = [];
  items.forEach((item, index) => {
    switch (item.kind) {
      case 'collection': {
        const plan = renamePlan({ ...item, kind: 'collection' }, options.names?.[index] ?? '');
        session.apply({ type: 'importCollection', collection: plan.collection });
        ids.push(...planEntityIds(plan));
        break;
      }
      case 'environment': {
        const model = session.getWorkingModel();
        const existing = model.environments.find(
          (e) => e.name.toLowerCase() === item.environment.name.toLowerCase(),
        );
        let id = item.environment.id;
        if (existing && options.onCollision === 'replace') {
          id = existing.id;
          session.apply({ type: 'setEnvironmentValues', id, values: item.environment.values });
        } else {
          const name = freeName(
            item.environment.name,
            new Set(model.environments.map((e) => e.name.toLowerCase())),
          );
          session.apply({
            type: 'createEnvironment',
            id,
            name,
            values: item.environment.values,
            extra: item.environment.extra,
          });
        }
        if (options.useAsCurrentValues) {
          for (const [key, value] of Object.entries(item.currentValues)) {
            session.setCurrentValue(`env:${id}`, key, value);
          }
        }
        ids.push(id);
        break;
      }
      case 'globals': {
        const current = session.getWorkingModel().globals?.values ?? [];
        const imported = new Map(item.globals.values.map((v) => [v.key, v]));
        const merged = [
          ...current.map((v) => imported.get(v.key) ?? v),
          ...item.globals.values.filter((v) => !current.some((c) => c.key === v.key)),
        ];
        session.apply({ type: 'setGlobals', values: merged });
        if (options.useAsCurrentValues) {
          for (const [key, value] of Object.entries(item.currentValues)) {
            session.setCurrentValue('globals', key, value);
          }
        }
        ids.push(GLOBALS_ENTITY_ID);
        break;
      }
      case 'rejected':
        break;
    }
  });
  return ids;
}
