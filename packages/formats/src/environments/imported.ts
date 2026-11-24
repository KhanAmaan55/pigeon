/**
 * What environment importers from other tools share (Apidog PIGN-048, Echo API PIGN-049): an
 * environment's variables plus the base URLs its services had, turned into Pigeon variables
 * under a variable name the user picks (`baseUrl`, `baseUrl_<service>`), with secrets kept off
 * files and a readable report.
 */

import type { ProjectEnvironment, ProjectEnvVariable } from '../project/types';
import type { ImportedVariables } from '../postman/environment-io';
import { splitSecrets } from '../postman/environment-io';
import { slugify } from '../slug';

export const DEFAULT_BASE_URL_VARIABLE = 'baseUrl';

/** A base URL found in the export; `suffix` is appended to the chosen variable name. */
export interface BaseUrlSource {
  suffix: string;
  url: string;
  /** The service (module, server) name, or its id when the export has no name for it. */
  service: string;
}

export interface BaseUrl extends BaseUrlSource {
  key: string;
  /** A variable from the export already has this name: the base URL is not added. */
  skipped: boolean;
}

/** What an imported environment maps to before the base URL variable name is chosen. */
export interface EnvironmentSource {
  /** The tool it came from, for descriptions: `Apidog`, `Echo API`. */
  origin: string;
  variables: ProjectEnvVariable[];
  /** Current values that differ from the shared value. */
  current: Record<string, string>;
  baseUrls: BaseUrlSource[];
  warnings: string[];
}

export interface ImportedEnvironment extends ImportedVariables {
  environment: ProjectEnvironment;
  source: EnvironmentSource;
  baseUrls: BaseUrl[];
}

/** Names that end like a credential: imported as secrets so their values stay off files. */
const SECRET_NAME = /(secret|passw(or)?d|token|api[-_]?key|private[-_]?key|credentials?)$/i;

export function looksSecret(name: string): boolean {
  return SECRET_NAME.test(name);
}

export function secretNamesWarning(names: readonly string[]): string[] {
  if (names.length === 0) return [];
  return [
    `${list(names)} look${names.length === 1 ? 's' : ''} like ${names.length === 1 ? 'a secret' : 'secrets'}: imported as secret, so the value stays off files. Change the type in the environment editor if not.`,
  ];
}

export function list(names: readonly string[]): string {
  const shown = names.slice(0, 5).join(', ');
  return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A string for a JSON scalar (numbers and booleans as written), else `undefined`. */
export function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** `_billing_api` for "Billing API", unique within `taken`. */
export function suffixFor(service: string, taken: Set<string>): string {
  const base = `_${
    service
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'service'
  }`;
  let suffix = base;
  for (let i = 2; taken.has(suffix); i++) suffix = `${base}_${i}`;
  taken.add(suffix);
  return suffix;
}

/**
 * The environment's variables with its base URLs as `<name>` and `<name>_<service>` (first, in
 * that order), secrets emptied for files, and the report.
 */
export function buildImportedEnvironment(
  source: EnvironmentSource,
  baseUrlVariable: string = DEFAULT_BASE_URL_VARIABLE,
): ImportedVariables & { baseUrls: BaseUrl[] } {
  const own = new Set(source.variables.map((v) => v.key));
  const baseUrls = source.baseUrls.map((b) => {
    const key = `${baseUrlVariable}${b.suffix}`;
    return { ...b, key, skipped: own.has(key) };
  });
  const added = baseUrls
    .filter((b) => !b.skipped)
    .map((b): ProjectEnvVariable => ({
      key: b.key,
      value: b.url,
      type: 'default',
      enabled: true,
      description:
        b.suffix === ''
          ? `Base URL from ${source.origin}`
          : `Base URL of the ${source.origin} service “${b.service}”`,
    }));
  const split = splitSecrets([...added, ...source.variables], source.current);
  const skipped = baseUrls.filter((b) => b.skipped);
  return {
    ...split,
    baseUrls,
    report: {
      ...split.report,
      warnings: [
        ...skipped.map(
          (b) =>
            `The export already has a variable “${b.key}”: the base URL ${b.url} is not added under that name.`,
        ),
        ...split.report.warnings,
        ...source.warnings,
      ],
    },
  };
}

/** A new Pigeon environment (fresh id) from a source. */
export function importedEnvironment(
  source: EnvironmentSource,
  rawName: string,
  options: { newId: () => string; baseUrlVariable?: string | undefined },
): ImportedEnvironment {
  const built = buildImportedEnvironment(source, options.baseUrlVariable);
  const id = options.newId();
  const name = rawName.trim() || 'Imported environment';
  return {
    ...built,
    source,
    environment: {
      id,
      fileKey: slugify(name, { kind: 'environment', id }),
      name,
      values: built.values,
      extra: {},
    },
  };
}
