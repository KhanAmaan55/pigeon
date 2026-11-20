/**
 * Structural comparison (docs/response-comparison.md §4.3, `body.mode: 'schema'`): walks the
 * actual value against the baseline schema. Values are not compared. Findings at array
 * elements are de-duplicated by `schemaPath` + kind (`count`, first 3 concrete paths).
 * Iterative, like inference.
 */

import { describeTypes, jsonTypeOf } from './json-type';
import { keySegment } from './path';
import { typeOverride } from './rules';
import type { CompareOptions, Finding, FindingKind, SchemaNode, Severity } from './types';

interface Entry {
  node: SchemaNode;
  value: unknown;
  path: string;
  schemaPath: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ADDED_SEVERITY: Record<NonNullable<CompareOptions['additionalFields']>, Severity> = {
  ignore: 'ignored',
  warn: 'warn',
  fail: 'fail',
};

export function compareJson(
  baseline: SchemaNode,
  actual: unknown,
  options: CompareOptions = {},
): Finding[] {
  const distinguishIntegers = options.distinguishIntegers ?? false;
  const addedSeverity = ADDED_SEVERITY[options.additionalFields ?? 'warn'];
  const typeRules = (options.rules ?? []).filter((rule) => rule.type !== undefined);
  const findings: Finding[] = [];
  const byKey = new Map<string, Finding>();

  const report = (
    kind: FindingKind,
    severity: Severity,
    path: string,
    schemaPath: string,
    message: string,
    extra: Partial<Finding> = {},
  ) => {
    const key = `${kind}\u0000${schemaPath}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      if (existing.examplePaths!.length < 3) existing.examplePaths!.push(path);
      return;
    }
    const finding: Finding = { kind, path, schemaPath, severity, message, ...extra };
    // Kept until the end; `count` / `examplePaths` only stay when there was more than one.
    finding.examplePaths = [path];
    byKey.set(key, finding);
    findings.push(finding);
  };

  // Implicitly optional keys (only some baseline array elements had them): an element without
  // one is normal; the key is reported only when no actual object at that place has it.
  const optional = new Map<
    string,
    { present: boolean; paths: string[]; count: number; was: string }
  >();

  const stack: Entry[] = [{ node: baseline, value: actual, path: '$', schemaPath: '$' }];
  while (stack.length > 0) {
    const { node, value, path, schemaPath } = stack.pop()!;
    const type = jsonTypeOf(value, distinguishIntegers);
    // `type` rules (§4.5) widen the baseline's types at their path (rules only relax).
    const override = typeRules.length > 0 ? typeOverride(typeRules, path, schemaPath) : undefined;
    if (override === 'any') continue;
    if (override?.includes(type) && !node.types.includes(type)) continue; // allowed; no shape to check
    const types = node.types;
    if (!types.includes(type)) {
      if (type === 'number' && types.includes('integer')) {
        report('body.type.changed', 'warn', path, schemaPath, 'Widened from integer to number', {
          baseline: 'integer',
          actual: 'number',
        });
        continue;
      }
      if (type === 'integer' && types.includes('number')) {
        // number → integer is fine.
      } else if (types.length === 1 && types[0] === 'null') {
        report(
          'body.type.changed',
          'warn',
          path,
          schemaPath,
          `Baseline had null; type unknown (now ${type})`,
          { baseline: 'null', actual: type },
        );
        continue;
      } else if (type === 'null') {
        report(
          'body.type.changed',
          'fail',
          path,
          schemaPath,
          `Value is null (was ${describeTypes(types)})`,
          {
            baseline: describeTypes(types),
            actual: 'null',
          },
        );
        continue;
      } else {
        report(
          'body.type.changed',
          'fail',
          path,
          schemaPath,
          `Type changed from ${describeTypes(types)} to ${type}`,
          { baseline: describeTypes(types), actual: type },
        );
        continue;
      }
    }

    if (isPlainObject(value)) {
      const properties = node.properties ?? {};
      for (const key of Object.keys(properties)) {
        const property = properties[key]!;
        const childPath = path + keySegment(key);
        const childSchemaPath = schemaPath + keySegment(key);
        const isOptional = property.seen < property.of;
        if (isOptional) {
          let entry = optional.get(childSchemaPath);
          if (!entry) {
            entry = {
              present: false,
              paths: [],
              count: 0,
              was: describeTypes(property.node.types),
            };
            optional.set(childSchemaPath, entry);
          }
          if (Object.hasOwn(value, key)) entry.present = true;
          else {
            entry.count += 1;
            if (entry.paths.length < 3) entry.paths.push(childPath);
          }
        }
        if (!Object.hasOwn(value, key)) {
          if (!isOptional) {
            report(
              'body.field.removed',
              'fail',
              childPath,
              childSchemaPath,
              `Field removed (was ${describeTypes(property.node.types)})`,
              { baseline: describeTypes(property.node.types) },
            );
          }
        } else {
          stack.push({
            node: property.node,
            value: value[key],
            path: childPath,
            schemaPath: childSchemaPath,
          });
        }
      }
      for (const key of Object.keys(value)) {
        if (Object.hasOwn(properties, key)) continue;
        const added = jsonTypeOf(value[key], distinguishIntegers);
        report(
          'body.field.added',
          addedSeverity,
          path + keySegment(key),
          schemaPath + keySegment(key),
          `Field added (${added})`,
          { actual: added },
        );
      }
    } else if (Array.isArray(value)) {
      if (!node.items) {
        if (node.emptyArray && value.length > 0) {
          report(
            'body.field.added',
            'info',
            `${path}[*]`,
            `${schemaPath}[*]`,
            'No baseline items to compare',
            {
              actual: value.length,
            },
          );
        }
        continue;
      }
      if (value.length === 0) {
        if (node.someEmpty) continue;
        report(
          'body.array.length',
          'info',
          path,
          schemaPath,
          'Empty array (the baseline had items; lengths are not compared)',
          { actual: 0 },
        );
        continue;
      }
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({
          node: node.items,
          value: value[i],
          path: `${path}[${i}]`,
          schemaPath: `${schemaPath}[*]`,
        });
      }
    }
  }

  for (const [schemaPath, entry] of optional) {
    if (entry.present || entry.count === 0) continue;
    findings.push({
      kind: 'body.field.removed',
      path: entry.paths[0]!,
      schemaPath,
      severity: 'warn',
      baseline: entry.was,
      message: `Field removed (was ${entry.was}; optional in the baseline array, now missing everywhere)`,
      ...(entry.count > 1 ? { count: entry.count, examplePaths: entry.paths } : {}),
    });
  }
  for (const finding of findings) {
    if (finding.count === undefined) delete finding.examplePaths;
  }
  return findings;
}
