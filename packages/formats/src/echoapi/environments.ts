/**
 * Echo API environments and globals (PIGN-049, compatibility.md §B.3), mapped from a real Echo
 * API project export: `{ project_id, name, intro, global: { envs, servers, global_vars,
 * global_param, … }, apis, models, samples, automated_testings }`.
 *
 * An environment (`global.envs[]`) has `env_id`, `name`, `is_private` (1 / -1), `sort`,
 * `server_list` (`{ server_id, name, sort, uri }`: the base URL per service) and `env_var_list`,
 * an object keyed by variable name with `value` (shared), `current_value` and `description`.
 * Only environments and global variables are imported; everything else is reported.
 */

import type {
  BaseUrlSource,
  EnvironmentSource,
  ImportedEnvironment,
} from '../environments/imported';
import {
  importedEnvironment,
  list,
  looksSecret,
  plural,
  secretNamesWarning,
  suffixFor,
  text,
} from '../environments/imported';
import type { ProjectEnvVariable, ProjectGlobals } from '../project/types';
import type { ImportedVariables } from '../postman/environment-io';
import { splitSecrets } from '../postman/environment-io';
import type { JsonObject } from '../postman/json';
import { asArray, asObject, asString, isObject } from '../postman/json';

export const ECHOAPI_FALLBACK_MESSAGE =
  'Unrecognized Echo API export. Export environments from Echo API in Postman format, or share a sample to add support.';

export const ECHOAPI_FORMAT = 'Echo API project export';

export type EchoApiDetection =
  { kind: 'echoapi'; data: JsonObject } | { kind: 'echoapi-unrecognized' } | null;

function isEchoEnvironment(value: unknown): boolean {
  return (
    isObject(value) &&
    'env_id' in value &&
    (isObject(value['env_var_list']) || Array.isArray(value['server_list']))
  );
}

/** Structural detection; `null` when the file does not look like Echo API at all. */
export function detectEchoApi(data: JsonObject): EchoApiDetection {
  const global = data['global'];
  const envs = isObject(global) ? global['envs'] : undefined;
  if (Array.isArray(envs) && envs.every(isEchoEnvironment)) return { kind: 'echoapi', data };
  const echoLike =
    (typeof data['project_id'] === 'string' && Array.isArray(data['apis'])) ||
    (isObject(global) && 'envs' in global && 'global_vars' in global);
  return echoLike ? { kind: 'echoapi-unrecognized' } : null;
}

const VARIABLE_KEYS = new Set(['value', 'current_value', 'description']);
const ENVIRONMENT_KEYS = new Set([
  'env_id',
  'name',
  'is_private',
  'sort',
  'server_list',
  'env_var_list',
]);

interface MappedVariables {
  variables: ProjectEnvVariable[];
  current: Record<string, string>;
  warnings: string[];
}

function mapVariables(list_: JsonObject, local: boolean): MappedVariables {
  const variables: ProjectEnvVariable[] = [];
  const current: Record<string, string> = {};
  const byName: string[] = [];
  const unknownFields = new Set<string>();
  let differing = 0;
  for (const [key, entry] of Object.entries(list_)) {
    if (key.trim() === '') continue;
    const variable = isObject(entry) ? entry : { value: entry };
    for (const field of Object.keys(variable))
      if (!VARIABLE_KEYS.has(field)) unknownFields.add(field);
    const initial = text(variable['value']) ?? '';
    const value = text(variable['current_value']) ?? initial;
    const shared = local ? '' : initial;
    let type = 'default';
    if (looksSecret(key)) {
      type = 'secret';
      byName.push(key);
    }
    if (value !== shared) {
      current[key] = value;
      if (!local) differing += 1;
    }
    const description = asString(variable['description']);
    variables.push({
      key,
      value: shared,
      type,
      enabled: true,
      ...(description.trim() === '' ? {} : { description }),
    });
  }
  const warnings = [...secretNamesWarning(byName)];
  if (differing > 0) {
    warnings.push(
      `${plural(differing, 'variable')} ${differing === 1 ? 'has' : 'have'} a current value different from the shared value: the shared value goes to files, the current one to “use as my current values”.`,
    );
  }
  if (unknownFields.size > 0) {
    warnings.push(`Variable fields not imported: ${[...unknownFields].join(', ')}.`);
  }
  return { variables, current, warnings };
}

