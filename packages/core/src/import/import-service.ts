/**
 * Import (docs/architecture.md §7, PIGN-028): detect the file, map it, and describe what would
 * be added (`ImportPlan`) before anything changes. Applying is `importCollection` + Save for
 * Commit (or just saving as drafts).
 */

import type { Collection, ImportReport } from '@pigeon/formats';
import { detectFormat, importPostmanCollection } from '@pigeon/formats';

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
