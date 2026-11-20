/**
 * Comparing a response with its request's baseline example (docs/response-comparison.md §2–4,
 * PIGN-034). Baseline selection `auto`: the first example with the response's status code, else
 * the first example. Body only for now (status, headers and values arrive with PIGN-036).
 *
 * `compareBodyTexts` takes plain strings so a worker can run it; schema snapshots are cached by
 * a hash of the baseline body and the settings (derived data, never committed).
 */

import type {
  ArrayMatching,
  FieldRule,
  Finding,
  HeaderMode,
  Outcome,
  SchemaNode,
  StatusMode,
} from '@pigeon/compare';
import {
  applyRules,
  compareBinary,
  compareHeaders,
  compareJson,
  compareStatus,
  compareText,
  compareValues,
  inferSchema,
  summarize,
} from '@pigeon/compare';
import type {
  ExampleBodyFormat,
  ProjectComparisonConfig,
  ProjectExample,
  ProjectFieldRule,
} from '@pigeon/formats';
import { decodeBase64, ruleFromFile } from '@pigeon/formats';

import { isJsonMediaType, parseMediaType } from '../execution/response';
import type { ExecutionResult } from '../execution/types';
import type { ProjectModel } from '../model/project';

export interface BodyComparisonSettings {
  mode: 'schema' | 'values' | 'none';
  additionalFields: 'ignore' | 'warn' | 'fail';
  distinguishIntegers: boolean;
  /** Values mode: how arrays are matched (§4.4); default `index`. */
  arrays?: ArrayMatching;
}

export const DEFAULT_BODY_COMPARISON: Readonly<BodyComparisonSettings> = Object.freeze({
  mode: 'schema',
  additionalFields: 'warn',
  distinguishIntegers: false,
  arrays: 'index',
});

export interface HeaderComparisonSettings {
  compare: string[];
  mode: HeaderMode;
  ignore: string[];
}

export const DEFAULT_HEADER_COMPARISON: Readonly<HeaderComparisonSettings> = Object.freeze({
  compare: ['content-type'],
  mode: 'media-type',
  ignore: [],
});

function statusMode(raw: unknown, base: StatusMode): StatusMode {
  return raw === 'exact' || raw === 'class' || raw === 'ignore' ? raw : base;
}

/** `raw` header settings over `base`; invalid values are ignored. */
export function headerSettings(
  raw: unknown,
  base: HeaderComparisonSettings = DEFAULT_HEADER_COMPARISON,
): HeaderComparisonSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const names = (list: unknown, fallback: string[]) =>
    Array.isArray(list) && list.every((n) => typeof n === 'string')
      ? (list as string[]).map((n) => n.toLowerCase())
      : fallback;
  return {
    compare: names(value['compare'], base.compare),
    mode:
      value['mode'] === 'media-type' || value['mode'] === 'value' || value['mode'] === 'presence'
        ? value['mode']
        : base.mode,
    ignore: names(value['ignore'], base.ignore),
  };
}

/** The project's body defaults (`pigeon.json` `comparison.body`), else the built-in ones. */
export function projectBodySettings(
  model: Pick<ProjectModel, 'comparison'>,
): BodyComparisonSettings {
  return bodySettings((model.comparison as { body?: unknown } | undefined)?.body);
}

/** `raw` body settings (pigeon.json or compare.json) over `base`; invalid values are ignored. */
export function bodySettings(
  raw: unknown,
  base: BodyComparisonSettings = DEFAULT_BODY_COMPARISON,
): BodyComparisonSettings {
  const body = (typeof raw === 'object' && raw !== null ? raw : undefined) as
    Partial<BodyComparisonSettings> | undefined;
  const pick = <K extends keyof BodyComparisonSettings>(key: K, allowed: readonly unknown[]) =>
    body && allowed.includes(body[key]) ? (body[key] as BodyComparisonSettings[K]) : base[key];
  const arrays = (body as { arrays?: unknown } | undefined)?.arrays;
  return {
    mode: pick('mode', ['schema', 'values', 'none']),
    additionalFields: pick('additionalFields', ['ignore', 'warn', 'fail']),
    distinguishIntegers: pick('distinguishIntegers', [true, false]),
    arrays:
      arrays === 'index' || arrays === 'schema'
        ? arrays
        : typeof arrays === 'object' &&
            arrays !== null &&
            typeof (arrays as { matchBy?: unknown }).matchBy === 'string'
          ? { matchBy: (arrays as { matchBy: string }).matchBy }
          : (base.arrays ?? 'index'),
  };
}

