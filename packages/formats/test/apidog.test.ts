/**
 * Apidog environment import (PIGN-048) against sanitized real exports in
 * packages/fixtures/apidog/ (compatibility.md §B.2), plus the detection matrix over every fixture.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  APIDOG_FALLBACK_MESSAGE,
  buildApidogEnvironment,
  detectFormat,
  importApidog,
} from '../src/index';

const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const read = (path: string) => readFileSync(join(fixtures, path));
const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

function detectApidogFixture(name: string) {
  const detected = detectFormat(read(`apidog/${name}`));
  if (detected.kind !== 'apidog') throw new Error(`${name}: ${detected.kind}`);
  return detected;
}

function files(directory: string): string[] {
  return readdirSync(join(fixtures, directory)).flatMap((name) => {
    const path = `${directory}/${name}`;
    if (statSync(join(fixtures, path)).isDirectory()) return files(path);
    return name.endsWith('.json') ? [path] : [];
  });
}

describe('detecting Apidog exports (PIGN-048)', () => {
  it('recognizes both real export shapes', () => {
    expect(detectApidogFixture('environment-export.apidog.json')).toMatchObject({
      variant: 'environments',
    });
    expect(detectApidogFixture('project-export.apidog.json')).toMatchObject({
      variant: 'project',
      version: '1.2.0',
    });
  });

  it('never classifies a Postman fixture as Apidog, nor an Apidog one as Postman', () => {
    const matrix = Object.fromEntries(
      [...files('postman'), ...files('apidog')].map((path) => [
        path,
        detectFormat(read(path)).kind,
      ]),
    );
    for (const [path, kind] of Object.entries(matrix)) {
      if (path.startsWith('apidog/')) expect(kind, path).toBe('apidog');
      else expect(kind, path).not.toBe('apidog');
    }
    expect(matrix['postman/environments/staging.postman_environment.json']).toBe(
      'postman-environment',
    );
    expect(matrix['postman/examples.v2.1.json']).toBe('postman-collection');
  });

  it('shows the fallback message for Apidog-like files it cannot read', () => {
    const rejected = {
      kind: 'rejected',
      format: 'Apidog export',
      message: APIDOG_FALLBACK_MESSAGE,
    };
    expect(detectFormat({ $schema: { app: 'apidog', type: 'project' }, environments: {} })).toEqual(
      rejected,
    );
    expect(detectFormat({ apidogProject: '2.0.0', environments: [{ name: 'x' }] })).toEqual(
      rejected,
    );
    expect(
      detectFormat({ environments: [{ name: 'x', baseUrls: { default: 'http://a' } }] }),
    ).toEqual(rejected);
    // A project export without environments or globals has nothing to import.
    expect(
      detectFormat({
        apidogProject: '1.0.0',
        $schema: { app: 'apidog', version: '1.2.0' },
        environments: [],
        globalVariables: [{ id: '1', variables: [] }],
      }),
    ).toMatchObject({ kind: 'rejected', format: 'Apidog project export (format 1.2.0)' });
    // Unrelated JSON with an `environments` key is not Apidog.
    expect(detectFormat({ environments: ['prod'] })).toMatchObject({ kind: 'unknown' });
  });
});

describe('importing Apidog environments (PIGN-048)', () => {
  it('maps the environment export', () => {
    const imported = importApidog(detectApidogFixture('environment-export.apidog.json'), {
      newId: ids(),
    });
    expect(imported).toMatchSnapshot();
  });

  it('maps the project export the same way and reports what else it holds', () => {
    const project = importApidog(detectApidogFixture('project-export.apidog.json'), {
      newId: ids(),
    });
    const environment = importApidog(detectApidogFixture('environment-export.apidog.json'), {
      newId: ids(),
    });
    expect(project.format).toBe('Apidog project export (format 1.2.0)');
    expect(project.environments.map((e) => e.environment.values)).toEqual(
      environment.environments.map((e) => e.environment.values),
    );
    expect(project.globals).toBeUndefined();
    expect(project.warnings).toEqual([
      'Only environments and global variables are imported from an Apidog project; its APIs are not. Export the APIs from Apidog as OpenAPI or Postman to bring them in.',
    ]);
    expect(project).toMatchSnapshot();
  });

  it('keeps secret-like values off files and every value as a current value', () => {
    const [env] = importApidog(detectApidogFixture('environment-export.apidog.json'), {
      newId: ids(),
    }).environments;
    const values = Object.fromEntries(env!.environment.values.map((v) => [v.key, v]));
    expect(values['apiKey']).toMatchObject({ type: 'secret', value: '' });
    expect(values['webhookSecret']).toMatchObject({ type: 'secret', value: '' });
    expect(values['actorId']).toMatchObject({ type: 'default' });
    expect(env!.currentValues['apiKey']).toBe('example-api-key-1111');
    // Values are taken as they are (Apidog keeps a leading space here).
    expect(values['partnerWalletId']!.value).toBe(' 00000000-0000-4000-8000-000000000002');
    expect(env!.environment.name).toBe('Wallet Local');
    expect(env!.environment.fileKey).toBe('wallet-local');
  });

  it('names base URL variables after the chosen name, services and module names', () => {
    const detected = {
      variant: 'project' as const,
      data: {
        moduleSettings: [{ id: 7, name: 'Billing API' }],
        projectSetting: {
          servers: [
            { id: 'default', moduleId: 1 },
            { id: '7', moduleId: 7 },
          ],
        },
        environments: [
          {
            name: 'Dev',
            baseUrl: '',
            baseUrls: { 1: 'https://main.test', 7: 'https://billing.test', 9: 'https://x.test' },
            variables: [{ name: 'api_billing', initialValue: 'mine', value: 'mine' }],
          },
        ],
      },
    };
    const [env] = importApidog(detected, { newId: ids() }).environments;
    expect(env!.baseUrls.map((b) => [b.key, b.url, b.service])).toEqual([
      ['baseUrl', 'https://main.test', 'main'],
      ['baseUrl_billing_api', 'https://billing.test', 'Billing API'],
      ['baseUrl_9', 'https://x.test', '9'],
    ]);
    const renamed = buildApidogEnvironment(env!.source, 'api');
    expect(renamed.values.map((v) => v.key)).toEqual([
      'api',
      'api_billing_api',
      'api_9',
      'api_billing',
    ]);
    expect(renamed.baseUrls.every((b) => !b.skipped)).toBe(true);
    const clash = buildApidogEnvironment(
      { ...env!.source, baseUrls: [{ suffix: '_billing', url: 'https://b', service: 'Billing' }] },
      'api',
    );
    expect(clash.baseUrls).toEqual([
      {
        suffix: '_billing',
        url: 'https://b',
        service: 'Billing',
        key: 'api_billing',
        skipped: true,
      },
    ]);
    expect(clash.values.map((v) => [v.key, v.value])).toEqual([['api_billing', 'mine']]);
    expect(clash.report.warnings[0]).toBe(
      'The export already has a variable “api_billing”: the base URL https://b is not added under that name.',
    );
  });

  it('lists what it does not import instead of dropping it silently', () => {
    const [env] = importApidog(
      {
        variant: 'environments',
        data: {
          servers: [],
          environments: [
            {
              name: 'Edge',
              type: 'mock',
              baseUrl: 'http://a',
              color: 'red',
              parameters: { header: [{ name: 'X' }], query: [], cookie: [], body: [] },
              websocketBaseUrls: { default: 'ws://a' },
              socketioBaseUrls: {},
              registrationCenters: [{}],
              advancedSettings: { default: { requestProxySetting: { type: 'custom' } } },
              variables: [
                { name: 'local', initialValue: '', value: 'only-here', isSync: false },
                { name: 'changed', initialValue: 'a', value: 'b', isSync: true },
                { name: 'pin', initialValue: '1234', securityType: 'sensitive', extra: 1 },
                { name: '', value: 'x' },
              ],
            },
          ],
        },
      },
      { newId: ids() },
    ).environments;
    expect(env!.environment.values.slice(1)).toEqual([
      { key: 'local', value: '', type: 'default', enabled: true },
      { key: 'changed', value: 'a', type: 'default', enabled: true },
      { key: 'pin', value: '', type: 'secret', enabled: true },
    ]);
    expect(env!.currentValues).toMatchObject({ local: 'only-here', changed: 'b', pin: '1234' });
    expect(env!.report.warnings).toEqual([
      '1 secret value is not written to files: keep it as your current value on this machine.',
      'Apidog security type “sensitive” is not known: those variables are imported as secrets.',
      'local is not synced in Apidog: its value is only offered as your current value.',
      '1 variable has a current value different from the initial value: the initial value goes to files, the current one to “use as my current values”.',
      '1 variable without a name skipped.',
      'Variable fields not imported: extra.',
      'Environment parameters (1 header) are not imported: Pigeon has none per environment; add them to the collection or its requests.',
      'WebSocket and Socket.IO base URLs are not imported (websocketBaseUrls).',
      'Service registration centers are not imported.',
      'Proxy settings are not imported: set a proxy in Settings if you need one.',
      'Environment type “mock” is not known: imported as a normal environment.',
      'Environment fields not imported: color.',
    ]);
  });

  it('imports project global variables', () => {
    const imported = importApidog(
      {
        variant: 'project',
        data: {
          environments: [],
          globalVariables: [
            { id: '1', variables: [{ name: 'tenant', initialValue: 'acme', value: 'acme' }] },
            { id: '2', variables: [{ name: 'authToken', initialValue: 't', value: 't' }] },
          ],
        },
      },
      { newId: ids() },
    );
    expect(imported.environments).toEqual([]);
    expect(imported.globals?.globals.values).toEqual([
      { key: 'tenant', value: 'acme', type: 'default', enabled: true },
      { key: 'authToken', value: '', type: 'secret', enabled: true },
    ]);
    expect(imported.globals?.currentValues).toEqual({ tenant: 'acme', authToken: 't' });
  });
});
