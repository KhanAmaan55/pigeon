import { describe, expect, it } from 'vitest';

import { inferSchema } from '../src/index';

describe('inferSchema (response-comparison §4.2)', () => {
  it('maps scalars, objects and null', () => {
    expect(inferSchema('x')).toEqual({ types: ['string'] });
    expect(inferSchema(null)).toEqual({ types: ['null'] });
    expect(inferSchema({ a: 1, b: { c: true } })).toEqual({
      types: ['object'],
      properties: {
        a: { node: { types: ['number'] }, seen: 1, of: 1 },
        b: {
          node: {
            types: ['object'],
            properties: { c: { node: { types: ['boolean'] }, seen: 1, of: 1 } },
          },
          seen: 1,
          of: 1,
        },
      },
    });
  });

  it('merges array elements: union of types and keys, seen of of', () => {
    expect(inferSchema([{ id: 1, nick: 'a' }, { id: 2, nick: null }, { id: 3 }, 'loose'])).toEqual({
      types: ['array'],
      items: {
        types: ['object', 'string'],
        properties: {
          id: { node: { types: ['number'] }, seen: 3, of: 3 },
          nick: { node: { types: ['null', 'string'] }, seen: 2, of: 3 },
        },
      },
    });
  });

  it('marks empty arrays and splits integers on request', () => {
    expect(inferSchema({ tags: [] })).toEqual({
      types: ['object'],
      properties: { tags: { node: { types: ['array'], emptyArray: true }, seen: 1, of: 1 } },
    });
    expect(inferSchema([1, 1.5], { distinguishIntegers: true }).items).toEqual({
      types: ['integer', 'number'],
    });
  });

  it('is independent of object key order and survives deep nesting', () => {
    expect(inferSchema({ b: 1, a: { y: 2, x: 3 } })).toEqual(
      inferSchema({ a: { x: 3, y: 2 }, b: 1 }),
    );
    expect(Object.keys(inferSchema({ b: 1, a: 2 }).properties!)).toEqual(['a', 'b']);
    let deep: unknown = 1;
    for (let i = 0; i < 20_000; i++) deep = [deep];
    expect(inferSchema(deep).types).toEqual(['array']);
  });

  it('keeps awkward keys as data', () => {
    const schema = inferSchema(JSON.parse('{"__proto__": 1, "constructor": "x"}'));
    expect(Object.keys(schema.properties!)).toEqual(['__proto__', 'constructor']);
  });
});
