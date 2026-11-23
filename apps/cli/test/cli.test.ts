/**
 * `pigeon run` / `pigeon validate` end to end (PIGN-054): a project written to a temporary
 * folder with core, the test server, and the built CLI (`dist/cli.js`) spawned as CI would.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunReport } from '@pigeon/core';
import {
  compareProjectResult,
  createQuickJsRunner,
  executeProjectRequest,
  initializeProject,
  ProjectSession,
  RequestExecutor,
  runRegression,
  runTargets,
} from '@pigeon/core';
import { MemoryAppState, MemorySecretStore } from '@pigeon/platform';
import { NODE_CAPABILITIES, NodeFs, NodeTransport } from '@pigeon/platform-node';
import type { TestServer } from '@pigeon/test-server';
import { startTestServer } from '@pigeon/test-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, '../dist/cli.js');
const TOKEN = 'ci-secret-token-1234';

let server: TestServer;
let dir: string;
let files: Map<string, string>;

const url = (raw: string) => ({ raw, query: [], pathVariables: [], extra: {} });
const jsonExample = (id: string, code: number, body: unknown) => ({
  id,
  name: `${code}`,
  response: {
    code,
    status: code === 200 ? 'OK' : '',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    cookies: [],
    body: { kind: 'text' as const, text: JSON.stringify(body), format: 'json' as const },
  },
  extra: {},
});

/** Every file of the project, to prove a run never changes any. */
async function snapshot(root: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) for (const [k, v] of await snapshot(root, path)) out.set(k, v);
    else out.set(path, await readFile(join(root, path), 'utf8'));
  }
  return out;
}

beforeAll(async () => {
  await stat(CLI).catch(() => {
    throw new Error('Build the CLI first: pnpm --filter @pigeon/cli build');
  });
  server = await startTestServer({ port: 0 });
  dir = await mkdtemp(join(tmpdir(), 'pigeon-cli-'));
  const fs = new NodeFs(dir);
  await initializeProject(fs, 'CLI project');
  const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
  session.apply({ type: 'createCollection', id: 'api', name: 'API' });
  session.apply({
    type: 'setContainerVariables',
    id: 'api',
    values: [{ key: 'baseUrl', value: 'http://127.0.0.1:1', type: 'default', enabled: true }],
  });
  session.apply({
    type: 'createRequest',
    id: 'same',
    parentId: 'api',
    name: 'Same',
    request: { url: url('{{baseUrl}}/status/200') },
  });
  session.apply({
    type: 'createExample',
    requestId: 'same',
    example: jsonExample('e1', 200, { status: 200 }),
  });
  session.apply({
    type: 'createRequest',
    id: 'changed',
    parentId: 'api',
    name: 'Changed',
    request: { url: url('{{baseUrl}}/status/200') },
  });
  session.apply({
    type: 'createExample',
    requestId: 'changed',
    example: jsonExample('e2', 200, { status: 200, name: 'gone' }),
  });
  session.apply({ type: 'createFolder', id: 'admin', parentId: 'api', name: 'Admin' });
  session.apply({
    type: 'createRequest',
    id: 'echo',
    parentId: 'admin',
    name: 'Echo token',
    request: { url: url('{{baseUrl}}/echo?key={{token}}') },
  });
  session.apply({
    type: 'updateRequest',
    id: 'echo',
    patch: {
      events: [
        {
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: [
              "pm.test('token sent', () => pm.expect(pm.response.json().query.key.length).to.be.above(0));",
            ],
          },
        },
      ],
    },
  });
  session.apply({
    type: 'createRequest',
    id: 'down',
    parentId: 'api',
    name: 'Unreachable',
    request: { url: url('http://127.0.0.1:1/nothing') },
  });
  session.apply({
    type: 'createEnvironment',
    id: 'local',
    name: 'Local',
    values: [
      { key: 'baseUrl', value: server.url, type: 'default', enabled: true },
      { key: 'token', value: '', type: 'secret', enabled: true },
    ],
  });
  await session.saveForCommit();
  files = await snapshot(dir);
});

afterAll(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

function cli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: dir, env: { ...process.env, NO_COLOR: '1', ...env } },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

