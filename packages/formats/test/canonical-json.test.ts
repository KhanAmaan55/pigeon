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
        expect(JSON.parse(stringifyCanonical(value))).toEqual(value);
      }),
      { numRuns: 200 },
    );
  });
});
