import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { EchoResponse } from '../src/index';
import { rawRequest, useTestServer } from './helpers';

const url = useTestServer();
const EMPTY_SHA256 = createHash('sha256').digest('hex');

const echo = async (path: string, init?: RequestInit) => {
  const res = await fetch(url(path), init);
  expect(res.status).toBe(200);
  return (await res.json()) as EchoResponse;
};

describe('/echo', () => {
  it('reflects method, raw path, query and headers', async () => {
    const body = await echo('/echo/a%20b/c?x=1&x=2&y=%C3%A9&empty=', {
      method: 'DELETE',
      headers: { 'X-Custom': 'one', Accept: 'application/json' },
    });
    expect(body).toMatchObject({
      method: 'DELETE',
      url: '/echo/a%20b/c?x=1&x=2&y=%C3%A9&empty=',
      path: '/echo/a%20b/c',
      query: { x: ['1', '2'], y: 'é', empty: '' },
      httpVersion: '1.1',
      parsed: null,
    });
    expect(body.headers['x-custom']).toBe('one');
    expect(body.rawHeaders).toContainEqual(['X-Custom', 'one']);
    expect(body.body).toEqual({ size: 0, text: '', base64: '', sha256: EMPTY_SHA256 });
  });

  it('keeps header name casing, order and duplicates in rawHeaders', async () => {
    const res = await rawRequest(url('/echo'), {
      headers: { 'X-Mixed-Case': 'a', 'x-second': 'b' },
    });
    const body = JSON.parse(res.body.toString()) as EchoResponse;
    const names = body.rawHeaders.map(([name]) => name);
    expect(names).toContain('X-Mixed-Case');
    expect(names.indexOf('X-Mixed-Case')).toBeLessThan(names.indexOf('x-second'));
  });

  it('answers non-preflight OPTIONS and HEAD requests', async () => {
    expect((await echo('/echo', { method: 'OPTIONS' })).method).toBe('OPTIONS');
    const head = await fetch(url('/echo'), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('returns a text body as text and base64', async () => {
    const body = await echo('/echo', {
      method: 'POST',
      body: 'héllo',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(body.body).toEqual({
      size: 6,
      text: 'héllo',
      base64: Buffer.from('héllo').toString('base64'),
      sha256: createHash('sha256').update('héllo').digest('hex'),
    });
    expect(body.parsed).toBeNull();
  });

  it('returns null text for bytes that are not UTF-8', async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0xfe, 0x80]);
    const body = await echo('/echo', { method: 'PUT', body: bytes });
    expect(body.body).toEqual({
      size: 4,
      text: null,
      base64: '/wD+gA==',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('parses JSON bodies, and reports invalid JSON', async () => {
    const valid = await echo('/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json; charset=utf-8' },
      body: '{"a":[1,true,null]}',
    });
    expect(valid.parsed).toEqual({ kind: 'json', value: { a: [1, true, null] } });

    const invalid = await echo('/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    expect(invalid.parsed).toMatchObject({ kind: 'invalid', contentType: 'application/json' });
  });

  it('parses urlencoded bodies in order, keeping duplicates', async () => {
    const body = await echo('/echo', {
      method: 'POST',
      body: new URLSearchParams([
        ['b', '2'],
        ['a', 'x y'],
        ['b', '3'],
      ]),
    });
    expect(body.parsed).toEqual({
      kind: 'urlencoded',
      fields: [
        ['b', '2'],
        ['a', 'x y'],
        ['b', '3'],
      ],
    });
  });

  it('parses multipart text and file parts with file names and sizes', async () => {
    const file = new Uint8Array([1, 2, 3, 4, 5]);
    const form = new FormData();
    form.append('title', 'Pigeon');
    form.append('upload', new Blob([file], { type: 'image/png' }), 'pïgeon.png');
    form.append('title', 'again');

    const body = await echo('/echo', { method: 'POST', body: form });
    expect(body.parsed).toEqual({
      kind: 'multipart',
      parts: [
        { name: 'title', kind: 'text', value: 'Pigeon' },
        {
          name: 'upload',
          kind: 'file',
          filename: 'pïgeon.png',
          contentType: 'image/png',
          size: 5,
          sha256: createHash('sha256').update(file).digest('hex'),
        },
        { name: 'title', kind: 'text', value: 'again' },
      ],
    });
  });

  it('reports a malformed multipart body as invalid', async () => {
    const body = await echo('/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=xyz' },
      body: 'not multipart',
    });
    expect(body.parsed).toMatchObject({ kind: 'invalid' });
  });
});