function environmentSource(raw: JsonObject, serverNames: Map<string, string>): EnvironmentSource {
  const isPrivate = raw['is_private'] === 1 || raw['is_private'] === true;
  const mapped = mapVariables(asObject(raw['env_var_list']), isPrivate);
  const warnings = [...mapped.warnings];
  if (isPrivate) {
    warnings.push(
      'This environment is private in Echo API: its values are only offered as your current values, not written to files.',
    );
  }
  const baseUrls: BaseUrlSource[] = [];
  const taken = new Set<string>(['']);
  for (const entry of asArray(raw['server_list'])) {
    const server = asObject(entry);
    const url = asString(server['uri']).trim();
    if (url === '') continue;
    const id = String(server['server_id'] ?? '');
    const service = asString(server['name']).trim() || serverNames.get(id) || id;
    baseUrls.push(
      baseUrls.length === 0
        ? { suffix: '', url, service }
        : { suffix: suffixFor(service, taken), url, service },
    );
  }
  const unknown = Object.keys(raw).filter((key) => !ENVIRONMENT_KEYS.has(key));
  if (unknown.length > 0) warnings.push(`Environment fields not imported: ${unknown.join(', ')}.`);
  return {
    origin: 'Echo API',
    variables: mapped.variables,
    current: mapped.current,
    baseUrls,
    warnings,
  };
}

export interface EchoApiImport {
  format: string;
  environments: ImportedEnvironment[];
  globals?: ImportedVariables & { globals: ProjectGlobals };
  /** About the file as a whole (what else it holds, environments left out). */
  warnings: string[];
}

const PROJECT_CONTENT = [
  ['apis', 'APIs'],
  ['models', 'data models'],
  ['samples', 'samples'],
  ['automated_testings', 'automated tests'],
] as const;

/** Environments (and global variables) of a detected Echo API project export. */
export function importEchoApi(
  data: JsonObject,
  options: { newId?: () => string; baseUrlVariable?: string } = {},
): EchoApiImport {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const global = asObject(data['global']);
  const serverNames = new Map<string, string>();
  for (const entry of asArray(global['servers'])) {
    const server = asObject(entry);
    const name = asString(server['name']).trim();
    if (name !== '') serverNames.set(String(server['server_id'] ?? ''), name);
  }

  const empty: string[] = [];
  const environments: ImportedEnvironment[] = [];
  for (const entry of asArray(global['envs'])) {
    const raw = asObject(entry);
    const name = asString(raw['name']);
    const source = environmentSource(raw, serverNames);
    if (source.variables.length === 0 && source.baseUrls.length === 0) {
      empty.push(name.trim() || String(raw['env_id'] ?? ''));
      continue;
    }
    environments.push(
      importedEnvironment(source, name, { newId, baseUrlVariable: options.baseUrlVariable }),
    );
  }

  let globals: EchoApiImport['globals'];
  const globalVars = asObject(global['global_vars']);
  if (Object.keys(globalVars).length > 0) {
    const mapped = mapVariables(globalVars, false);
    const split = splitSecrets(mapped.variables, mapped.current);
    globals = {
      ...split,
      report: { ...split.report, warnings: [...split.report.warnings, ...mapped.warnings] },
      globals: { id: newId(), values: split.values, extra: {} },
    };
  }

  const warnings: string[] = [];
  if (empty.length > 0) {
    warnings.push(
      `${list(empty.map((name) => `“${name}”`))} ${empty.length === 1 ? 'has' : 'have'} no variables or base URL: not imported.`,
    );
  }
  const other = PROJECT_CONTENT.flatMap(([key, label]) => {
    const count = asArray(data[key]).length;
    return count > 0 ? [`${label} (${count})`] : [];
  });
  if (other.length > 0) {
    warnings.push(
      `Only environments and global variables are imported from an Echo API project; its ${other.join(', ')} are not. Export the project from Echo API in Postman format to bring the APIs in.`,
    );
  }
  const param = asObject(global['global_param']);
  const parameterCounts = ['header', 'query', 'body', 'cookie'].flatMap((where) => {
    const count = asArray(asObject(param[where])['parameter']).length;
    return count > 0 ? [`${count} ${where}`] : [];
  });
  if (parameterCounts.length > 0) {
    warnings.push(
      `Project parameters (${parameterCounts.join(', ')}) are not imported: add them to the collection or its requests.`,
    );
  }
  const authType = asString(asObject(param['auth'])['type']);
  if (authType !== '' && authType !== 'noauth' && authType !== 'inherit') {
    warnings.push(`Project auth (${authType}) is not imported: set it on the collection.`);
  }
  const tasks = asArray(param['pre_tasks']).length + asArray(param['post_tasks']).length;
  if (tasks > 0) {
    warnings.push(`${plural(tasks, 'project pre/post task')} (scripts) not imported.`);
  }
  return {
    format: ECHOAPI_FORMAT,
    environments,
    ...(globals ? { globals } : {}),
    warnings,
  };
}

/** Whether a detected export has anything to import (environments with content, globals). */
export function echoApiHasVariables(data: JsonObject): boolean {
  const global = asObject(data['global']);
  return (
    Object.keys(asObject(global['global_vars'])).length > 0 ||
    asArray(global['envs']).some((entry) => {
      const env = asObject(entry);
      return (
        Object.keys(asObject(env['env_var_list'])).length > 0 ||
        asArray(env['server_list']).some((s) => asString(asObject(s)['uri']).trim() !== '')
      );
    })
  );
}
