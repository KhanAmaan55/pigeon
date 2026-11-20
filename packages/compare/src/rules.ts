/**
 * Field rules (docs/response-comparison.md §4.5): relax findings per path. Project rules come
 * first, request rules after; a rule can only lower a severity, never raise it. `ignore` covers
 * the path and everything below it; `optional` turns a removed field into a warning; `nullable`
 * accepts null ↔ value; `dynamic` accepts value changes. `type` rules are applied inside
 * `compareJson`: they add allowed types at their path (`any`: any type), never remove one.
 */

import { matchPath, parsePath } from './path';
import type { FieldRule, Finding, JsonType, Severity } from './types';

const RANK: Record<Severity, number> = { ignored: 0, info: 1, warn: 2, fail: 3 };

/** Why `path` isn't a valid rule path, or `undefined` when it is. */
export function validateRulePath(path: string): string | undefined {
  if (path.trim() === '') return 'Enter a path, e.g. $.data[*].id';
  if (!path.startsWith('$')) return 'A path starts with $ (the root), e.g. $.user.name';
  try {
    parsePath(path);
    return undefined;
  } catch {
    return 'Not a valid path: use .name, ["na.me"], [*], .* or ..name after $';
  }
}

/** Whether `rule` applies to `finding` (`orBelow`: also to anything under the rule's path). */
function applies(rule: FieldRule, finding: Finding, orBelow: boolean): boolean {
  if (validateRulePath(rule.path) !== undefined) return false;
  const paths = [finding.path, finding.schemaPath].filter((p): p is string => p !== undefined);
  return paths.some((path) => matchPath(rule.path, path, { orBelow }));
}

function involvesNull(finding: Finding): boolean {
  return finding.baseline === 'null' || finding.actual === 'null';
}

/**
 * `findings` with the rules applied. Findings a rule accepts (nullable, dynamic) are dropped;
 * ignored ones stay with severity `ignored` (the UI hides them unless asked).
 */
export function applyRules(findings: readonly Finding[], rules: readonly FieldRule[]): Finding[] {
  if (rules.length === 0) return [...findings];
  const out: Finding[] = [];
  for (const finding of findings) {
    let severity = finding.severity;
    let rule: FieldRule | undefined;
    let accepted = false;
    const relax = (to: Severity, by: FieldRule) => {
      if (RANK[to] < RANK[severity]) {
        severity = to;
        rule = by;
      }
    };
    for (const candidate of rules) {
      if (candidate.ignore && applies(candidate, finding, true)) relax('ignored', candidate);
      if (!applies(candidate, finding, false)) continue;
      if (candidate.optional && finding.kind === 'body.field.removed') relax('warn', candidate);
      if (candidate.nullable && finding.kind === 'body.type.changed' && involvesNull(finding)) {
        accepted = true;
      }
      if (candidate.dynamic && finding.kind === 'body.value.changed') accepted = true;
    }
    if (accepted) continue;
    if (severity === finding.severity) out.push(finding);
    else {
      out.push({
        ...finding,
        severity,
        rule: rule!,
        message:
          severity === 'ignored'
            ? `${finding.message} (ignored by rule)`
            : `${finding.message} (relaxed by rule)`,
      });
    }
  }
  return out;
}

/** The types a `type` rule allows at `path`, or `undefined` when no rule says. */
export function typeOverride(
  rules: readonly FieldRule[],
  path: string,
  schemaPath: string,
): JsonType[] | 'any' | undefined {
  let found: JsonType[] | 'any' | undefined;
  for (const rule of rules) {
    if (rule.type === undefined || validateRulePath(rule.path) !== undefined) continue;
    if (!matchPath(rule.path, path) && !matchPath(rule.path, schemaPath)) continue;
    found = rule.type === 'any' ? 'any' : Array.isArray(rule.type) ? rule.type : [rule.type];
  }
  return found;
}
