import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  detectFormat,
  encodeFile,
  environmentToPostman,
  exportEnvironment,
  exportGlobals,
  importPostmanEnvironment,
  importPostmanGlobals,
} from '../src/index';

const directory = fileURLToPath(new URL('../../fixtures/postman/environments/', import.meta.url));
const load = (name: string) => {
  const detected = detectFormat(readFileSync(join(directory, name)));
  if (detected.kind !== 'postman-environment' && detected.kind !== 'postman-globals')
    throw new Error(name);
  return detected;
};

describe('Postman environments and globals (PIGN-030)', () => {
  it('detects environments and globals structurally', () => {
    expect(load('staging.postman_environment.json').kind).toBe('postman-environment');
    expect(load('local.postman_environment.json').kind).toBe('postman-environment');
    expect(load('workspace.postman_globals.json').kind).toBe('postman-globals');
    expect(detectFormat({ values: [], _postman_variable_scope: 'environment' }).kind).toBe(
      'postman-environment',
    );
  });

  it('imports shared values, keeps types, flags and unknown keys, and never shares secrets', () => {
    const { environment, currentValues, report } = importPostmanEnvironment(
      load('staging.postman_environment.json').data,
    );
    expect(environment).toMatchObject({
      id: '5c1a6f3e-staging',
      name: 'Staging',
      fileKey: 'staging',
      extra: { color: '#ff0000' },
    });
    expect(environment.values).toEqual([
      { key: 'baseUrl', value: 'https://staging.example.test', type: 'default', enabled: true },
      { key: 'token', value: '', type: 'secret', enabled: true },
      { key: 'emptySecret', value: '', type: 'secret', enabled: true },
      { key: 'debug', value: 'true', type: 'default', enabled: false },
      { key: 'timeout', value: '30', type: 'text', enabled: true, description: 'seconds' },
      { key: 'x', value: '1', type: 'default', enabled: true, extra: { 'x-var': 'kept' } },
    ]);
    expect(currentValues).toMatchObject({
      token: 'staging-secret-token',
      baseUrl: 'https://staging.example.test',
    });
    expect(report).toEqual({
      variables: 6,
      secrets: 2,
      warnings: [
        '1 secret value is not written to files: keep it as your current value on this machine.',
      ],
    });
    // The project file (file-format §2.5) has no volatile keys and no secret value.
    const file = new TextDecoder().decode(
      encodeFile('environment', environmentToPostman(environment)),
    );
    expect(file).not.toContain('staging-secret-token');
    expect(file).not.toContain('_postman_exported');
    expect(file).toContain('"_postman_variable_scope": "environment"');
  });

  it('gives environments without an id (or a taken one) a fresh id', () => {
    const local = importPostmanEnvironment(load('local.postman_environment.json').data, {
      newId: () => 'fresh',
    });
    expect(local.environment).toMatchObject({ id: 'fresh', name: 'Local', fileKey: 'local' });
    const taken = importPostmanEnvironment(load('staging.postman_environment.json').data, {
      existingIds: new Set(['5c1a6f3e-staging']),
      newId: () => 'fresh',
    });
    expect(taken).toMatchObject({
      environment: { id: 'fresh' },
      regeneratedId: '5c1a6f3e-staging',
    });
  });

  it('imports globals with secrets split the same way', () => {
    const { globals, currentValues, report } = importPostmanGlobals(
      load('workspace.postman_globals.json').data,
    );
    expect(globals.values.map((v) => [v.key, v.value])).toEqual([
      ['userAgent', 'pigeon-tests'],
      ['globalSecret', ''],
    ]);
    expect(globals.extra).toEqual({ name: 'My Workspace Globals' });
    expect(currentValues['globalSecret']).toBe('g-secret');
    expect(report.secrets).toBe(1);
  });

  it('exports shared values with Postman export keys, and re-imports to the same thing', () => {
    const { environment } = importPostmanEnvironment(load('staging.postman_environment.json').data);
    const exported = exportEnvironment(environment, {
      version: '0.1.0',
      exportedAt: new Date('2026-11-20T10:00:00.000Z'),
    });
    expect(exported.fileName).toBe('Staging.postman_environment.json');
    expect(exported.data).toMatchObject({
      id: '5c1a6f3e-staging',
      name: 'Staging',
      color: '#ff0000',
      _postman_variable_scope: 'environment',
      _postman_exported_at: '2026-11-20T10:00:00.000Z',
      _postman_exported_using: 'Pigeon/0.1.0',
    });
    expect(JSON.stringify(exported.data)).not.toContain('staging-secret-token');
    const again = importPostmanEnvironment(exported.data);
    expect(again.environment).toEqual(environment);

    const { globals } = importPostmanGlobals(load('workspace.postman_globals.json').data);
    const exportedGlobals = exportGlobals(globals, { version: '0.1.0' });
    expect(exportedGlobals.data).toMatchObject({ _postman_variable_scope: 'globals' });
    expect(importPostmanGlobals(exportedGlobals.data).globals).toEqual(globals);
  });
});
