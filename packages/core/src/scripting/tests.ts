/**
 * Test scripts (api-execution.md §9, PIGN-044): after the response, collection → folders →
 * request test scripts run in the sandbox with `pm.response`, `pm.test` and `pm.expect`. Only
 * the results cross the boundary. A script that throws outside `pm.test` (or times out) is
 * reported as an `error` result and the next script still runs.
 */

import type { Request } from '../model/request';
import type { NormalizedResponse } from '../execution/types';
import type { VariableScopes } from '../variables/scopes';
import type { CurrentValueWrite, ScriptSource } from './prerequest';
import { applyScopes, scriptRequest, scriptVariables } from './prerequest';
import type { ConsoleEntry, ScriptRunner, ScriptState, TestResult } from './types';
import { MAX_SCRIPT_BODY } from './types';

export interface TestCounts {
  pass: number;
  fail: number;
  error: number;
}

/** The test results of one send. */
export interface TestRun {
  results: TestResult[];
  counts: TestCounts;
}

export function countTests(results: readonly TestResult[]): TestCounts {
  const counts: TestCounts = { pass: 0, fail: 0, error: 0 };
  for (const result of results) counts[result.outcome] += 1;
  return counts;
}

/** The worst outcome of a test run (`pass` when there are no tests). */
export function testsOutcome(counts: TestCounts): 'pass' | 'fail' {
  return counts.fail > 0 || counts.error > 0 ? 'fail' : 'pass';
}

const decoder = new TextDecoder();

function scriptResponse(response: NormalizedResponse): NonNullable<ScriptState['response']> {
  const text = decoder.decode(response.body);
  return {
    code: response.status,
    status: response.statusText,
    headers: response.headers.map(([name, value]) => [name, value]),
    body: text.length > MAX_SCRIPT_BODY ? text.slice(0, MAX_SCRIPT_BODY) : text,
    responseTime: Math.round(response.timings.totalMs),
    responseSize: response.body.byteLength,
  };
}

export async function runTestScripts(
  runner: ScriptRunner,
  scripts: readonly ScriptSource[],
  input: {
    request: Request;
    response: NormalizedResponse;
    scopes: VariableScopes;
    requestName: string;
  },
): Promise<{ run: TestRun; writes: CurrentValueWrite[]; logs: ConsoleEntry[] }> {
  let state: ScriptState = {
    request: scriptRequest(input.request),
    response: scriptResponse(input.response),
    variables: scriptVariables(input.scopes),
    info: { requestName: input.requestName, requestId: input.request.id, eventName: 'test' },
    writes: [],
    tests: [],
  };
  const results: TestResult[] = [];
  const logs: ConsoleEntry[] = [];
  for (const script of scripts) {
    const output = await runner.run({ code: script.code, state: { ...state, tests: [] } });
    logs.push(...output.logs.map((entry) => ({ ...entry, source: script.place })));
    if (output.ok) {
      results.push(...(output.state.tests ?? []).map((t) => ({ ...t, place: script.place })));
      state = output.state;
    } else {
      results.push({
        name: `Test script in ${script.place}`,
        outcome: 'error',
        message: output.message,
        place: script.place,
      });
      logs.push({ level: 'error', message: output.message, source: script.place, at: Date.now() });
    }
  }
  const { persisted } = applyScopes(input.scopes, state.variables, state.writes);
  return { run: { results, counts: countTests(results) }, writes: persisted, logs };
}
