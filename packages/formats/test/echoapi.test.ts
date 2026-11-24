/**
 * Echo API environment import (PIGN-049) against a real Echo API project export in
 * packages/fixtures/echoapi/ (compatibility.md §B.3), plus detection against every fixture.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildImportedEnvironment,
  detectFormat,
  ECHOAPI_FALLBACK_MESSAGE,
  importEchoApi,
} from '../src/index';

const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const read = (path: string) => readFileSync(join(fixtures, path));
const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

function files(directory: string): string[] {
  return readdirSync(join(fixtures, directory)).flatMap((name) => {
    const path = `${directory}/${name}`;
    if (statSync(join(fixtures, path)).isDirectory()) return files(path);
    return name.endsWith('.json') ? [path] : [];
  });
}

function sample() {
  const detected = detectFormat(read('echoapi/airport-gap.echoapi.json'));
  if (detected.kind !== 'echoapi') throw new Error(detected.kind);
  return detected.data;
}

describe('detecting Echo API exports (PIGN-049)', () => {
  it('recognizes the project export, and no other fixture as Echo API', () => {
    const matrix = Object.fromEntries(
      [...files('postman'), ...files('apidog'), ...files('echoapi')].map((path) => [
        path,
        detectFormat(read(path)).kind,
      ]),
    );
    for (const [path, kind] of Object.entries(matrix)) {
      if (path.startsWith('echoapi/')) expect(kind, path).toBe('echoapi');
      else expect(kind, path).not.toBe('echoapi');
    }
  });

  it('shows the fallback message for Echo API-like files it cannot read', () => {
    const rejected = {
      kind: 'rejected',
      format: 'Echo API export',
      message: ECHOAPI_FALLBACK_MESSAGE,
    };
    expect(detectFormat({ project_id: '1', apis: [], global: {} })).toEqual(rejected);
    expect(detectFormat({ global: { envs: [{ name: 'x' }], global_vars: {} } })).toEqual(rejected);
    expect(
      detectFormat({
        project_id: '1',
        apis: [],
        global: {
          envs: [{ env_id: '1', server_list: [{ uri: '' }], env_var_list: {} }],
          global_vars: {},
        },
      }),
    ).toMatchObject({ kind: 'rejected', format: 'Echo API project export' });
  });
});

describe('importing Echo API environments (PIGN-049)', () => {
  it('maps the Airport Gap project export', () => {
    const imported = importEchoApi(sample(), { newId: ids() });
    expect(imported).toMatchSnapshot();
    expect(imported.format).toBe('Echo API project export');
    expect(imported.environments.map((e) => e.environment.name)).toEqual([
      'Mock Environment',
      'Airport Gap - Environment',
    ]);
    expect(imported.warnings).toEqual([
      '“Default Environment” has no variables or base URL: not imported.',
      'Only environments and global variables are imported from an Echo API project; its APIs (2) are not. Export the project from Echo API in Postman format to bring the APIs in.',
    ]);
    const [mock, airport] = imported.environments;
    expect(mock!.environment.values).toEqual([
      {
        key: 'baseUrl',
        value: 'https://mock.echoapi.com/mock/373ff439780004',
        type: 'default',
        enabled: true,
        description: 'Base URL from Echo API',
      },
    ]);
    const values = Object.fromEntries(airport!.environment.values.map((v) => [v.key, v]));
    expect(Object.keys(values)).toEqual([
      'account_password',
      'airport_id',
      'favorite_note',
      'from_airport',
      'page',
      'account_email',
      'api_token',
      'base_url',
      'favorite_id',
      'to_airport',
    ]);
    expect(values['base_url']).toEqual({
      key: 'base_url',
      value: 'https://airportgap.com/api',
      type: 'default',
      enabled: true,
    });
    expect(values['api_token']).toMatchObject({ type: 'secret', value: '' });
    expect(values['account_password']).toMatchObject({ type: 'secret', value: '' });
    expect(airport!.baseUrls).toEqual([]);
    expect(airport!.currentValues).toMatchObject({ airport_id: 'KIX', page: '1' });
  });

  it('keeps private environments and differing current values off files; reports the rest', () => {
    const imported = importEchoApi(
      {
        project_id: 'p',
        apis: [],
        global: {
          envs: [
            {
              env_id: '9',
              name: 'Staging',
              is_private: 1,
              sort: 0,
              colour: 'red',
              server_list: [
                { server_id: '1', name: 'Default Services', sort: 0, uri: 'https://api.test' },
                { server_id: '2', name: '', sort: 1, uri: 'https://auth.test' },
              ],
              env_var_list: {
                user: { value: 'me', current_value: 'me', description: 'Login', flag: 1 },
              },
            },
            {
              env_id: '10',
              name: 'Shared',
              is_private: -1,
              server_list: [],
              env_var_list: { tenant: { value: 'a', current_value: 'b', description: '' } },
            },
          ],
          servers: [
            { server_id: '1', name: 'Default Services', sort: 0 },
            { server_id: '2', name: 'Auth Service', sort: 1 },
          ],
          global_vars: { region: { value: 'eu', current_value: 'eu', description: '' } },
          global_param: {
            header: { parameter: [{ key: 'X-App' }] },
            query: { parameter: [] },
            auth: { type: 'bearer' },
            pre_tasks: [{ type: 'customScript' }],
            post_tasks: [],
          },
        },
      },
      { newId: ids() },
    );
    const [staging, shared] = imported.environments;
    expect(staging!.environment.values).toEqual([
      {
        key: 'baseUrl',
        value: 'https://api.test',
        type: 'default',
        enabled: true,
        description: 'Base URL from Echo API',
      },
      {
        key: 'baseUrl_auth_service',
        value: 'https://auth.test',
        type: 'default',
        enabled: true,
        description: 'Base URL of the Echo API service “Auth Service”',
      },
      { key: 'user', value: '', type: 'default', enabled: true, description: 'Login' },
    ]);
    expect(staging!.currentValues).toMatchObject({ user: 'me' });
    expect(staging!.report.warnings).toEqual([
      'Variable fields not imported: flag.',
      'This environment is private in Echo API: its values are only offered as your current values, not written to files.',
      'Environment fields not imported: colour.',
    ]);
    expect(shared!.environment.values).toEqual([
      { key: 'tenant', value: 'a', type: 'default', enabled: true },
    ]);
    expect(shared!.currentValues).toEqual({ tenant: 'b' });
    expect(imported.globals?.globals.values).toEqual([
      { key: 'region', value: 'eu', type: 'default', enabled: true },
    ]);
    expect(imported.warnings).toEqual([
      'Project parameters (1 header) are not imported: add them to the collection or its requests.',
      'Project auth (bearer) is not imported: set it on the collection.',
      '1 project pre/post task (scripts) not imported.',
    ]);
    expect(buildImportedEnvironment(staging!.source, 'host').values.map((v) => v.key)).toEqual([
      'host',
      'host_auth_service',
      'user',
    ]);
  });
});
