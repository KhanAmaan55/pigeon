/**
 * Apidog environments and globals (PIGN-048, compatibility.md §B.2), mapped from real exports:
 *
 * - the **environment export** (Environment Management → Export): `{ environments, servers }`;
 * - the **project export** (Apidog format): `{ apidogProject, $schema: { app: 'apidog', type:
 *   'project', version }, environments, globalVariables, projectSetting.servers, moduleSettings,
 *   apiCollection, … }`.
 *
 * Variables carry an `initialValue` (shared with the team when `isSync`) and a `value` (the
 * current one). Base URLs live per service (module or server id) in `baseUrls`, with the main
 * one in `baseUrl`. Only environments and globals are imported; everything else is reported.
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

/** compatibility.md §B.2: what an Apidog-looking file that can't be read shows. */
export const APIDOG_FALLBACK_MESSAGE =
  'Unrecognized Apidog export. Export environments from Apidog in Postman format, or share a sample to add support.';

export type ApidogVariant = 'project' | 'environments';

export type ApidogDetection =
  | { kind: 'apidog'; variant: ApidogVariant; version?: string; data: JsonObject }
  | { kind: 'apidog-unrecognized' }
  | null;

function isApidogEnvironment(value: unknown): boolean {
  return (
    isObject(value) &&
    Array.isArray(value['variables']) &&
    (typeof value['baseUrl'] === 'string' || isObject(value['baseUrls']))
  );
}

/** Structural detection; `null` when the file does not look like Apidog at all. */
export function detectApidog(data: JsonObject): ApidogDetection {
  const schema = asObject(data['$schema']);
  const environments = data['environments'];
  if (schema['app'] === 'apidog' || typeof data['apidogProject'] === 'string') {
    const version = typeof schema['version'] === 'string' ? schema['version'] : undefined;
    return Array.isArray(environments) && environments.every(isApidogEnvironment)
      ? { kind: 'apidog', variant: 'project', ...(version ? { version } : {}), data }
      : { kind: 'apidog-unrecognized' };
  }
  if (!Array.isArray(environments)) return null;
  if (Array.isArray(data['servers']) && environments.every(isApidogEnvironment)) {
    return { kind: 'apidog', variant: 'environments', data };
  }
  return environments.some(
    (e) =>
      isObject(e) && ('baseUrls' in e || 'initialValue' in asObject(asArray(e['variables'])[0])),
  )
    ? { kind: 'apidog-unrecognized' }
    : null;
}

export function apidogFormatName(variant: ApidogVariant, version?: string): string {
  return variant === 'project'
    ? `Apidog project export${version ? ` (format ${version})` : ''}`
    : 'Apidog environment export';
}

// --- Variables ---------------------------------------------------------------------------------

const VARIABLE_KEYS = new Set([
  'name',
  'value',
  'initialValue',
  'description',
  'isSync',
  'securityType',
  // Variable options of newer Apidog versions; only `false` has been observed.
  'isFixedValue',
  'isBindInitial',
]);

interface MappedVariables {
  variables: ProjectEnvVariable[];
  /** Current values that differ from the shared (initial) value. */
  current: Record<string, string>;
  warnings: string[];
}

