import { describe, expect, it } from 'vitest';

import { exampleJsonSchema } from '../src/index';

const example = (text: string, format: 'json' | 'text' = 'json') => ({
  name: '200 OK',
  response: {
    code: 200,
    status: 'OK',
    headers: [],
    cookies: [],
    body: { kind: 'text' as const, text, format },
  },
});

describe('exampleJsonSchema (PIGN-056)', () => {
  it('applies project and request rules and the request’s additionalFields', () => {
    const result = exampleJsonSchema(
      { comparison: { rules: [{ path: '$.name', optional: true }] } },
      {
        name: 'Get user',
        comparison: {
          rules: [{ path: '$.id', nullable: true }],
          body: { additionalFields: 'fail' },
          extra: {},
        },
      },
      example('{"id":1,"name":"Ada"}'),
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.fileName).toBe('get-user-200-ok.schema.json');
    expect(result.schema).toMatchObject({
      title: 'Get user — 200 OK',
      type: 'object',
      properties: { id: { type: ['null', 'number'] }, name: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    });
    expect(result.text.endsWith('}\n')).toBe(true);
  });

  it('has no schema for bodies that are not JSON', () => {
    expect(exampleJsonSchema({}, { name: 'R' }, example('hello', 'text'))).toEqual({
      ok: false,
      message: 'Only JSON bodies have a schema.',
    });
    expect(exampleJsonSchema({}, { name: 'R' }, example('{oops'))).toMatchObject({ ok: false });
  });
});
