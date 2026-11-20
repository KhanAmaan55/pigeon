/**
 * Comparing a response with its request's baseline example (docs/response-comparison.md §2–4,
 * PIGN-034). Baseline selection `auto`: the first example with the response's status code, else
 * the first example. Body only for now (status, headers and values arrive with PIGN-036).
 *
 * `compareBodyTexts` takes plain strings so a worker can run it; schema snapshots are cached by
 * a hash of the baseline body and the settings (derived data, never committed).
 */

import type { Finding, Outcome, SchemaNode } from '@pigeon/compare';
import { compareJson, inferSchema, summarize } from '@pigeon/compare';
import type { ExampleBodyFormat, ProjectExample } from '@pigeon/formats';

import { isJsonMediaType, parseMediaType } from '../execution/response';
import type { ExecutionResult } from '../execution/types';
import type { ProjectModel } from '../model/project';

export interface BodyComparisonSettings {
  mode: 'schema' | 'values' | 'none';
  additionalFields: 'ignore' | 'warn' | 'fail';
  distinguishIntegers: boolean;
}

export const DEFAULT_BODY_COMPARISON: Readonly<BodyComparisonSettings> = Object.freeze({
  mode: 'schema',
  additionalFields: 'warn',
  distinguishIntegers: false,
});

/** The project's body defaults (`pigeon.json` `comparison.body`), else the built-in ones. */
export function projectBodySettings(
  model: Pick<ProjectModel, 'comparison'>,
): BodyComparisonSettings {
  const body = (model.comparison as { body?: Partial<BodyComparisonSettings> } | undefined)?.body;
  const pick = <K extends keyof BodyComparisonSettings>(key: K, allowed: readonly unknown[]) =>
    body && allowed.includes(body[key])
      ? (body[key] as BodyComparisonSettings[K])
      : DEFAULT_BODY_COMPARISON[key];
  return {
    mode: pick('mode', ['schema', 'values', 'none']),
    additionalFields: pick('additionalFields', ['ignore', 'warn', 'fail']),
    distinguishIntegers: pick('distinguishIntegers', [true, false]),
  };
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
    return [
      {
        kind: 'body.value.changed',
        severity: 'info',
        message: 'Text body not compared structurally',
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
  return compareJson(snapshot(input.baselineText!, baseline.value, settings), actual.value, {
    additionalFields: settings.additionalFields,
    distinguishIntegers: settings.distinguishIntegers,
  });
}

/** The plain-data input for `example` vs the response of `result`. */
export function bodyComparisonInput(
  example: ProjectExample,
  result: ExecutionResult,
): BodyComparisonInput {
  const body = example.response.body;
  return {
    baselineText: body.kind === 'text' ? body.text : undefined,
    baselineFormat: body.kind === 'text' ? body.format : body.kind === 'binary' ? 'binary' : 'none',
    actualText: result.response?.bodyText,
    actualContentType: result.response?.contentType,
    baselineKey: example.id,
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
): ComparisonOutcome | undefined {
  if (!result.response) return undefined;
  const example = selectBaseline(request.examples, result.response.status);
  if (!example) return { kind: 'no-baseline', requestId: request.id };
  const findings = compareBodyTexts(bodyComparisonInput(example, result), settings);
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
