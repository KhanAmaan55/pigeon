import { describe, expect, it } from 'vitest';

import { indexJson, lineOf } from '../src/features/compare/json-lines';

describe('indexJson', () => {
  it('maps concrete and schema paths to the lines where they start', () => {
    const index = indexJson(
      '{"id":1,"tags":["a","b"],"items":[{"x":{"y":2}},{"x":{}}],"a.b":null}',
    );
    expect(index.lines).toEqual([
      '{',
      '  "id": 1,',
      '  "tags": [',
      '    "a",',
      '    "b"',
      '  ],',
      '  "items": [',
      '    {',
      '      "x": {',
      '        "y": 2',
      '      }',
      '    },',
      '    {',
      '      "x": {}',
      '    }',
      '  ],',
      '  "a.b": null',
      '}',
    ]);
    expect(index.concrete.get('$')).toBe(0);
    expect(index.concrete.get('$.tags[1]')).toBe(4);
    expect(index.concrete.get('$.items[1].x')).toBe(13);
    expect(index.schema.get('$.items[*].x.y')).toBe(9);
    expect(index.concrete.get('$["a.b"]')).toBe(16);
    expect(lineOf(index, '$.items[5].x', '$.items[*].x')).toBe(8);
    expect(lineOf(index, '$.items[*]')).toBe(7);
    expect(lineOf(index, '$.missing')).toBeUndefined();
  });

  it('leaves non-JSON text as lines', () => {
    expect(indexJson('<h1>x</h1>').lines).toEqual(['<h1>x</h1>']);
  });
});
