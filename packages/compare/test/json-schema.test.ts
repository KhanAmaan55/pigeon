/**
 * JSON Schema export (PIGN-056): the mapping, and an ajv (draft 2020-12) cross-check that the
 * schema accepts exactly what schema-mode comparison does not fail.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CompareOptions, FieldRule } from '../src/index';
import {
  applyRules,
  compareJson,
  inferSchema,
  JSON_SCHEMA_DIALECT,
  toJsonSchema,
} from '../src/index';

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });

function validates(schema: object, value: unknown): boolean {
  return ajv.validate(schema, value) as boolean;
}

/** Comparison as a run does it (rules applied); `true` when nothing fails. */
function passes(baseline: unknown, actual: unknown, options: CompareOptions = {}): boolean {
  const findings = applyRules(
    compareJson(inferSchema(baseline, options), actual, options),
    options.rules ?? [],
  );
  return !findings.some((f) => f.severity === 'fail');
}

function schemaOf(baseline: unknown, options: CompareOptions = {}) {
  return toJsonSchema(inferSchema(baseline, options), {
    ...(options.rules ? { rules: options.rules } : {}),
    ...(options.additionalFields ? { additionalFields: options.additionalFields } : {}),
  });
}

describe('toJsonSchema (PIGN-056)', () => {
  const baseline = {
    id: 1,
    name: 'Ada',
    tags: ['a', 'b'],
    manager: null,
    items: [
      { sku: 'x', qty: 1, note: 'gift' },
      { sku: 'y', qty: 2 },
    ],
  };

  it('maps types, required keys, items and implicitly optional keys', () => {
    expect(schemaOf(baseline)).toEqual({
      $schema: JSON_SCHEMA_DIALECT,
      type: 'object',
      properties: {
        id: { type: 'number' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              note: { type: 'string' },
              qty: { type: 'number' },
              sku: { type: 'string' },
            },
            required: ['qty', 'sku'],
          },
        },
        // Only null in the baseline: the type is unknown, anything goes.
        manager: {},
        name: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'items', 'manager', 'name', 'tags'],
    });
  });

  it('is deterministic: the same output whatever the key order of the baseline', () => {
    const shuffled = { tags: ['b'], manager: null, items: baseline.items, name: 'x', id: 2 };
    expect(JSON.stringify(schemaOf(shuffled))).toBe(JSON.stringify(schemaOf(baseline)));
    expect(Object.keys(toJsonSchema(inferSchema(1), { title: 'T', description: 'D' }))).toEqual([
      '$schema',
      'title',
      'description',
      'type',
    ]);
  });

  it('applies rules: optional, nullable, ignore, type and additionalFields: fail', () => {
    const rules: FieldRule[] = [
      { path: '$.name', optional: true },
      { path: '$.id', nullable: true },
      { path: '$.items[*].sku', type: ['string', 'number'] },
      { path: '$.tags', ignore: true },
      { path: '$..qty', type: 'any' },
    ];
    const schema = schemaOf(baseline, { rules, additionalFields: 'fail' });
    const properties = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(schema['required']).toEqual(['id', 'items', 'manager']);
    expect(schema['additionalProperties']).toBe(false);
    expect(properties['id']).toEqual({ type: ['null', 'number'] });
    expect(properties['tags']).toEqual({});
    const item = (properties['items']!['items'] as Record<string, Record<string, unknown>>)!;
    expect(item['properties']).toEqual({
      note: { type: 'string' },
      qty: {},
      sku: { type: ['number', 'string'] },
    });
    expect(item['additionalProperties']).toBe(false);
  });

  it('a body that lost a required field fails validation; the baseline itself validates', () => {
    const schema = schemaOf(baseline);
    expect(validates(schema, baseline)).toBe(true);
    const { name: _name, ...withoutName } = baseline;
    expect(passes(baseline, withoutName)).toBe(false);
    expect(validates(schema, withoutName)).toBe(false);
    expect(ajv.errors?.[0]).toMatchObject({
      keyword: 'required',
      params: { missingProperty: 'name' },
    });
    // Optional by rule: both comparison and schema accept it.
    const rules = [{ path: '$.name', optional: true }];
    expect(passes(baseline, withoutName, { rules })).toBe(true);
    expect(validates(schemaOf(baseline, { rules }), withoutName)).toBe(true);
  });
});

interface Case {
  name: string;
  baseline: unknown;
  actual: unknown;
  options?: CompareOptions;
}

describe('ajv cross-check on the comparison cases', () => {
  const directory = join(import.meta.dirname, 'cases');
  const cases = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .flatMap((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')) as Case[]);

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const schema = schemaOf(c.baseline, c.options);
    expect(validates(schema, c.baseline)).toBe(true);
    // Every case's verdict agrees: the schema accepts exactly what comparison doesn't fail.
    expect(validates(schema, c.actual)).toBe(passes(c.baseline, c.actual, c.options));
  });
});

describe('properties', () => {
  const json = fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.string(),
      fc.array(tie('value'), { maxLength: 4 }),
      fc.dictionary(fc.string({ maxLength: 6 }), tie('value'), { maxKeys: 4 }),
    ),
  })).value;

  it('the schema of a value always validates that value', () => {
    fc.assert(
      fc.property(json, (value) => validates(schemaOf(value), value)),
      { numRuns: 300 },
    );
  });

  it('whatever comparison passes, the schema validates', () => {
    fc.assert(
      fc.property(json, json, (baseline, actual) => {
        if (passes(baseline, actual)) expect(validates(schemaOf(baseline), actual)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
