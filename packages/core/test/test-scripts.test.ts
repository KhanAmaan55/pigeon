import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MEMORY_CAPABILITIES, MemoryAppState, MemoryFs, MockTransport } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { ScriptState } from '../src/index';
import {
  createExecutionContext,
  createQuickJsRunner,
  initializeProject,
  previewImport,
  ProjectSession,
  RequestExecutor,
  scriptChain,
} from '../src/index';

const runner = createQuickJsRunner();

function state(body: unknown = { id: 1, name: 'Ada', roles: ['admin'] }): ScriptState {
  return {
    request: { method: 'GET', url: 'https://api.test/x', headers: [], body: { mode: 'none' } },
    response: {
      code: 200,
      status: 'OK',
      headers: [['Content-Type', 'application/json']],
      body: JSON.stringify(body),
      responseTime: 12,
      responseSize: 40,
    },
    tests: [],
    variables: { environment: null, collection: {}, folders: {}, globals: {}, local: {} },
    info: { requestName: 'X', requestId: 'x', eventName: 'test' },
    writes: [],
  };
}

async function results(code: string) {
  const output = await runner.run({ code, state: state() });
  if (!output.ok) throw new Error(output.message);
  return output.state.tests!.map((t) => [t.name, t.outcome, t.message ?? '']);
}

describe('pm.expect subset (PIGN-044)', () => {
  it.each([
    ['pm.expect(1).to.equal(1)', 'pm.expect(1).to.equal(2)', 'expected 1 to equal 2'],
    [
      'pm.expect({ a: [1] }).to.eql({ a: [1] })',
      'pm.expect({ a: 1 }).to.eql({ a: 2 })',
      'to deeply equal',
    ],
    [
      'pm.expect({ a: 1 }).to.deep.equal({ a: 1 })',
      'pm.expect({ a: 1 }).to.equal({ a: 1 })',
      'to equal',
    ],
    ["pm.expect('pigeon').to.include('ige')", 'pm.expect([1, 2]).to.include(3)', 'to include 3'],
    [
      'pm.expect({ a: 1, b: 2 }).to.include({ a: 1 })',
      "pm.expect('x').to.contain('y')",
      "to include 'y'",
    ],
    [
      "pm.expect('s').to.be.a('string'); pm.expect([]).to.be.an('array')",
      "pm.expect(1).to.be.a('string')",
      'to be a string (got number)',
    ],
    [
      'pm.expect(true).to.be.true; pm.expect(false).to.be.false',
      'pm.expect(1).to.be.true',
      'to be true',
    ],
    [
      'pm.expect(null).to.be.null; pm.expect(undefined).to.be.undefined',
      'pm.expect(0).to.be.null',
      'to be null',
    ],
    [
      "pm.expect({ id: 1 }).to.have.property('id', 1)",
      "pm.expect({}).to.have.property('id')",
      "to have property 'id'",
    ],
    [
      "pm.expect({ a: { b: 2 } }).to.have.property('a').that.has.property('b', 2)",
      "pm.expect({ a: 1 }).to.have.property('a', 2)",
      'but got 1',
    ],
    [
      "pm.expect([1, 2]).to.have.length(2); pm.expect('abc').to.have.lengthOf(3)",
      'pm.expect([1]).to.have.length(2)',
      'to have length 2 but got 1',
    ],
    [
      'pm.expect(5).to.be.above(4).and.below(6); pm.expect(5).to.be.at.least(5)',
      'pm.expect(5).to.be.below(5)',
      'to be below 5',
    ],
    ["pm.expect('abc123').to.match(/\\d+/)", "pm.expect('abc').to.match(/\\d/)", 'to match'],
    [
      'pm.expect(1).to.not.equal(2); pm.expect([]).to.not.include(1)',
      'pm.expect(1).to.not.equal(1)',
      'not to equal 1',
    ],
    [
      "pm.expect(2).to.be.oneOf([1, 2]); pm.expect({ a: 1, b: 2 }).to.have.keys('a', 'b')",
      'pm.expect(3).to.be.oneOf([1, 2])',
      'to be one of',
    ],
    [
      "pm.expect([]).to.be.empty; pm.expect('x').to.exist",
      'pm.expect([1]).to.be.empty',
      'to be empty',
    ],
  ])('%s passes; the opposite fails with a message', async (passing, failing, message) => {
    const out = await results(
      `pm.test('pass', () => { ${passing}; }); pm.test('fail', () => { ${failing}; });`,
    );
    expect(out[0]).toEqual(['pass', 'pass', '']);
    expect(out[1]![1]).toBe('fail');
    expect(out[1]![2]).toContain(message);
  });

  it('pm.response: code, status, headers, json, text, time, size and to.have', async () => {
    const out = await results(`
      pm.test('a', () => pm.response.to.have.status(200));
      pm.test('b', () => pm.response.to.have.status('OK'));
      pm.test('c', () => pm.response.to.have.header('content-type', 'application/json'));
      pm.test('d', () => pm.response.to.be.ok);
      pm.test('e', () => pm.expect(pm.response.json().roles).to.eql(['admin']));
      pm.test('f', () => pm.expect(pm.response.text()).to.include('Ada'));
      pm.test('g', () => pm.expect(pm.response.responseTime).to.equal(12));
      pm.test('h', () => pm.expect(pm.response.headers.get('Content-Type')).to.equal('application/json'));
      pm.test('i', () => pm.response.to.have.status(201));
      pm.test('j', () => { throw new TypeError('boom'); });
      pm.test('k', () => pm.expect(pm.response.responseSize).to.equal(40));
    `);
    expect(out.map(([name, outcome]) => `${name}:${outcome}`)).toEqual([
      'a:pass',
      'b:pass',
      'c:pass',
      'd:pass',
      'e:pass',
      'f:pass',
      'g:pass',
      'h:pass',
      'i:fail',
      'j:error',
      'k:pass',
    ]);
    expect(out[8]![2]).toBe('expected response to have status 201 but got 200 OK');
    expect(out[9]![2]).toBe('TypeError: boom');
  });

  it('pm.test is not available in pre-request scripts', async () => {
    const output = await runner.run({
      code: "pm.test('x', () => {})",
      state: { ...state(), info: { requestName: 'X', requestId: 'x', eventName: 'prerequest' } },
    });
    expect(!output.ok && output.message).toContain('NotSupportedInPigeon: pm.test');
  });
});