describe('pigeon run (PIGN-054)', () => {
  it('runs a collection with an environment and secrets from PIGEON_VAR_*, exit 1 on failures', async () => {
    const { code, stdout, stderr } = await cli(
      ['run', '.', '--env', 'Local', '--reporter', 'json'],
      {
        PIGEON_VAR_token: TOKEN,
      },
    );
    expect(stderr).toBe('');
    expect(code).toBe(1);
    const json = JSON.parse(stdout) as {
      pigeonCliReport: 1;
      exitCode: number;
      reports: RunReport[];
    };
    expect(json.exitCode).toBe(1);
    const [report] = json.reports;
    expect(report!.environment).toEqual({ id: 'local', name: 'Local' });
    expect(report!.transport).toBe('node');
    // Explorer order: the Admin folder was created before "Unreachable".
    expect(report!.entries.map((e) => [e.name, e.outcome])).toEqual([
      ['Same', 'pass'],
      ['Changed', 'fail'],
      ['Echo token', 'pass'],
      ['Unreachable', 'error'],
    ]);
    expect(report!.entries[2]!.tests).toMatchObject({ pass: 1, fail: 0, error: 0 });
    // The secret never appears; its place in the URL is masked.
    expect(stdout).not.toContain(TOKEN);
    expect(report!.entries[2]!.url).toContain('key=••••••');
  });

  it('gives the same outcomes as the app runner (same core path)', async () => {
    const session = await ProjectSession.fromFs(new NodeFs(dir), {
      appState: new MemoryAppState(),
      secrets: new MemorySecretStore(),
    });
    session.setCurrentValue('env:local', 'token', TOKEN);
    const executor = new RequestExecutor(new NodeTransport());
    const runner = createQuickJsRunner();
    const generator = runRegression(
      runTargets(session.getWorkingModel(), 'api'),
      {
        execute: (target, signal) =>
          executeProjectRequest(session, target.requestId, {
            executor,
            capabilities: NODE_CAPABILITIES,
            environmentId: 'local',
            scripts: { runner, enabled: true },
            signal,
          }),
        compare: (target, result) => compareProjectResult(session, target.requestId, result),
      },
      {
        scope: { kind: 'collection', id: 'api', name: 'API' },
        environment: null,
        transport: 'node',
      },
    );
    let step = await generator.next();
    while (!step.done) step = await generator.next();
    const app = step.value.entries.map((e) => [e.name, e.outcome, e.counts]);

    const { stdout } = await cli([
      'run',
      '.',
      '-e',
      'local',
      '-r',
      'json',
      '--var',
      `token=${TOKEN}`,
    ]);
    const cliEntries = (JSON.parse(stdout) as { reports: RunReport[] }).reports[0]!.entries;
    expect(cliEntries.map((e) => [e.name, e.outcome, e.counts])).toEqual(app);
  });

  it('pretty output lists each request with its findings; --bail stops after the first failure', async () => {
    const { code, stdout } = await cli(['run', '.', '--env', 'Local', '--bail'], {
      PIGEON_VAR_token: TOKEN,
    });
    expect(code).toBe(1);
    expect(stdout).toContain('API (collection · environment Local) · 4 requests');
    expect(stdout).toMatch(/✓ GET +Same 200/);
    expect(stdout).toMatch(/✗ GET +Changed 200/);
    expect(stdout).toContain('$.name');
    expect(stdout).toMatch(/· GET +Admin \/ Echo token +skipped/);
    expect(stdout).toMatch(/· GET +Unreachable +skipped/);
    expect(stdout).toContain('stopped after the first failure');
    expect(stdout).not.toContain(TOKEN);
  });

  it('selects a folder; without the secret the test fails; --out writes JUnit', async () => {
    const { code, stdout } = await cli([
      'run',
      '.',
      '--collection',
      'API',
      '--folder',
      'Admin',
      '--env',
      'Local',
      '--reporter',
      'junit',
      '--out',
      'results.xml',
    ]);
    expect(code).toBe(1);
    expect(stdout).toContain('Admin (folder · environment Local) · 1 request');
    const xml = await readFile(join(dir, 'results.xml'), 'utf8').finally(() =>
      rm(join(dir, 'results.xml'), { force: true }),
    );
    expect(xml).toMatch(
      /^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuites name="pigeon" tests="1" failures="1" errors="0" skipped="0"/,
    );
    expect(xml).toContain('<testcase classname="API/Admin" name="GET Echo token"');
    expect(xml).toContain('<failure message="1/1 tests failed" type="fail">');
    expect(xml).toContain('TEST token sent: expected');
  });

  it('JUnit marks errors, skips and failures per request', async () => {
    const { code, stdout } = await cli(['run', '.', '-e', 'Local', '-r', 'junit', '--no-scripts']);
    expect(code).toBe(1);
    expect(stdout).toContain('tests="4" failures="1" errors="1" skipped="1"');
    expect(stdout).toContain('<failure message="1 difference, vs “200”" type="fail">GET http://');
    expect(stdout).toContain('FAIL $.name:');
    expect(stdout).toMatch(/<error message="[^"]+" type="error">/);
    expect(stdout).toContain('<skipped message="No baseline example"/>');
  });

  it('exit code 2 for usage and configuration errors', async () => {
    expect((await cli(['run'])).code).toBe(2);
    expect((await cli(['run', '.', '--reporter', 'tap'])).code).toBe(2);
    const env = await cli(['run', '.', '--env', 'Prod']);
    expect(env.code).toBe(2);
    expect(env.stderr).toContain('No environment "Prod"');
    expect(env.stderr).toContain('"Local"');
    expect((await cli(['run', '.', '--collection', 'Nope'])).code).toBe(2);
    expect((await cli(['run', '.', '--folder', 'Missing'])).code).toBe(2);
    expect((await cli(['frobnicate'])).code).toBe(2);
    expect((await cli(['run', join(dir, 'collections')])).stderr).toContain('not a Pigeon project');
  });

  it('loads an environment file and --var values; passing runs exit 0', async () => {
    const envFile = join(dir, '..', `pigeon-cli-env-${process.pid}.json`);
    await writeFile(
      envFile,
      JSON.stringify({
        name: 'CI',
        values: [{ key: 'baseUrl', value: server.url, enabled: true }],
      }),
    );
    try {
      const { code, stdout } = await cli([
        'run',
        '.',
        '--folder',
        'Admin',
        '--env',
        envFile,
        '--var',
        `token=${TOKEN}`,
        '-r',
        'json',
      ]);
      expect(code).toBe(0);
      const [report] = (JSON.parse(stdout) as { reports: RunReport[] }).reports;
      expect(report!.environment?.name).toBe('CI');
      expect(report!.totals.pass).toBe(1);
    } finally {
      await rm(envFile, { force: true });
    }
  });

  it('a passing run exits 0 and the project folder is never written', async () => {
    const pass = await cli(['run', '.', '--folder', 'Admin', '-e', 'Local'], {
      PIGEON_VAR_token: TOKEN,
    });
    expect(pass.code).toBe(0);
    expect(await snapshot(dir)).toEqual(files);
  });
});

