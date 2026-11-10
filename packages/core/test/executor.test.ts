import type { Capabilities } from '@pigeon/platform';
import { MEMORY_CAPABILITIES, MockTransport, TransportError } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import type { RequestInit } from '../src/index';
import { createExecutionContext, createRequest, RequestExecutor } from '../src/index';

const URL_USER = 'http://localhost:4010/json/user';

function run(
  transport: MockTransport,
  init: RequestInit,
  opts: { signal?: AbortSignal; capabilities?: Partial<Capabilities> } = {},
) {
  const ctx = createExecutionContext({
    capabilities: { ...MEMORY_CAPABILITIES, ...opts.capabilities },
  });
  const request = createRequest(init);
  return {
    request,
    result: new RequestExecutor(transport).execute(
      request,
      ctx,
      opts.signal ? { signal: opts.signal } : {},
    ),
  };
}

describe('RequestExecutor', () => {
  it('sends the prepared request and normalizes the response', async () => {
    const transport = new MockTransport().on(
      { method: 'GET', url: URL_USER },
      {
        statusText: 'OK',
        headers: [['Content-Type', 'application/json']],
        body: '{"id":1,"name":"Ada Lovelace"}',
      },
    );
    const { request, result: pending } = run(transport, { url: URL_USER });
    const result = await pending;

    expect(transport.requests).toHaveLength(1);
    expect(result.error).toBeUndefined();
    expect(result.requestId).toBe(request.id);
    expect(result.id).toBe(transport.requests[0]?.id);
    expect(result.transport).toBe('native');
    expect(result.environmentId).toBeNull();
    expect(new Date(result.startedAt).toISOString()).toBe(result.startedAt);
    expect(result.request).toMatchObject({ method: 'GET', url: URL_USER });
    expect(result.response).toMatchObject({
      status: 200,
      statusText: 'OK',
      contentType: 'application/json',
      json: { id: 1, name: 'Ada Lovelace' },
      sizeBytes: 30,
    });
    expect(result.response?.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.warnings).toEqual([]);
  });

  it('sends a raw body and previews it in the result', async () => {
    const transport = new MockTransport().on({ method: 'POST', url: /\/echo$/ }, (req) => ({
      headers: [['content-type', 'text/plain']],
      body: req.body?.kind === 'bytes' ? req.body.bytes : '',
    }));
    const { result: pending } = run(transport, {
      method: 'POST',
      url: 'http://localhost:4010/echo',
      body: { mode: 'raw', raw: 'hello pigeon', language: 'text' },
    });
    const result = await pending;
    expect(result.response?.bodyText).toBe('hello pigeon');
    expect(result.request.bodyPreview).toBe('hello pigeon');
  });

  it('returns validation errors without calling the transport', async () => {
    const transport = new MockTransport();
    const { result: pending } = run(transport, { url: 'http://' });
    const result = await pending;
    expect(transport.requests).toHaveLength(0);
    expect(result.error?.kind).toBe('invalid-url');
    expect(result.response).toBeUndefined();
    expect(result.request).toEqual({ method: 'GET', url: 'http://', headers: [] });
  });

  it('passes transport warnings through', async () => {
    const transport = new MockTransport().on({ url: URL_USER }, { warnings: ['dropped Host'] });
    expect((await run(transport, { url: URL_USER }).result).warnings).toEqual(['dropped Host']);
  });

  it('maps a TransportError to an ExecutionError, keeping its warnings', async () => {
    const transport = new MockTransport().on({ url: URL_USER }, () => {
      throw new TransportError('cors-suspected', 'Blocked', {
        detail: 'TypeError: Failed to fetch',
        hint: 'CORS?',
        warnings: ['dropped User-Agent'],
      });
    });
    const result = await run(transport, { url: URL_USER }).result;
    expect(result.error).toEqual({
      kind: 'cors-suspected',
      message: 'Blocked',
      detail: 'TypeError: Failed to fetch',
      hint: 'CORS?',
    });
    expect(result.warnings).toEqual(['dropped User-Agent']);
    expect(result.response).toBeUndefined();
  });

  it('maps unexpected errors to kind unknown', async () => {
    const transport = new MockTransport(); // no route → rejects
    const result = await run(transport, { url: URL_USER }).result;
    expect(result.error).toMatchObject({
      kind: 'unknown',
      detail: expect.stringContaining('no route'),
    });
  });

  it('reports aborted when the signal fires', async () => {
    const transport = new MockTransport().on({ url: URL_USER }, () => new Promise(() => {}));
    const controller = new AbortController();
    const { result: pending } = run(transport, { url: URL_USER }, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    expect((await pending).error?.kind).toBe('aborted');
  });
});
