import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { FieldRule, Finding } from '../src/index';
import { applyRules, compareJson, inferSchema, summarize, validateRulePath } from '../src/index';

const run = (baseline: unknown, actual: unknown, rules: FieldRule[] = []) =>
  applyRules(compareJson(inferSchema(baseline), actual, { rules }), rules);

const RANK = { pass: 0, warn: 1, fail: 2 } as const;

describe('field rules (response-comparison §4.5)', () => {
  it('optional turns a removed field into a warning', () => {
    const findings = run({ id: 1, name: 'a' }, { id: 1 }, [{ path: '$.name', optional: true }]);
    expect(findings).toEqual([
      expect.objectContaining({
        kind: 'body.field.removed',
        severity: 'warn',
        rule: { path: '$.name', optional: true },
        message: 'Field removed (was string) (relaxed by rule)',
      }),
    ]);
    expect(summarize(findings).outcome).toBe('warn');
  });

  it('ignore covers the path and everything below it', () => {
    const findings = run(
      { meta: { a: 1, b: { c: 'x' } }, id: 1 },
      { meta: { a: 'changed', b: {}, extra: true }, id: '2' },
      [{ path: '$.meta', ignore: true }],
    );
    expect(findings.filter((f) => f.severity !== 'ignored').map((f) => f.path)).toEqual(['$.id']);
    expect(
      findings
        .filter((f) => f.severity === 'ignored')
        .map((f) => f.path)
        .sort(),
    ).toEqual(['$.meta.a', '$.meta.b.c', '$.meta.extra']);
  });

  it('nullable accepts null in place of a value and a value in place of null', () => {
    expect(run({ name: 'a' }, { name: null }, [{ path: '$.name', nullable: true }])).toEqual([]);
    expect(run({ name: null }, { name: 'a' }, [{ path: '$.name', nullable: true }])).toEqual([]);
    // Not other type changes.
    expect(run({ name: 'a' }, { name: 1 }, [{ path: '$.name', nullable: true }])).toHaveLength(1);
  });

  it('dynamic accepts value changes (values mode)', () => {
    const value: Finding = {
      kind: 'body.value.changed',
      path: '$.at',
      severity: 'fail',
      message: 'x',
    };
    expect(applyRules([value], [{ path: '$.at', dynamic: true }])).toEqual([]);
  });

  it('type rules add allowed types at the path (never remove one)', () => {
    expect(run({ id: 1 }, { id: '1' }, [{ path: '$.id', type: ['number', 'string'] }])).toEqual([]);
    expect(run({ id: 1 }, { id: '1' }, [{ path: '$.id', type: 'string' }])).toEqual([]);
    expect(run({ id: 1 }, { id: true }, [{ path: '$.id', type: 'any' }])).toEqual([]);
    expect(run({ id: 1 }, { id: 1 }, [{ path: '$.id', type: 'string' }])).toEqual([]);
    expect(run({ id: 1 }, { id: true }, [{ path: '$.id', type: 'string' }])).toEqual([
      expect.objectContaining({ message: 'Type changed from number to boolean' }),
    ]);
  });

  it('project rules (..name) apply anywhere; a rule never escalates', () => {
    const rules: FieldRule[] = [{ path: '$..requestId', ignore: true }];
    const findings = run(
      { data: [{ requestId: 'a' }], requestId: 'x' },
      { data: [{ requestId: 1 }], requestId: 2 },
      rules,
    );
    expect(findings.every((f) => f.severity === 'ignored')).toBe(true);
    // optional on an added (warn) field leaves it a warning; on an info stays info.
    const added = run({}, { x: 1 }, [{ path: '$.x', optional: true }]);
    expect(added[0]?.severity).toBe('warn');
  });

  it('matches by schema path for array elements', () => {
    const findings = run(
      [{ id: 1, name: 'a' }],
      [{ id: 1 }, { id: 2 }],
      [{ path: '$[*].name', optional: true }],
    );
    expect(findings).toEqual([expect.objectContaining({ severity: 'warn', count: 2 })]);
  });

  it('validates rule paths with an explanation', () => {
    expect(validateRulePath('$.data[*].id')).toBeUndefined();
    expect(validateRulePath('$..requestId')).toBeUndefined();
    expect(validateRulePath('')).toMatch(/Enter a path/);
    expect(validateRulePath('data.id')).toMatch(/starts with \$/);
    expect(validateRulePath('$.a[x]')).toMatch(/Not a valid path/);
    // Invalid rules do nothing.
    expect(run({ a: 1 }, {}, [{ path: 'a', ignore: true }])[0]?.severity).toBe('fail');
  });

  it('property: adding any rule never increases the outcome severity', () => {
    const rule = fc.record(
      {
        path: fc.constantFrom('$', '$.a', '$.a[*]', '$.a[*].b', '$..b', '$.*', '$.c', '$["x.y"]'),
        optional: fc.boolean(),
        nullable: fc.boolean(),
        ignore: fc.boolean(),
        dynamic: fc.boolean(),
        type: fc.oneof(
          fc.constant('any' as const),
          fc.constantFrom('string' as const, 'number' as const, 'null' as const, 'object' as const),
          fc.subarray(['string', 'number', 'null', 'array'] as const),
        ),
      },
      { requiredKeys: ['path'] },
    );
    fc.assert(
      fc.property(
        fc.jsonValue({ maxDepth: 3 }),
        fc.jsonValue({ maxDepth: 3 }),
        fc.array(rule, { maxLength: 4 }),
        (baseline, actual, rules) => {
          const without = summarize(run(baseline, actual)).outcome;
          const withRules = summarize(run(baseline, actual, rules)).outcome;
          expect(RANK[withRules]).toBeLessThanOrEqual(RANK[without]);
        },
      ),
      { numRuns: 500 },
    );
  });
});
