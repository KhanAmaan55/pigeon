import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareJson, inferSchema, summarize } from '../src/index';

describe('properties (testing.md §3.7)', () => {
  it('comparing any JSON with itself passes without findings', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.boolean(), (value, distinguishIntegers) => {
        const findings = compareJson(inferSchema(value, { distinguishIntegers }), value, {
          distinguishIntegers,
        });
        expect(findings).toEqual([]);
        expect(summarize(findings).outcome).toBe('pass');
      }),
      { numRuns: 1000 },
    );
  });

  it('inference does not depend on object key order', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 2 })), (object) => {
        const reversed = Object.fromEntries(Object.entries(object).reverse());
        expect(inferSchema(reversed)).toEqual(inferSchema(object));
      }),
      { numRuns: 200 },
    );
  });

  it('an element of a baseline array always matches the merged items', () => {
    fc.assert(
      fc.property(fc.array(fc.jsonValue({ maxDepth: 3 }), { minLength: 1 }), (array) => {
        const findings = compareJson(inferSchema(array), array);
        expect(findings.filter((f) => f.severity === 'fail')).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

describe('de-duplication and summary', () => {
  it('1,000 elements missing one field give one finding with count 1000', () => {
    const baseline = [{ id: 1, name: 'a' }];
    const actual = Array.from({ length: 1000 }, (_, id) => ({ id }));
    const findings = compareJson(inferSchema(baseline), actual);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'body.field.removed',
      schemaPath: '$[*].name',
      count: 1000,
      examplePaths: ['$[0].name', '$[1].name', '$[2].name'],
    });
  });

  it('summarizes outcome and counts', () => {
    expect(summarize([])).toEqual({
      outcome: 'pass',
      counts: { fail: 0, warn: 0, info: 0, ignored: 0 },
    });
    expect(
      summarize([
        { kind: 'body.field.added', severity: 'warn', message: '' },
        { kind: 'body.array.length', severity: 'info', message: '' },
      ]).outcome,
    ).toBe('warn');
    expect(
      summarize([
        { kind: 'body.field.added', severity: 'ignored', message: '' },
        { kind: 'body.type.changed', severity: 'fail', message: '' },
      ]),
    ).toEqual({ outcome: 'fail', counts: { fail: 1, warn: 0, info: 0, ignored: 1 } });
  });
});