function mapVariables(raw: readonly unknown[]): MappedVariables {
  const variables: ProjectEnvVariable[] = [];
  const current: Record<string, string> = {};
  const byName: string[] = [];
  const localOnly: string[] = [];
  const unknownSecurity = new Set<string>();
  const unknownFields = new Set<string>();
  const options = new Map<string, string[]>();
  let differing = 0;
  let unnamed = 0;
  for (const entry of raw) {
    const variable = asObject(entry);
    const key = asString(variable['name']);
    if (key.trim() === '') {
      unnamed += 1;
      continue;
    }
    for (const field of Object.keys(variable))
      if (!VARIABLE_KEYS.has(field)) unknownFields.add(field);
    for (const option of ['isFixedValue', 'isBindInitial']) {
      if (variable[option] === true) options.set(option, [...(options.get(option) ?? []), key]);
    }
    const initial = text(variable['initialValue']) ?? text(variable['value']) ?? '';
    const value = text(variable['value']) ?? initial;
    const synced = variable['isSync'] !== false;
    const shared = synced ? initial : '';
    if (!synced) localOnly.push(key);
    const security = variable['securityType'];
    let type = 'default';
    if (security !== undefined && security !== 'default') {
      type = 'secret';
      unknownSecurity.add(String(security));
    } else if (looksSecret(key)) {
      type = 'secret';
      byName.push(key);
    }
    if (value !== shared) {
      current[key] = value;
      if (synced) differing += 1;
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
  const warnings: string[] = [];
  warnings.push(...secretNamesWarning(byName));
  if (unknownSecurity.size > 0) {
    warnings.push(
      `Apidog security type ${[...unknownSecurity].map((s) => `“${s}”`).join(', ')} is not known: those variables are imported as secrets.`,
    );
  }
  if (localOnly.length > 0) {
    warnings.push(
      `${list(localOnly)} ${localOnly.length === 1 ? 'is' : 'are'} not synced in Apidog: ${localOnly.length === 1 ? 'its value is' : 'their values are'} only offered as your current value${localOnly.length === 1 ? '' : 's'}.`,
    );
  }
  if (differing > 0) {
    warnings.push(
      `${plural(differing, 'variable')} ${differing === 1 ? 'has' : 'have'} a current value different from the initial value: the initial value goes to files, the current one to “use as my current values”.`,
    );
  }
  if (unnamed > 0) warnings.push(`${plural(unnamed, 'variable')} without a name skipped.`);
  for (const [option, names] of options) {
    warnings.push(`Apidog option ${option} is set on ${list(names)}: it has no Pigeon equivalent.`);
  }
  if (unknownFields.size > 0) {
    warnings.push(`Variable fields not imported: ${[...unknownFields].join(', ')}.`);
  }
  return { variables, current, warnings };
}

// --- Environments ------------------------------------------------------------------------------

const ENVIRONMENT_KEYS = new Set([
  'name',
  'variables',
  'baseUrl',
  'baseUrls',
  'parameters',
  'advancedSettings',
  'requestProxyAgentSettings',
  'websocketBaseUrls',
  'socketioBaseUrls',
  'registrationCenters',
  'type',
  // Apidog's own bookkeeping, meaningless outside Apidog (compatibility.md §B.2).
  'id',
  'visibility',
  'ordering',
  'tags',
  'projectType',
]);

interface Services {
  label: (key: string) => string;
  defaultKeys: string[];
}

/** Service labels: module names (project export) by module id, or by server id via `moduleId`. */
function servicesOf(data: JsonObject): Services {
  const moduleNames = new Map<string, string>();
  for (const entry of asArray(data['moduleSettings'])) {
    const module = asObject(entry);
    const name = asString(module['name']).trim();
    if (name !== '' && module['id'] !== undefined) moduleNames.set(String(module['id']), name);
  }
  const servers = [
    ...asArray(data['servers']),
    ...asArray(asObject(data['projectSetting'])['servers']),
  ].map(asObject);
  const serverModule = new Map<string, string>();
  const defaultKeys = ['default'];
  for (const server of servers) {
    const id = asString(server['id']);
    if (server['moduleId'] !== undefined) {
      serverModule.set(id, String(server['moduleId']));
      if (id === 'default') defaultKeys.push(String(server['moduleId']));
    }
  }
  return {
    label: (key) => moduleNames.get(key) ?? moduleNames.get(serverModule.get(key) ?? '') ?? key,
    defaultKeys,
  };
}

function environmentSource(raw: JsonObject, services: Services): EnvironmentSource {
  const mapped = mapVariables(asArray(raw['variables']));
  const warnings = [...mapped.warnings];
  const baseUrls = Object.entries(asObject(raw['baseUrls'])).flatMap(([key, url]) =>
    typeof url === 'string' ? [{ key, url: url.trim() }] : [],
  );
  const main =
    asString(raw['baseUrl']).trim() ||
    services.defaultKeys
      .map((key) => baseUrls.find((b) => b.key === key)?.url ?? '')
      .find(Boolean) ||
    baseUrls.find((b) => b.url !== '')?.url ||
    '';
  const sources: BaseUrlSource[] = main === '' ? [] : [{ suffix: '', url: main, service: 'main' }];
  const taken = new Set<string>(['']);
  let empty = 0;
  for (const { key, url } of baseUrls) {
    if (url === '') empty += 1;
    else if (url !== main) {
      const service = services.label(key);
      sources.push({ suffix: suffixFor(service, taken), url, service });
    }
  }
  if (empty > 0) {
    warnings.push(`${plural(empty, 'service')} without a base URL in this environment skipped.`);
  }

  const parameters = asObject(raw['parameters']);
  const parameterCounts = Object.entries(parameters).flatMap(([where, items]) =>
    asArray(items).length > 0 ? [`${asArray(items).length} ${where}`] : [],
  );
  if (parameterCounts.length > 0) {
    warnings.push(
      `Environment parameters (${parameterCounts.join(', ')}) are not imported: Pigeon has none per environment; add them to the collection or its requests.`,
    );
  }
  const sockets = ['websocketBaseUrls', 'socketioBaseUrls'].filter((key) =>
    Object.values(asObject(raw[key])).some((url) => typeof url === 'string' && url !== ''),
  );
  if (sockets.length > 0) {
    warnings.push(`WebSocket and Socket.IO base URLs are not imported (${sockets.join(', ')}).`);
  }
  if (asArray(raw['registrationCenters']).length > 0) {
    warnings.push('Service registration centers are not imported.');
  }
  const proxies = Object.values(asObject(raw['advancedSettings'])).some(
    (settings) => asObject(asObject(settings)['requestProxySetting'])['type'] !== 'default',
  );
  if (proxies || Object.keys(asObject(raw['requestProxyAgentSettings'])).length > 0) {
    warnings.push('Proxy settings are not imported: set a proxy in Settings if you need one.');
  }
  if (raw['type'] !== undefined && raw['type'] !== 'normal') {
    warnings.push(
      `Environment type “${String(raw['type'])}” is not known: imported as a normal environment.`,
    );
  }
  const unknown = Object.keys(raw).filter((key) => !ENVIRONMENT_KEYS.has(key));
  if (unknown.length > 0) warnings.push(`Environment fields not imported: ${unknown.join(', ')}.`);
  return {
    origin: 'Apidog',
    variables: mapped.variables,
    current: mapped.current,
    baseUrls: sources,
    warnings,
  };
}

export interface ApidogImport {
  format: string;
  environments: ImportedEnvironment[];
  globals?: ImportedVariables & { globals: ProjectGlobals };
  /** About the file as a whole (what else it holds that is not imported). */
  warnings: string[];
}

const PROJECT_CONTENT = [
  ['apiCollection', 'APIs'],
  ['docCollection', 'docs'],
  ['schemaCollection', 'schemas'],
  ['socketCollection', 'socket APIs'],
  ['webSocketCollection', 'WebSocket APIs'],
  ['socketIOCollection', 'Socket.IO APIs'],
  ['mcpClientCollection', 'MCP clients'],
  ['commonScripts', 'common scripts'],
  ['customFunctions', 'custom functions'],
] as const;

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) =>
      isObject(entry) && Array.isArray(entry['items'])
        ? entry['items'].length > 0 || asArray(entry['children']).length > 0
        : true,
    );
  }
  return (
    isObject(value) &&
    Object.values(value).some((v) =>
      Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '',
    )
  );
}

