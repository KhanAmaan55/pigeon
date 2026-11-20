/**
 * `compare.json` ⇄ `ProjectComparisonConfig` (file-format.md §2.7, PIGN-035). Only the keys a
 * config sets are written; rules are sorted by path, then by their JSON.
 */

import { asArray, asObject, asString, isObject, nonEmpty, type JsonObject } from '../postman/json';
import type { ProjectComparisonConfig, ProjectFieldRule } from './types';

export const COMPARE_FILE = 'compare.json';
export const COMPARE_FORMAT = 1;

const RULE_FLAGS = ['optional', 'nullable', 'ignore', 'dynamic'] as const;

export function ruleFromFile(raw: unknown): ProjectFieldRule {
  const rest = { ...asObject(raw) };
  const rule: ProjectFieldRule = { path: asString(rest['path']) };
  delete rest['path'];
  for (const flag of RULE_FLAGS) {
    if (typeof rest[flag] === 'boolean') {
      rule[flag] = rest[flag] as boolean;
      delete rest[flag];
    }
  }
  const type = rest['type'];
  if (
    typeof type === 'string' ||
    (Array.isArray(type) && type.every((t) => typeof t === 'string'))
  ) {
    rule.type = type as string | string[];
    delete rest['type'];
  }
  if (typeof rest['note'] === 'string') {
    rule.note = rest['note'];
    delete rest['note'];
  }
  if (nonEmpty(rest)) rule.extra = rest;
  return rule;
}

export function ruleToFile(rule: ProjectFieldRule): JsonObject {
  return {
    ...rule.extra,
    path: rule.path,
    ...Object.fromEntries(
      RULE_FLAGS.filter((flag) => rule[flag] !== undefined).map((flag) => [flag, rule[flag]]),
    ),
    ...(rule.type === undefined ? {} : { type: rule.type }),
    ...(rule.note === undefined ? {} : { note: rule.note }),
  };
}

/** Rules in file order: by path, then by JSON (deterministic diffs). */
export function sortRules(rules: readonly ProjectFieldRule[]): ProjectFieldRule[] {
  const key = (rule: ProjectFieldRule) => JSON.stringify(ruleToFile(rule));
  return [...rules].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
  );
}

function baselineFromFile(raw: unknown): ProjectComparisonConfig['baseline'] | undefined {
  const value = asObject(raw);
  if (value['mode'] === 'auto' || value['mode'] === 'none') return { mode: value['mode'] };
  if (value['mode'] === 'example' && typeof value['exampleId'] === 'string') {
    return { mode: 'example', exampleId: value['exampleId'] };
  }
  return undefined;
}

export function comparisonFromFile(raw: JsonObject): {
  requestId: string;
  config: ProjectComparisonConfig;
} {
  const rest = { ...raw };
  const requestId = asString(rest['requestId']);
  delete rest['requestId'];
  delete rest['pigeonCompare'];
  const config: ProjectComparisonConfig = { rules: [], extra: {} };
  const baseline = baselineFromFile(rest['baseline']);
  if (baseline) {
    config.baseline = baseline;
    delete rest['baseline'];
  }
  if (typeof rest['status'] === 'string') {
    config.status = rest['status'];
    delete rest['status'];
  }
  if (isObject(rest['headers'])) {
    config.headers = rest['headers'];
    delete rest['headers'];
  }
  if (isObject(rest['body'])) {
    config.body = rest['body'];
    delete rest['body'];
  }
  if (Array.isArray(rest['rules'])) {
    config.rules = asArray(rest['rules']).filter(isObject).map(ruleFromFile);
    delete rest['rules'];
  }
  config.extra = rest;
  return { requestId, config };
}

export function comparisonToFile(requestId: string, config: ProjectComparisonConfig): JsonObject {
  return {
    ...config.extra,
    pigeonCompare: COMPARE_FORMAT,
    requestId,
    ...(config.baseline === undefined ? {} : { baseline: config.baseline }),
    ...(config.status === undefined ? {} : { status: config.status }),
    ...(config.headers === undefined ? {} : { headers: config.headers }),
    ...(config.body === undefined ? {} : { body: config.body }),
    ...(config.rules.length === 0 ? {} : { rules: sortRules(config.rules).map(ruleToFile) }),
  };
}

/** True when a config sets nothing (no file is written for it). */
export function isEmptyComparison(config: ProjectComparisonConfig | undefined): boolean {
  return (
    !config ||
    (config.baseline === undefined &&
      config.status === undefined &&
      config.headers === undefined &&
      config.body === undefined &&
      config.rules.length === 0 &&
      !nonEmpty(config.extra))
  );
}