describe('test scripts in a send (PIGN-044)', () => {
  async function fixture() {
    const fs = new MemoryFs();
    await initializeProject(fs, 'Tests');
    const session = await ProjectSession.fromFs(fs, { appState: new MemoryAppState() });
    const file = join(import.meta.dirname, '../../fixtures/postman/test-scripts.v2.1.json');
    const preview = previewImport(session.getWorkingModel(), readFileSync(file));
    if (!preview.ok) throw new Error(preview.message);
    session.apply({ type: 'importCollection', collection: preview.plan.collection });
    const transport = new MockTransport()
      .on(
        { url: /\/user$/ },
        {
          headers: [['Content-Type', 'application/json']],
          body: JSON.stringify({ id: 1, name: 'Ada', roles: ['admin'] }),
        },
      )
      .on(
        { url: /\/missing$/ },
        { status: 404, headers: [['Content-Type', 'application/json']], body: '{}' },
      );
    return { session, executor: new RequestExecutor(transport) };
  }

  async function send(name: string) {
    const { session, executor } = await fixture();
    const model = session.getWorkingModel();
    const folder = model.collections[0]!.children[0]!;
    const request =
      folder.kind === 'folder' ? folder.children.find((r) => r.name === name)! : undefined;
    if (request?.kind !== 'request') throw new Error('no request');
    const scripts = scriptChain(model, request.id, 'test');
    expect(scripts.map((s) => s.place)).toEqual([
      'collection Tested API',
      'folder Users',
      'this request',
    ]);
    const { events: _events, examples: _examples, broken: _broken, ...plain } = request;
    return executor.execute(
      plain,
      createExecutionContext({
        capabilities: MEMORY_CAPABILITIES,
        tests: { runner, scripts, requestName: name },
      }),
    );
  }

  it('the fixture runs with the expected counts, in order', async () => {
    const ok = await send('Get user');
    expect(ok.tests?.counts).toEqual({ pass: 5, fail: 0, error: 0 });
    expect(ok.tests?.results.map((r) => [r.place, r.name])).toEqual([
      ['collection Tested API', 'status is 200 or 404'],
      ['folder Users', 'has a content type'],
      ['this request', 'status 200'],
      ['this request', 'name'],
      ['this request', 'roles'],
    ]);
    const missing = await send('Missing user');
    expect(missing.tests?.counts).toEqual({ pass: 3, fail: 1, error: 1 });
    expect(missing.tests?.results.find((r) => r.name === 'throws')).toMatchObject({
      outcome: 'error',
      message: "ReferenceError: 'notDefined' is not defined",
    });
  });
});
