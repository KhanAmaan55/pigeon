import { MEMORY_CAPABILITIES, MockTransport } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { ScriptState } from '../src/index';
import {
  createExecutionContext,
  createQuickJsRunner,
  createRequest,
  RequestExecutor,
  runPreRequestScripts,
  scopeLayer,
} from '../src/index';

const runner = createQuickJsRunner();

const state = (): ScriptState => ({
  request: { method: 'GET', url: 'https://api.test/x', headers: [], body: { mode: 'none' } },
  variables: {
    environment: { a: 'env' },
    collection: { a: 'col', b: 'col' },
    folders: {},
    globals: { c: 'glob' },
    local: {},
  },
  info: { requestName: 'X', requestId: 'x', eventName: 'prerequest' },
  writes: [],
});

async function evaluate(code: string, timeoutMs?: number) {
  return runner.run({ code, state: state(), ...(timeoutMs ? { timeoutMs } : {}) });
}

function scopes() {
  return {
    layers: [
      scopeLayer('environment', 'Dev', 'env:dev', [
        { key: 'ts', value: '0', type: 'default', enabled: true },
        { key: 'token', value: 'top-secret-token', type: 'secret', enabled: true },
      ]),
      scopeLayer('collection', 'API', 'collection:c', [
        { key: 'base', value: 'https://api.test', type: 'default', enabled: true },
      ]),
    ],
  };
}

describe('script sandbox (PIGN-043)', () => {
  it('reads variables with Postman precedence and records writes', async () => {
    const result = await evaluate(`
      console.log(pm.variables.get('a'), pm.variables.get('b'), pm.variables.get('c'));
      pm.variables.set('a', 'local');
      pm.environment.set('n', 42);
      pm.collectionVariables.unset('b');
      console.info(pm.variables.get('a'), pm.environment.get('n'), pm.collectionVariables.has('b'));
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.logs.map((l) => [l.level, l.message])).toEqual([
      ['log', 'env col glob'],
      ['info', 'local 42 false'],
    ]);
    expect(result.state.writes).toEqual([
      { scope: 'environment', key: 'n', value: '42' },
      { scope: 'collection', key: 'b', value: null },
    ]);
    expect(result.state.variables.local).toEqual({ a: 'local' });
  });

  it('changes the request: method, url, headers, raw body', async () => {
    const result = await runner.run({
      code: `
        pm.request.method = 'post';
        pm.request.url = pm.request.url.toString() + '?x=1';
        pm.request.headers.add({ key: 'X-Sig', value: 'abc' });
        pm.request.headers.upsert({ key: 'x-sig', value: 'def' });
        pm.request.headers.add('X-Two: 2');
        pm.request.headers.remove('X-Two');
        pm.request.body.raw = JSON.stringify({ ok: true });
      `,
      state: { ...state(), request: { ...state().request, body: { mode: 'raw', raw: '' } } },
    });
    expect(result.ok && result.state.request).toEqual({
      method: 'POST',
      url: 'https://api.test/x?x=1',
      headers: [{ key: 'x-sig', value: 'def', disabled: false }],
      body: { mode: 'raw', raw: '{"ok":true}' },
    });
  });

  it('stops an infinite loop at the deadline', async () => {
    const started = Date.now();
    const result = await evaluate('console.log("before"); while (true) {}', 300);
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.logs.map((l) => l.message)).toEqual(['before']);
  });

  it('runs out of memory instead of taking the process down', async () => {
    const result = await evaluate('var a = []; while (true) a.push(new Array(100000).fill(1));');
    expect(result).toMatchObject({ ok: false, reason: 'memory' });
  });

  it('has no network, DOM, timers, Node or Tauri APIs', async () => {
    const result = await evaluate(`
      var names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'window', 'document', 'self',
        'process', 'Buffer', '__TAURI__', '__TAURI_INTERNALS__', 'setTimeout', 'importScripts',
        'Worker', 'navigator', 'localStorage', 'indexedDB'];
      var g = Function('return this')();
      console.log(names.filter(function (n) { return typeof g[n] !== 'undefined'; }).join(','));
      try { require('fs'); } catch (e) { console.log(e.message); }
    `);
    expect(result.ok && result.logs.map((l) => l.message)).toEqual([
      '',
      'NotSupportedInPigeon: require',
    ]);
    const imported = await evaluate(`import('fs').then(function () { console.log('loaded'); });`);
    expect(imported.ok && imported.logs).toEqual([]);
  });

  it('throws NotSupportedInPigeon for calls outside the subset', async () => {
    const result = await evaluate('pm.sendRequest("https://x.test", function () {});');
    expect(result).toMatchObject({ ok: false, reason: 'error' });
    expect(!result.ok && result.message).toContain('NotSupportedInPigeon: pm.sendRequest');
  });
});

describe('pre-request scripts in a send (PIGN-043)', () => {
  it('a variable set by a script is used in the same send; added headers are sent', async () => {
    const transport = new MockTransport().on({ url: /./ }, { body: 'ok' });
    const executor = new RequestExecutor(transport);
    const request = createRequest({
      name: 'Signed',
      url: { raw: '{{base}}/items?ts={{ts}}', query: [], pathVariables: [], extra: {} },
    });
    let writes: unknown;
    const logs: unknown[] = [];
    const result = await executor.execute(
      request,
      createExecutionContext({
        capabilities: MEMORY_CAPABILITIES,
        scopes: scopes(),
        preRequest: {
          runner,
          requestName: 'Signed',
          scripts: [
            { place: 'collection API', code: "pm.environment.set('ts', 12345);" },
            {
              place: 'this request',
              code: "pm.request.headers.add({ key: 'X-Ts', value: pm.environment.get('ts') }); console.log('token', pm.environment.get('token'));",
            },
          ],
          onWrites: (w) => (writes = w),
          onLogs: (entries) => logs.push(...entries),
        },
      }),
    );
    expect(result.error).toBeUndefined();
    const sent = transport.requests[0]!;
    expect(sent.url).toBe('https://api.test/items?ts=12345');
    expect(sent.headers).toContainEqual(['X-Ts', '12345']);
    expect(writes).toEqual([{ scopeKey: 'env:dev', key: 'ts', value: '12345' }]);
    // Secrets are masked in the console.
    expect(logs).toEqual([
      expect.objectContaining({ level: 'log', message: 'token ••••••', source: 'this request' }),
    ]);
  });

  it('a failing script names its place, stops the send and keeps earlier logs', async () => {
    const transport = new MockTransport().on({ url: /./ }, { body: 'ok' });
    const result = await new RequestExecutor(transport).execute(
      createRequest({
        name: 'X',
        url: { raw: 'https://api.test/', query: [], pathVariables: [], extra: {} },
      }),
      createExecutionContext({
        capabilities: MEMORY_CAPABILITIES,
        preRequest: {
          runner,
          requestName: 'X',
          scripts: [{ place: 'folder Admin', code: "throw new TypeError('bad input');" }],
        },
      }),
    );
    expect(transport.requests).toHaveLength(0);
    expect(result.error).toMatchObject({
      kind: 'script',
      message: 'Pre-request script error in folder Admin: TypeError: bad input',
    });
  });

  it('request-local variables win over every scope for this send only', async () => {
    const outcome = await runPreRequestScripts(
      runner,
      [{ place: 'this request', code: "pm.variables.set('base', 'http://local.test');" }],
      { request: createRequest({ name: 'X' }), scopes: scopes(), requestName: 'X' },
    );
    expect(outcome.ok && outcome.scopes.layers[0]).toMatchObject({ kind: 'local' });
    expect(outcome.ok && outcome.writes).toEqual([]);
  });
});
