/**
 * Importing and exporting Postman environment and globals files (compatibility.md §B.1,
 * PIGN-030). The imported `value` is the shared value; secret values never stay shared — they
 * are handed back as `currentValues` for the caller to keep locally (or drop).
 */

import { slugify } from '../slug';
import type { ProjectEnvironment, ProjectEnvVariable, ProjectGlobals } from '../project/types';
import {
  environmentFromPostman,
  environmentToPostman,
  globalsFromPostman,
  globalsToPostman,
} from './environment';
import type { JsonObject } from './json';

export interface VariablesImportReport {
  variables: number;
  secrets: number;
  warnings: string[];
}

export interface ImportedVariables {
  /** Shared values as they will be written (secrets emptied). */
  values: ProjectEnvVariable[];
  /** Every imported value, secrets included: what "use as my current values" sets. */
  currentValues: Record<string, string>;
  report: VariablesImportReport;
}

/**
 * Empties secret values for the files and hands every value back as `currentValues`. `current`
 * gives a variable's current value when it differs from the shared one (Apidog, PIGN-048).
 */
export function splitSecrets(
  values: ProjectEnvVariable[],
  current: Readonly<Record<string, string>> = {},
): ImportedVariables {
  const currentValues: Record<string, string> = {};
  let secretsWithValue = 0;
  const shared = values.map((variable) => {
    const value = Object.hasOwn(current, variable.key) ? current[variable.key]! : variable.value;
    if (value !== '') currentValues[variable.key] = value;
    if (variable.type !== 'secret' || (variable.value === '' && value === '')) return variable;
    secretsWithValue += 1;
    return { ...variable, value: '' };
  });
  const secrets = values.filter((v) => v.type === 'secret').length;
  return {
    values: shared,
    currentValues,
    report: {
      variables: values.length,
      secrets,
      warnings:
        secretsWithValue > 0
          ? [
              `${secretsWithValue} secret value${secretsWithValue === 1 ? ' is' : 's are'} not written to files: keep ${secretsWithValue === 1 ? 'it' : 'them'} as your current value${secretsWithValue === 1 ? '' : 's'} on this machine.`,
            ]
          : [],
    },
  };
}

export function importPostmanEnvironment(
  data: JsonObject,
  options: { existingIds?: ReadonlySet<string>; newId?: () => string } = {},
): ImportedVariables & { environment: ProjectEnvironment; regeneratedId?: string } {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const parsed = environmentFromPostman(data, '');
  const taken = parsed.id !== '' && (options.existingIds?.has(parsed.id) ?? false);
  const id = parsed.id === '' || taken ? newId() : parsed.id;
  const name = parsed.name.trim() || 'Imported environment';
  const split = splitSecrets(parsed.values);
  return {
    ...split,
    environment: {
      ...parsed,
      id,
      name,
      fileKey: slugify(name, { kind: 'environment', id }),
      values: split.values,
    },
    ...(taken ? { regeneratedId: parsed.id } : {}),
  };
}

export function importPostmanGlobals(
  data: JsonObject,
): ImportedVariables & { globals: ProjectGlobals } {
  const parsed = globalsFromPostman(data);
  const split = splitSecrets(parsed.values);
  return { ...split, globals: { ...parsed, values: split.values } };
}

export interface VariablesExportOptions {
  /** `_postman_exported_at`; now by default. */
  exportedAt?: Date;
  /** Pigeon's version, for `_postman_exported_using: "Pigeon/<version>"`. */
  version: string;
}

/** A Postman environment file: shared values only (current values and secrets never leave). */
export function exportEnvironment(
  environment: ProjectEnvironment,
  options: VariablesExportOptions,
) {
  return {
    data: {
      ...environmentToPostman(environment),
      _postman_exported_at: (options.exportedAt ?? new Date()).toISOString(),
      _postman_exported_using: `Pigeon/${options.version}`,
    } as JsonObject,
    fileName: `${environment.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'environment'}.postman_environment.json`,
  };
}

export function exportGlobals(globals: ProjectGlobals, options: VariablesExportOptions) {
  return {
    data: {
      ...globalsToPostman(globals),
      _postman_exported_at: (options.exportedAt ?? new Date()).toISOString(),
      _postman_exported_using: `Pigeon/${options.version}`,
    } as JsonObject,
    fileName: 'globals.postman_globals.json',
  };
}
