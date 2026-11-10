import { describe, expect, it } from 'vitest';

import { createRequest, RequestSchema } from '../src/index';

describe('createRequest', () => {
  it('creates a valid GET request with no body', () => {
    const request = createRequest();
    expect(RequestSchema.parse(request)).toEqual(request);
    expect(request).toMatchObject({
      kind: 'request',
      name: 'New Request',
      method: 'GET',
      url: { raw: '', query: [], pathVariables: [], extra: {} },
      headers: [],
      body: { mode: 'none' },
      settings: {},
    });
    expect(request.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uppercases the method and accepts a raw URL', () => {
    const request = createRequest({ method: 'post', url: 'http://localhost/x' });
    expect(request.method).toBe('POST');
    expect(request.url.raw).toBe('http://localhost/x');
  });

  it('gives every request a fresh id', () => {
    expect(createRequest().id).not.toBe(createRequest().id);
  });

  it('rejects invalid input', () => {
    expect(() => createRequest({ method: '' })).toThrow();
    expect(() =>
      createRequest({ body: { mode: 'raw', raw: 'x', language: 'yaml' as never } }),
    ).toThrow();
  });
});
