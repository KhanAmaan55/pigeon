import type { HistoryRecord, HistoryStore } from '@pigeon/platform';
import {
  MEMORY_CAPABILITIES,
  MemoryAppState,
  MemoryFs,
  MemoryHistoryStore,
  MockTransport,
} from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { ExecutionResult, HistoryEntry, VariableScopes } from '../src/index';
import {
  createExecutionContext,
  createRequest,
  filterHistory,
  groupHistoryByDay,
  historyEntryFromResult,
  initializeProject,
  ProjectHistory,
  ProjectSession,
  RequestExecutor,
  SECRET_MASK,
} from '../src/index';

const scopes = {
  layers: [
    {
      kind: 'environment' as const,
      name: 'Local',
      key: 'env:e',
      values: new Map([['token', { value: 'history-secret-token', secret: true }]]),
    },
  ],
} as unknown as VariableScopes;

async function send(body = '{"echo":"history-secret-token","ok":true}') {
  const transport = new MockTransport().on(() => true, {
    status: 201,
    headers: [
      ['content-type', 'application/json'],
      ['x-token', 'history-secret-token'],
    ],
    body,
  });
  let secrets: readonly string[] = [];
  const result = await new RequestExecutor(transport).execute(
    {
      ...createRequest({
        method: 'POST',
        url: 'http://localhost:4010/echo?t={{token}}',
        headers: [{ key: 'X-Token', value: '{{token}}' }],
        body: { mode: 'raw', raw: '{"token":"{{token}}"}', language: 'json' },
      }),
      auth: { type: 'bearer', token: 'literal-bearer-value' },
    },
    createExecutionContext({ capabilities: MEMORY_CAPABILITIES, scopes }),
    { onPrepared: (prepared) => (secrets = prepared.meta.secretValues) },
  );
  return { result, secrets };
}

function entry(id: string, at: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id,
    at,
    method: 'GET',
    url: `http://x.test/${id}`,
    storedBytes: 100,
    request: { method: 'GET', url: `http://x.test/${id}`, headers: [] },
    warnings: [],
    ...extra,
  };
}

/** Counts store calls (batching) on top of the memory store. */
class CountingStore implements HistoryStore {
  readonly inner = new MemoryHistoryStore();
  appends = 0;
  append(key: string, records: readonly HistoryRecord[]) {
    this.appends += 1;
    return this.inner.append(key, records);
  }
  list(key: string) {
    return this.inner.list(key);
  }
  get(key: string, id: string) {
    return this.inner.get(key, id);
  }
  remove(key: string, ids: readonly string[]) {
    return this.inner.remove(key, ids);
  }
  clear(key: string) {
    return this.inner.clear(key);
  }
}

describe('history entries (PIGN-051)', () => {
  it('masks secrets everywhere: URL, headers, bodies, the saved definition', async () => {
    const { result, secrets } = await send();
    const source = {
      ...createRequest({ url: 'http://x.test' }),
      auth: { type: 'bearer' as const, token: 'literal-bearer-value' },
    };
    const stored = historyEntryFromResult(result, {
      secretValues: secrets,
      requestName: 'Echo',
      environment: { id: 'e', name: 'Local' },
      comparison: 'pass',
      source,
    })!;
    const json = JSON.stringify(stored);
    expect(json).not.toContain('history-secret-token');
    expect(json).not.toContain('literal-bearer-value');
    expect(stored.url).toBe(`http://localhost:4010/echo?t=${SECRET_MASK}`);
    expect(stored.response?.headers).toContainEqual(['x-token', SECRET_MASK]);
    expect(stored.response?.body).toBe(`{"echo":"${SECRET_MASK}","ok":true}`);
    expect(stored.source?.auth).toEqual({ type: 'bearer', token: SECRET_MASK });
    expect(stored).toMatchObject({
      method: 'POST',
      status: 201,
      requestName: 'Echo',
      environment: { name: 'Local' },
      comparison: 'pass',
    });
    expect(stored.storedBytes).toBeGreaterThan(json.length - 20);
  });

  it('bounds bodies at 256 KB; binary bodies are base64', async () => {
    const big = 'é'.repeat(200 * 1024);
    const { result, secrets } = await send(JSON.stringify({ big }));
    const stored = historyEntryFromResult(result, { secretValues: secrets })!;
    expect(stored.response?.truncated).toBe(true);
    expect(new TextEncoder().encode(stored.response!.body).byteLength).toBeLessThanOrEqual(
      256 * 1024,
    );
    expect(stored.response?.sizeBytes).toBeGreaterThan(256 * 1024);

    const binary = {
      ...result,
      response: {
        ...result.response!,
        bodyText: undefined,
        body: new Uint8Array([0, 1, 2, 255]),
      },
    } as ExecutionResult;
    const bin = historyEntryFromResult(binary, { secretValues: [], maxBodyBytes: 3 })!;
    expect(bin.response).toMatchObject({ bodyEncoding: 'base64', body: 'AAEC', truncated: true });
  });

  it('never stores results with unmaskable secrets, nor cancelled sends', async () => {
    const { result } = await send();
    expect(
      historyEntryFromResult({ ...result, containsUnmaskedSecrets: true }, { secretValues: [] }),
    ).toBeNull();
    const { response: _r, ...rest } = result;
    expect(
      historyEntryFromResult(
        { ...rest, error: { kind: 'aborted', message: 'Cancelled' } },
        { secretValues: [] },
      ),
    ).toBeNull();
    const failed = historyEntryFromResult(
      { ...rest, error: { kind: 'network', message: 'refused history-secret-token' } },
      { secretValues: ['history-secret-token'] },
    )!;
    expect(failed.error).toBe(`refused ${SECRET_MASK}`);
    expect(failed.status).toBeUndefined();
  });
});

