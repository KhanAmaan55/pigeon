import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { stringifyCanonical } from '../src/canonical-json';
import { PROJECT_KEY_ORDERS } from '../src/project/key-order';

describe('stringifyCanonical', () => {
  it('makes insertion order irrelevant while preserving known key order', () => {
    const first = { zebra: 1, name: 'Users', alpha: 2, id: 'collection-1', _pigeon: { z: 1 } };
    const second = { _pigeon: { z: 1 }, alpha: 2, id: 'collection-1', zebra: 1, name: 'Users' };

    const options = { keyOrder: PROJECT_KEY_ORDERS.folder };
    expect(stringifyCanonical(first, options)).toBe(stringifyCanonical(second, options));
    expect(stringifyCanonical(first, options)).toBe(
      '{\n  "id": "collection-1",\n  "name": "Users",\n  "alpha": 2,\n  "zebra": 1,\n  "_pigeon": {\n    "z": 1\n  }\n}\n',
    );
  });

  it('selects an order for nested objects by their property path', () => {
    const output = stringifyCanonical(
      {
        request: {
          url: { zebra: 1, raw: 'https://example.test', query: [] },
          description: 'Example',
          method: 'GET',
        },
        name: 'Get example',
        id: 'request-1',
      },
      { keyOrder: PROJECT_KEY_ORDERS.request },
    );

    expect(output).toBe(
      '{\n  "id": "request-1",\n  "name": "Get example",\n  "request": {\n    "method": "GET",\n    "url": {\n      "raw": "https://example.test",\n      "query": [],\n      "zebra": 1\n    },\n    "description": "Example"\n  }\n}\n',
    );
  });

  it('omits undefined object keys and follows JSON array semantics for undefined', () => {
    expect(stringifyCanonical({ kept: true, omitted: undefined, array: [undefined, 1] })).toBe(
      '{\n  "array": [\n    null,\n    1\n  ],\n  "kept": true\n}\n',
    );
  });

  it('uses LF-only output, one final newline, and literal non-ASCII characters', () => {
    const output = stringifyCanonical({ greeting: 'こんにちは\r\nworld', emoji: '🕊️' });

    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
    expect(output).not.toContain('\r');
    expect(output).toContain('こんにちは');
    expect(output).toContain('🕊️');
    expect(output).not.toContain('\\u3053');
  });

  it('round-trips every generated JSON value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(stringifyCanonical(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      { numRuns: 200 },
    );
  });
});

describe('stringifyCanonical edge cases', () => {
  it('rejects undefined at the root and circular values', () => {
    expect(() => stringifyCanonical(undefined)).toThrow(TypeError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => stringifyCanonical(circular)).toThrow(/circular/);
  });

  it('drops functions and symbols in objects and writes null for them in arrays', () => {
    const fn = (): void => undefined;
    expect(stringifyCanonical({ fn, sym: Symbol('x'), list: [fn, Symbol('y')] })).toBe(
      '{\n  "list": [\n    null,\n    null\n  ]\n}\n',
    );
    expect(stringifyCanonical({ only: undefined })).toBe('{}\n');
    expect(stringifyCanonical([])).toBe('[]\n');
  });

  it('sorts unknown keys by code point, after known keys, with _pigeon last', () => {
    const spec = { kinds: { root: ['b', '_pigeon', 'a'] }, kindForPath: () => 'root' };
    const output = stringifyCanonical(
      { _pigeon: 1, '𝒳': 1, z: 1, ab: 1, aa: 1, a: 1, b: 1, a2: 1 },
      { keyOrder: spec },
    );
    expect(Object.keys(JSON.parse(output))).toEqual([
      'b',
      'a',
      'a2',
      'aa',
      'ab',
      'z',
      '𝒳',
      '_pigeon',
    ]);
  });

  it('falls back to code-point order when the kind is unknown to the spec', () => {
    const spec = { kinds: {}, kindForPath: () => 'missing' };
    expect(Object.keys(JSON.parse(stringifyCanonical({ b: 1, a: 1 }, { keyOrder: spec })))).toEqual(
      ['a', 'b'],
    );
  });

  it('is independent of insertion order for arbitrary objects', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (record) => {
        const reversed = Object.fromEntries(Object.entries(record).reverse());
        expect(stringifyCanonical(reversed)).toBe(stringifyCanonical(record));
      }),
      { numRuns: 100 },
    );
  });
});