/** Rules of `pigeon.json` `comparison.rules` (project-wide). */
export function projectRules(model: Pick<ProjectModel, 'comparison'>): ProjectFieldRule[] {
  const rules = (model.comparison as { rules?: unknown } | undefined)?.rules;
  return Array.isArray(rules)
    ? rules.filter((r) => typeof r === 'object' && r !== null).map(ruleFromFile)
    : [];
}

export interface EffectiveComparison {
  status: StatusMode;
  headers: HeaderComparisonSettings;
  body: BodyComparisonSettings;
  /** Project rules first, then the request's (§4.5). */
  rules: FieldRule[];
  baseline: NonNullable<ProjectComparisonConfig['baseline']>;
}

/** What a request is compared with: project defaults, overridden by its `compare.json`. */
export function effectiveComparison(
  model: Pick<ProjectModel, 'comparison'>,
  request: { comparison?: ProjectComparisonConfig | undefined },
): EffectiveComparison {
  const config = request.comparison;
  const project = (model.comparison ?? {}) as { status?: unknown; headers?: unknown };
  return {
    status: statusMode(config?.status, statusMode(project.status, 'exact')),
    headers: headerSettings(config?.headers, headerSettings(project.headers)),
    body: bodySettings(config?.body, projectBodySettings(model)),
    rules: [...projectRules(model), ...(config?.rules ?? [])] as FieldRule[],
    baseline: config?.baseline ?? { mode: 'auto' },
  };
}

/** The baseline example for a response, per the request's baseline mode (§2). */
export function baselineFor(
  examples: readonly ProjectExample[],
  baseline: EffectiveComparison['baseline'],
  status: number | undefined,
): ProjectExample | undefined {
  if (baseline.mode === 'none') return undefined;
  if (baseline.mode === 'example') return examples.find((e) => e.id === baseline.exampleId);
  return selectBaseline(examples, status);
}

/** `config` with `rule` added: flags merge into an existing rule for the same path. */
export function upsertRule(
  config: ProjectComparisonConfig | undefined,
  rule: ProjectFieldRule,
): ProjectComparisonConfig {
  const base = config ?? { rules: [], extra: {} };
  const index = base.rules.findIndex((r) => r.path === rule.path);
  const rules =
    index === -1
      ? [...base.rules, rule]
      : base.rules.map((r, i) => (i === index ? { ...r, ...rule } : r));
  return { ...base, rules };
}

/** `auto` baseline (§2): first example with `status`, else the first example. */
export function selectBaseline(
  examples: readonly ProjectExample[],
  status: number | undefined,
): ProjectExample | undefined {
  return examples.find((example) => example.response.code === status) ?? examples[0];
}

export interface ComparisonResult {
  requestId: string;
  exampleId: string;
  exampleName: string;
  executionId: string;
  outcome: Outcome;
  counts: { fail: number; warn: number; info: number; ignored: number };
  findings: Finding[];
  /** ISO time. */
  comparedAt: string;
}

export type ComparisonOutcome =
  { kind: 'compared'; result: ComparisonResult } | { kind: 'no-baseline'; requestId: string };

/** What a body comparison needs, as plain data (worker-friendly). */
export interface BodyComparisonInput {
  /** `undefined`: the baseline has no body (or a binary one). */
  baselineText: string | undefined;
  baselineFormat: ExampleBodyFormat | 'binary' | 'none';
  actualText: string | undefined;
  actualContentType: string | undefined;
  /** Hash key for the snapshot cache (e.g. the example id + body hash). */
  baselineKey?: string;
  /** Status and headers (§3.1–3.2), when they are compared. */
  baselineStatus?: number;
  actualStatus?: number;
  baselineHeaders?: Array<[string, string]>;
  actualHeaders?: Array<[string, string]>;
  /** Web: headers hidden by CORS can't be checked. */
  headersRestricted?: boolean;
  /** Binary bodies (values mode): hash and size. */
  baselineBinary?: { hash: string; size: number };
  actualBinary?: { hash: string; size: number };
}