describe('pigeon validate (PIGN-054)', () => {
  it('passes a valid project and fails one with an unreadable file', async () => {
    const ok = await cli(['validate', '.']);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('every file is valid');

    const broken = await mkdtemp(join(tmpdir(), 'pigeon-cli-broken-'));
    try {
      const fs = new NodeFs(broken);
      await initializeProject(fs, 'Broken');
      const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
      session.apply({ type: 'createCollection', id: 'c', name: 'C' });
      await session.saveForCommit();
      await writeFile(join(broken, 'collections', 'c', 'bad.request.json'), '{ not json');
      const result = await cli(['validate', broken, '--reporter', 'json']);
      expect(result.code).toBe(1);
      const json = JSON.parse(result.stdout) as {
        ok: boolean;
        problems: Array<{ path: string; severity: string }>;
      };
      expect(json.ok).toBe(false);
      expect(json.problems).toContainEqual(
        expect.objectContaining({ path: 'collections/c/bad.request.json', severity: 'error' }),
      );
      const run = await cli(['run', broken]);
      expect(run.stderr).toContain('could not be read');
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });

  it('prints help and the version', async () => {
    expect((await cli(['--help'])).stdout).toContain('run <projectDir>');
    expect((await cli(['help', 'run'])).stdout).toContain('PIGEON_VAR_');
    expect((await cli(['--version'])).stdout).toMatch(/^pigeon \d+\.\d+\.\d+/);
  });
});