/** Environments (and globals) of a detected Apidog export. */
export function importApidog(
  detected: { variant: ApidogVariant; version?: string; data: JsonObject },
  options: { newId?: () => string; baseUrlVariable?: string } = {},
): ApidogImport {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const { data } = detected;
  const services = servicesOf(data);
  const environments = asArray(data['environments']).map((entry) => {
    const raw = asObject(entry);
    return importedEnvironment(environmentSource(raw, services), asString(raw['name']), {
      newId,
      baseUrlVariable: options.baseUrlVariable,
    });
  });

  const globalVariables = asArray(data['globalVariables']).flatMap((entry) =>
    asArray(asObject(entry)['variables']),
  );
  let globals: ApidogImport['globals'];
  if (globalVariables.length > 0) {
    const mapped = mapVariables(globalVariables);
    const split = splitSecrets(mapped.variables, mapped.current);
    globals = {
      ...split,
      report: { ...split.report, warnings: [...split.report.warnings, ...mapped.warnings] },
      globals: { id: newId(), values: split.values, extra: {} },
    };
  }

  const warnings: string[] = [];
  if (detected.variant === 'project') {
    const other = PROJECT_CONTENT.filter(([key]) => hasContent(data[key])).map(
      ([, label]) => label,
    );
    if (other.length > 0) {
      warnings.push(
        `Only environments and global variables are imported from an Apidog project; its ${other.join(', ')} are not. Export the APIs from Apidog as OpenAPI or Postman to bring them in.`,
      );
    }
    if (hasContent(data['commonParameters'])) {
      warnings.push('Common parameters are not imported.');
    }
  }
  return {
    format: apidogFormatName(detected.variant, detected.version),
    environments,
    ...(globals ? { globals } : {}),
    warnings,
  };
}