/** FNV-1a over bytes. */
export function quickHashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Every section (§3): status, headers, body; then the rules. Plain data in and out. */
export function compareResponseInput(
  input: BodyComparisonInput,
  effective: Pick<EffectiveComparison, 'status' | 'headers' | 'body' | 'rules'>,
): Finding[] {
  const findings: Finding[] = [];
  if (input.baselineStatus !== undefined && input.actualStatus !== undefined) {
    findings.push(...compareStatus(input.baselineStatus, input.actualStatus, effective.status));
  }
  if (input.baselineHeaders && input.actualHeaders) {
    findings.push(
      ...compareHeaders(input.baselineHeaders, input.actualHeaders, {
        ...effective.headers,
        restricted: input.headersRestricted === true,
      }),
    );
  }
  findings.push(...compareBodyStructure(input, effective.body, effective.rules));
  return applyRules(findings, effective.rules);
}

/** FNV-1a: a cheap, stable hash for cache keys (not security). */
export function quickHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

const SNAPSHOT_CACHE_SIZE = 20;
const snapshots = new Map<string, SchemaNode>();

function snapshot(text: string, value: unknown, settings: BodyComparisonSettings): SchemaNode {
  const key = `${quickHash(text)}:${text.length}:${settings.distinguishIntegers}`;
  const cached = snapshots.get(key);
  if (cached) return cached;
  const node = inferSchema(value, { distinguishIntegers: settings.distinguishIntegers });
  snapshots.set(key, node);
  if (snapshots.size > SNAPSHOT_CACHE_SIZE) snapshots.delete(snapshots.keys().next().value!);
  return node;
}

