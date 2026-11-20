import { MEMORY_CAPABILITIES } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { ProjectEnvVariable, ProjectModel } from '../src/index';
import {
  buildScopes,
  createExecutionContext,
  createRequest,
  describeVariable,
  findVariables,
  isSingleVariable,
  prepareRequest,
  resolveString,
  scopeLayer,
  visibleVariables,
} from '../src/index';

const v = (
  key: string,
  value: string,
  extra: Partial<ProjectEnvVariable> = {},
): ProjectEnvVariable => ({
  key,
  value,
  type: 'default',
  enabled: true,
  ...extra,
});

function model(values: ProjectEnvVariable[], id = 'local'): ProjectModel {
  return {
    id: 'p',
    name: 'P',
    formatVersion: 1,
    collections: [],
    orphanExamples: [],
    environments: [
      { id, fileKey: id, name: 'Local', values, extra: {} },
      {
        id: 'other',
        fileKey: 'other',
        name: 'Other',
        values: [v('baseUrl', 'https://other.test')],
        extra: {},
      },
    ],
    extra: {},
  };
}

const fixed = {
  uuid: () => 'uuid-1',
  now: () => Date.UTC(2026, 0, 2, 3, 4, 5),
  randomInt: () => 7,
};

describe('parse', () => {
  it('finds trimmed references and single-variable values', () => {
    expect(findVariables('{{ a }}/{{b}}/{{}}/{x}')).toEqual([
      { start: 0, end: 7, name: 'a' },
      { start: 8, end: 13, name: 'b' },
    ]);
    expect(isSingleVariable('{{file}}')).toBe(true);
    expect(isSingleVariable('dir/{{file}}')).toBe(false);
  });
});

describe('resolveString', () => {
  const scopes = buildScopes(
    model([
      v('baseUrl', 'http://localhost:3000'),
      v('a', '{{b}}'),
      v('b', 'x'),
      v('c1', '{{c2}}'),
      v('c2', '{{c1}}'),
      v('off', 'nope', { enabled: false }),
      v('token', 's3cret', { type: 'secret' }),
      v('dup', 'first'),
      v('dup', 'second'),
    ]),
    {
      environmentId: 'local',
      currentValues: (key): Record<string, string> =>
        key === 'env:local' ? { baseUrl: 'http://127.0.0.1:4010' } : {},
    },
  );

  it.each([
    ['{{baseUrl}}/users', 'http://127.0.0.1:4010/users', [], []],
    ['{{a}}', 'x', [], []],
    ['{{c1}}', '{{c1}}', [], ['c1', 'c2']],
    ['{{off}}', '{{off}}', ['off'], []],
    ['{{missing}} and {{$nope}}', '{{missing}} and {{$nope}}', ['missing', '$nope'], []],
    ['{{dup}}', 'first', [], []],
    ['{{ baseUrl }}', 'http://127.0.0.1:4010', [], []],
  ])('%s → %s', (text, value, unresolved, cycles) => {
    const result = resolveString(text, scopes, fixed);
    expect(result.value).toBe(value);
    expect(result.unresolved).toEqual(unresolved);
    expect(result.cycles.sort()).toEqual(cycles);
  });

  it('resolves dynamic variables from injectable generators', () => {
    expect(
      resolveString(
        '{{$guid}} {{$randomUUID}} {{$timestamp}} {{$isoTimestamp}} {{$randomInt}}',
        scopes,
        fixed,
      ).value,
    ).toBe('uuid-1 uuid-1 1767323045 2026-01-02T03:04:05.000Z 7');
    const a = resolveString('{{$guid}}', scopes).value;
    const b = resolveString('{{$guid}}', scopes).value;
    expect(a).not.toBe(b);
  });

  it('collects resolved secret values and stops at depth 10', () => {
    expect(resolveString('Bearer {{token}}', scopes).secretValues).toEqual(['s3cret']);
    const chain = Array.from({ length: 12 }, (_, i) => v(`n${i}`, `{{n${i + 1}}}`));
    const deep = buildScopes(model([...chain, v('n12', 'end')]), { environmentId: 'local' });
    expect(resolveString('{{n0}}', deep).unresolved).toEqual(['n10']);
    expect(resolveString('{{n5}}', deep).value).toBe('end');
  });

  it('uses only the selected environment', () => {
    const other = buildScopes(model([v('baseUrl', 'http://local')]), { environmentId: 'other' });
    expect(resolveString('{{baseUrl}}', other).value).toBe('https://other.test');
    expect(
      resolveString('{{baseUrl}}', buildScopes(model([]), { environmentId: null })).unresolved,
    ).toEqual(['baseUrl']);
  });

  it('describes variables for tooltips and lists them for autocomplete', () => {
    expect(describeVariable('baseUrl', scopes)).toMatchObject({
      state: 'resolved',
      value: 'http://127.0.0.1:4010',
      scopeName: 'Local',
      scopeKey: 'env:local',
    });
    expect(describeVariable('token', scopes)).toMatchObject({ state: 'resolved', secret: true });
    expect(describeVariable('c1', scopes).state).toBe('unresolved');
    expect(describeVariable('$guid', scopes).state).toBe('dynamic');
    expect(describeVariable('$bogus', scopes).state).toBe('unresolved');
    expect(describeVariable('nope', scopes).state).toBe('unresolved');
    expect(visibleVariables(scopes).map((x) => x.name)).toEqual([
      'a',
      'b',
      'baseUrl',
      'c1',
      'c2',
      'dup',
      'token',
    ]);
    expect(scopeLayer('globals', 'Globals', 'globals', [v('x', '1')]).values.get('x')?.scope).toBe(
      'globals',
    );
  });
});

