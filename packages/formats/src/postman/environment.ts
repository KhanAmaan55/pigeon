/**
 * Postman environment JSON ⇄ normalized environment (docs/file-format.md §2.5,
 * compatibility.md §B.1). Volatile export keys are dropped; unknown keys are preserved.
 */

import type { ProjectEnvironment, ProjectEnvVariable } from '../project/types';
import { asArray, asObject, asString, isDescription, nonEmpty, type JsonObject } from './json';

/** Written by Postman on export; never part of project files (re-added on export, PIGN-030). */
export const VOLATILE_ENVIRONMENT_KEYS = [
  '_postman_exported_at',
  '_postman_exported_using',
] as const;

export function variableFromPostman(value: unknown): ProjectEnvVariable {
  const rest = { ...asObject(value) };
  const take = (key: string) => {
    const v = rest[key];
    delete rest[key];
    return v;
  };
  const key = asString(take('key'));
  const raw = take('value');
  const type = take('type');
  const enabled = take('enabled');
  const description = isDescription(rest['description']) ? take('description') : undefined;
  return {
    key,
    value: typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw),
    type: typeof type === 'string' ? type : 'default',
    enabled: enabled !== false,
    ...(description === undefined
      ? {}
      : { description: description as ProjectEnvVariable['description'] }),
    ...(nonEmpty(rest) ? { extra: rest } : {}),
  };
}

export function variableToPostman(variable: ProjectEnvVariable): JsonObject {
  return {
    ...variable.extra,
    key: variable.key,
    value: variable.value,
    type: variable.type,
    enabled: variable.enabled,
    ...(variable.description === undefined ? {} : { description: variable.description }),
  };
}

export function environmentFromPostman(json: JsonObject, fileKey: string): ProjectEnvironment {
  const rest = { ...json };
  for (const key of [...VOLATILE_ENVIRONMENT_KEYS, '_postman_variable_scope']) delete rest[key];
  const id = asString(rest['id']);
  const name = asString(rest['name']);
  const values = asArray(rest['values']).map(variableFromPostman);
  delete rest['id'];
  delete rest['name'];
  delete rest['values'];
  return { id, fileKey, name, values, extra: rest };
}

export function environmentToPostman(environment: ProjectEnvironment): JsonObject {
  return {
    ...environment.extra,
    id: environment.id,
    name: environment.name,
    values: environment.values.map(variableToPostman),
    _postman_variable_scope: 'environment',
  };
}