function parseJson(text: string | undefined): { ok: true; value: unknown } | { ok: false } {
  if (text === undefined) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Body findings (§3.3): content-type category, parse failure, then the JSON comparator. */
export function compareBodyTexts(
  input: BodyComparisonInput,
  settings: BodyComparisonSettings = DEFAULT_BODY_COMPARISON,
  rules: readonly FieldRule[] = [],
): Finding[] {
  return applyRules(compareBodyStructure(input, settings, rules), rules);
}

function compareBodyStructure(
  input: BodyComparisonInput,
  settings: BodyComparisonSettings,
  rules: readonly FieldRule[],
): Finding[] {
  if (settings.mode === 'none') return [];
  const baseline =
    input.baselineFormat === 'json' ? parseJson(input.baselineText) : ({ ok: false } as const);
  const baselineIsJson = baseline.ok;
  const actualType = parseMediaType(input.actualContentType)?.type;
  const actualIsJson = actualType !== undefined && isJsonMediaType(actualType);
  if (baselineIsJson !== actualIsJson) {
    return [
      {
        kind: 'body.contentType.changed',
        severity: 'fail',
        baseline: baselineIsJson ? 'JSON' : input.baselineFormat,
        actual: actualType ?? 'unknown',
        message: `Content type changed: the baseline is ${baselineIsJson ? 'JSON' : `not JSON (${input.baselineFormat})`}, the response is ${actualType ?? 'of unknown type'}; the body is not compared`,
      },
    ];
  }
  if (!baselineIsJson) {
    const mode = settings.mode === 'values' ? 'values' : 'schema';
    if (input.baselineText !== undefined && input.actualText !== undefined) {
      return compareText(input.baselineText, input.actualText, mode);
    }
    if (input.baselineBinary && input.actualBinary) {
      return compareBinary(input.baselineBinary, input.actualBinary, mode);
    }
    return [
      {
        kind: 'body.value.changed',
        severity: 'info',
        message: 'Body not compared (no text to compare)',
      },
    ];
  }
  const actual = parseJson(input.actualText);
  if (!actual.ok) {
    return [
      {
        kind: 'body.parse.failed',
        severity: 'fail',
        message: 'The response says JSON but its body could not be parsed',
      },
    ];
  }
  const structure = compareJson(
    snapshot(input.baselineText!, baseline.value, settings),
    actual.value,
    {
      additionalFields: settings.additionalFields,
      distinguishIntegers: settings.distinguishIntegers,
      rules,
    },
  );
  if (settings.mode !== 'values') return structure;
  return [
    ...structure,
    ...compareValues(baseline.value, actual.value, { arrays: settings.arrays ?? 'index' }),
  ];
}

/** The plain-data input for `example` vs the response of `result`. */
export function bodyComparisonInput(
  example: ProjectExample,
  result: ExecutionResult,
): BodyComparisonInput {
  const body = example.response.body;
  const response = result.response;
  const baselineBytes = body.kind === 'binary' ? decodeBase64(body.base64) : undefined;
  return {
    baselineText: body.kind === 'text' ? body.text : undefined,
    baselineFormat: body.kind === 'text' ? body.format : body.kind === 'binary' ? 'binary' : 'none',
    actualText: response?.bodyText,
    actualContentType: response?.contentType,
    baselineKey: example.id,
    baselineStatus: example.response.code,
    ...(response ? { actualStatus: response.status } : {}),
    baselineHeaders: example.response.headers
      .filter((header) => !header.disabled)
      .map((header): [string, string] => [header.key, header.value]),
    ...(response
      ? { actualHeaders: response.headers, headersRestricted: response.headersRestricted }
      : {}),
    ...(baselineBytes
      ? { baselineBinary: { hash: quickHashBytes(baselineBytes), size: baselineBytes.byteLength } }
      : {}),
    ...(response && response.bodyText === undefined
      ? { actualBinary: { hash: quickHashBytes(response.body), size: response.body.byteLength } }
      : {}),
  };
}

/** Wraps body findings into a `ComparisonResult`. */
export function comparisonResult(
  requestId: string,
  example: ProjectExample,
  result: ExecutionResult,
  findings: Finding[],
): ComparisonResult {
  const { outcome, counts } = summarize(findings);
  return {
    requestId,
    exampleId: example.id,
    exampleName: example.name,
    executionId: result.id,
    outcome,
    counts,
    findings,
    comparedAt: new Date().toISOString(),
  };
}

/**
 * Compares `result` with the request's baseline (synchronous; the UI runs big bodies in a
 * worker via `compareBodyTexts`). `undefined` when there is no response to compare.
 */
export function compareExecution(
  request: { id: string; examples: readonly ProjectExample[] },
  result: ExecutionResult,
  settings: BodyComparisonSettings = DEFAULT_BODY_COMPARISON,
  options: Partial<Pick<EffectiveComparison, 'status' | 'headers' | 'baseline'>> & {
    rules?: readonly FieldRule[];
  } = {},
): ComparisonOutcome | undefined {
  if (!result.response) return undefined;
  if (options.baseline?.mode === 'none') return undefined;
  const example = baselineFor(
    request.examples,
    options.baseline ?? { mode: 'auto' },
    result.response.status,
  );
  if (!example) return { kind: 'no-baseline', requestId: request.id };
  const findings = compareResponseInput(bodyComparisonInput(example, result), {
    status: options.status ?? 'exact',
    headers: options.headers ?? DEFAULT_HEADER_COMPARISON,
    body: settings,
    rules: [...(options.rules ?? [])],
  });
  return { kind: 'compared', result: comparisonResult(request.id, example, result, findings) };
}

/** How many comparisons local state keeps (most recent first). */
export const LAST_COMPARISONS_LIMIT = 100;

/** `comparisons` with `result` for its request, bounded to the most recent ones. */
export function rememberComparison(
  comparisons: Readonly<Record<string, ComparisonResult>> | undefined,
  result: ComparisonResult,
): Record<string, ComparisonResult> {
  const entries = Object.entries(comparisons ?? {}).filter(([id]) => id !== result.requestId);
  entries.push([result.requestId, result]);
  return Object.fromEntries(entries.slice(-LAST_COMPARISONS_LIMIT));
}