describe('prepareRequest with variables', () => {
  const scopes = buildScopes(
    model([
      v('baseUrl', 'http://localhost:3000'),
      v('id', '42'),
      v('token', 'abc', { type: 'secret' }),
      v('file', 'fixtures/a.png'),
      v('h', 'X-Trace'),
    ]),
    { environmentId: 'local' },
  );
  const ctx = createExecutionContext({
    capabilities: MEMORY_CAPABILITIES,
    scopes,
    generators: fixed,
  });

  it('resolves URL, path variables, headers and bodies, and reports what stayed unresolved', async () => {
    const prepared = await prepareRequest(
      createRequest({
        method: 'POST',
        url: {
          raw: '{{baseUrl}}/users/:id?q={{missing}}&t={{$timestamp}}',
          query: [],
          pathVariables: [{ key: 'id', value: '{{id}}' }],
          extra: {},
        },
        headers: [
          { key: 'Authorization', value: 'Bearer {{token}}' },
          { key: '{{h}}', value: '1' },
          { key: 'X-Off', value: '{{ignored}}', disabled: true },
        ],
        body: {
          mode: 'formdata',
          params: [
            { key: 'name', value: '{{id}}', kind: 'text' },
            { key: 'avatar', value: '', kind: 'file', src: '{{file}}' },
            { key: 'other', value: '', kind: 'file', src: 'dir/{{file}}' },
          ],
        },
      }),
      ctx,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const req = prepared.value;
    expect(req.url).toBe('http://localhost:3000/users/42?q=%7B%7Bmissing%7D%7D&t=1767323045');
    expect(req.headers.slice(0, 2)).toEqual([
      ['Authorization', 'Bearer abc'],
      ['X-Trace', '1'],
    ]);
    expect(req.meta.unresolved).toEqual(['missing']);
    expect(req.meta.secretValues).toEqual(['abc']);
    expect(req.meta.warnings?.[0]).toBe('Unresolved variables: missing');
    const parts = req.body?.kind === 'multipart' ? req.body.parts : [];
    expect(parts.map((p) => (p.kind === 'text' ? p.value : p.file))).toEqual([
      '42',
      { kind: 'project', path: 'fixtures/a.png' },
      { kind: 'project', path: 'dir/{{file}}' },
    ]);
  });

  it('resolves raw and urlencoded bodies and warns about cycles', async () => {
    const cyclic = buildScopes(model([v('a', '{{b}}'), v('b', '{{a}}')]), {
      environmentId: 'local',
    });
    const raw = await prepareRequest(
      createRequest({
        method: 'POST',
        url: 'http://x.test',
        body: { mode: 'raw', raw: '{"a":"{{a}}"}', language: 'json' },
      }),
      createExecutionContext({ capabilities: MEMORY_CAPABILITIES, scopes: cyclic }),
    );
    expect(raw.ok && raw.value.meta.warnings?.[0]).toMatch(/^Variable cycle/);
    const form = await prepareRequest(
      createRequest({
        method: 'POST',
        url: 'http://x.test',
        body: { mode: 'urlencoded', params: [{ key: 'k', value: '{{id}}' }] },
      }),
      ctx,
    );
    expect(
      form.ok && new TextDecoder().decode((form.value.body as { bytes: Uint8Array }).bytes),
    ).toBe('k=42');
  });
});