describe('ProjectHistory', () => {
  it('lists queued entries at once and writes them in one batch', async () => {
    const store = new CountingStore();
    const history = new ProjectHistory(store, 'p');
    let changes = 0;
    history.subscribe(() => (changes += 1));
    history.record(entry('a', '2026-11-20T10:00:00.000Z'));
    history.record(entry('b', '2026-11-20T10:01:00.000Z'));
    expect((await history.list()).map((s) => s.id)).toEqual(['b', 'a']);
    expect((await history.get('a'))?.id).toBe('a');
    await history.flush();
    expect(store.appends).toBe(1);
    expect(changes).toBe(2);
    // A fresh instance (an app restart) reads them back.
    const reopened = new ProjectHistory(store, 'p');
    expect((await reopened.list()).map((s) => s.id)).toEqual(['b', 'a']);
    expect((await reopened.get('b'))?.request.url).toBe('http://x.test/b');
  });

  it('evicts the oldest past the entry and byte limits', async () => {
    const store = new MemoryHistoryStore();
    const history = new ProjectHistory(store, 'p', { maxEntries: 3, maxBytes: 1000 });
    for (const id of ['a', 'b', 'c', 'd']) history.record(entry(id, `2026-11-20T10:0${id}`));
    await history.flush();
    expect((await history.list()).map((s) => s.id)).toEqual(['d', 'c', 'b']);
    expect(await store.get('p', 'a')).toBeUndefined();

    history.record(entry('big', '2026-11-20T11:00', { storedBytes: 900 }));
    await history.flush();
    // 100 (d) + 900 (big) is exactly the byte limit: b and c go.
    expect((await history.list()).map((s) => s.id)).toEqual(['big', 'd']);
    expect(await store.list('p')).toHaveLength(2);
  });

  it('remove and clear', async () => {
    const store = new MemoryHistoryStore();
    const history = new ProjectHistory(store, 'p');
    history.record(entry('a', '2026-11-20T10:00'));
    history.record(entry('b', '2026-11-20T10:01'));
    await history.remove(['a']);
    expect((await history.list()).map((s) => s.id)).toEqual(['b']);
    await history.clear();
    expect(await history.list()).toEqual([]);
    expect(await store.list('p')).toEqual([]);
  });

  it('filters by text, method and status; groups by local day', () => {
    const list = [
      { ...entry('a', '2026-11-21T12:00:00'), method: 'POST', status: 201, requestName: 'Create' },
      { ...entry('b', '2026-11-21T09:00:00'), status: 404 },
      { ...entry('c', '2026-11-20T09:00:00') },
    ];
    expect(filterHistory(list, { method: 'POST' }).map((s) => s.id)).toEqual(['a']);
    expect(filterHistory(list, { status: '4xx' }).map((s) => s.id)).toEqual(['b']);
    expect(filterHistory(list, { status: 'error' }).map((s) => s.id)).toEqual(['c']);
    expect(filterHistory(list, { text: 'create' }).map((s) => s.id)).toEqual(['a']);
    expect(filterHistory(list, { text: 'X.TEST/B' }).map((s) => s.id)).toEqual(['b']);
    expect(groupHistoryByDay(list).map((g) => [g.day, g.entries.length])).toEqual([
      ['2026-11-21', 2],
      ['2026-11-20', 1],
    ]);
  });

  it('a session keeps history under its local key, never in the project folder', async () => {
    const fs = new MemoryFs();
    await initializeProject(fs, 'History');
    const store = new MemoryHistoryStore();
    const session = await ProjectSession.fromFs(fs, {
      appState: new MemoryAppState(),
      history: store,
    });
    const before = await fs.list('');
    session.history!.record(entry('a', '2026-11-20T10:00'));
    await session.history!.flush();
    expect(await store.list(session.localKey)).toHaveLength(1);
    expect(await fs.list('')).toEqual(before);
    const noState = await ProjectSession.fromFs(fs, { history: store });
    expect(noState.history).toBeNull();
  });
});
