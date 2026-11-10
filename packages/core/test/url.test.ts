import { describe, expect, it } from 'vitest';

import type { KeyValue, Url } from '../src/index';
import {
  buildRequestUrl,
  createUrl,
  parseUrlRaw,
  splitUrlRaw,
  syncQueryIntoRaw,
  syncUrlFromRaw,
} from '../src/index';

const flag = (key: string): KeyValue => ({ key, value: '', extra: { valueNull: true } });

describe('splitUrlRaw', () => {
  it.each([
    ['http://x/a', { base: 'http://x/a', query: undefined, hash: undefined }],
    ['http://x/a?b=1#c', { base: 'http://x/a', query: 'b=1', hash: '#c' }],
    ['http://x/a?', { base: 'http://x/a', query: '', hash: undefined }],
    ['/p#frag?a=1', { base: '/p', query: undefined, hash: '#frag?a=1' }],
    ['{{base?url}}/x?y=1', { base: '{{base?url}}/x', query: 'y=1', hash: undefined }],
    ['/x?q={{a#b}}#h', { base: '/x', query: 'q={{a#b}}', hash: '#h' }],
  ])('%j', (raw, parts) => {
    expect(splitUrlRaw(raw)).toEqual(parts);
  });
});

describe('parseUrlRaw', () => {
  it.each<[string, KeyValue[]]>([
    ['', []],
    ['http://x/a', []],
    ['http://x/a?', []],
    [
      'http://x/a?a=1&b=2',
      [
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ],
    ],
    ['?a=', [{ key: 'a', value: '' }]],
    ['?flag', [flag('flag')]],
    ['?flag&a=1', [flag('flag'), { key: 'a', value: '1' }]],
    [
      '?a=1&a=2',
      [
        { key: 'a', value: '1' },
        { key: 'a', value: '2' },
      ],
    ],
    ['?a=1#frag', [{ key: 'a', value: '1' }]],
    ['/p#frag?a=1', []],
    [
      '?a=1&&b=2&',
      [
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ],
    ],
    ['?a=b=c', [{ key: 'a', value: 'b=c' }]],
    ['?=v', [{ key: '', value: 'v' }]],
    // Values are kept as typed: not decoded, not encoded.
    [
      '?q=hello%20world&x=a+b',
      [
        { key: 'q', value: 'hello%20world' },
        { key: 'x', value: 'a+b' },
      ],
    ],
    [
      '?q=hello world&n=Zoë',
      [
        { key: 'q', value: 'hello world' },
        { key: 'n', value: 'Zoë' },
      ],
    ],
    ['{{baseUrl}}/users?x={{v}}', [{ key: 'x', value: '{{v}}' }]],
    ['?{{k}}={{a&b=c}}&d', [{ key: '{{k}}', value: '{{a&b=c}}' }, flag('d')]],
    ['{{host?x}}/p', []],
  ])('query of %j', (raw, query) => {
    expect(parseUrlRaw(raw).query).toEqual(query);
  });

  it.each<[string, string[]]>([
    ['http://x/users/:id', ['id']],
    ['{{baseUrl}}/users/:id', ['id']],
    ['{{baseUrl}}/:org/repos/:repo/issues/:id?x=:no#:no', ['org', 'repo', 'id']],
    ['http://host:8080/a', []],
    ['localhost:8080/:x', ['x']],
    ['{{baseUrl}}:8080/:x', ['x']],
    ['http://[::1]:4010/:v', ['v']],
    ['http://user:pass@host/:v', ['v']],
    ['/a/:id/b/:id', ['id']],
    ['/a/b:c/:/x', []],
    ['/files/:name.json', ['name.json']],
    ['/{{a/:b}}/:c', ['c']],
    [':id', []], // no path at all: it's the host
  ])('path variables of %j', (raw, names) => {
    expect(parseUrlRaw(raw).pathVariableNames).toEqual(names);
  });
});

describe('syncQueryIntoRaw', () => {
  it('writes enabled rows in order and keeps base and hash', () => {
    const query: KeyValue[] = [
      { key: 'a', value: '1' },
      { key: 'b', value: '2', disabled: true },
      { key: 'c', value: '' },
      flag('d'),
    ];
    expect(syncQueryIntoRaw('http://x/a?old=1#h', query)).toBe('http://x/a?a=1&c=&d#h');
  });

  it('drops the ? when no row is enabled, and skips empty rows', () => {
    expect(syncQueryIntoRaw('http://x/a?a=1#h', [{ key: 'a', value: '1', disabled: true }])).toBe(
      'http://x/a#h',
    );
    expect(syncQueryIntoRaw('http://x/a', [{ key: '', value: '' }])).toBe('http://x/a');
    expect(syncQueryIntoRaw('', [{ key: 'a', value: '1' }])).toBe('?a=1');
  });

  it('keeps spaces, unicode and {{vars}} as typed but escapes what would re-split the URL', () => {
    const query: KeyValue[] = [
      { key: 'q', value: 'hello world' },
      { key: 'n', value: 'Zoë' },
      { key: 'v', value: '{{a&b}}' },
      { key: 'x=y', value: 'a&b#c=d' },
    ];
    expect(syncQueryIntoRaw('{{baseUrl}}/s', query)).toBe(
      '{{baseUrl}}/s?q=hello world&n=Zoë&v={{a&b}}&x%3Dy=a%26b%23c=d',
    );
  });

  it.each([
    'http://x/a?a=1&b=2',
    'http://x/a?a=1&a=2&flag&e=',
    '{{baseUrl}}/users/:id?q={{term}}&page=2#top',
    '?q=hello%20world&n=Zoë&x=a+b',
    'http://x/a?a=b=c',
    'http://x/a#only-hash',
    'http://x/a',
  ])('round-trips %j', (raw) => {
    expect(syncQueryIntoRaw(raw, parseUrlRaw(raw).query)).toBe(raw);
  });
});

describe('syncUrlFromRaw', () => {
  const url = (init: Partial<Url>): Url => ({ ...createUrl(), ...init });

  it('re-reads enabled params and keeps disabled rows where they were', () => {
    const before = url({
      raw: 'http://x/?a=1&c=3',
      query: [
        { key: 'a', value: '1' },
        { key: 'b', value: '2', disabled: true },
        { key: 'c', value: '3' },
      ],
    });
    expect(syncUrlFromRaw(before, 'http://x/?a=9&c=3&d=4').query).toEqual([
      { key: 'a', value: '9' },
      { key: 'b', value: '2', disabled: true },
      { key: 'c', value: '3' },
      { key: 'd', value: '4' },
    ]);
    expect(syncUrlFromRaw(before, 'http://x/').query).toEqual([
      { key: 'b', value: '2', disabled: true },
    ]);
  });

  it('keeps descriptions while keys and values are edited in place', () => {
    const before = url({
      raw: '?a=1',
      query: [{ key: 'a', value: '1', description: 'The A', type: 'text' }],
    });
    expect(syncUrlFromRaw(before, '?ab=2').query).toEqual([
      { key: 'ab', value: '2', description: 'The A', type: 'text' },
    ]);
    expect(syncUrlFromRaw(before, '?ab').query).toEqual([
      { key: 'ab', value: '', description: 'The A', type: 'text', extra: { valueNull: true } },
    ]);
    const flagged = url({ raw: '?a', query: [{ ...flag('a'), description: 'x' }] });
    expect(syncUrlFromRaw(flagged, '?a=1').query).toEqual([
      { key: 'a', value: '1', description: 'x' },
    ]);
  });

  it('follows :name segments, keeping values by name and across a rename', () => {
    const before = url({
      raw: '/orgs/:org/users/:i',
      pathVariables: [
        { key: 'org', value: 'acme', description: 'Org' },
        { key: 'i', value: '42' },
      ],
    });
    expect(syncUrlFromRaw(before, '/orgs/:org/users/:id').pathVariables).toEqual([
      { key: 'org', value: 'acme', description: 'Org' },
      { key: 'id', value: '42' },
    ]);
    expect(syncUrlFromRaw(before, '/users/:i/orgs/:org/:new').pathVariables).toEqual([
      { key: 'i', value: '42' },
      { key: 'org', value: 'acme', description: 'Org' },
      { key: 'new', value: '' },
    ]);
    expect(syncUrlFromRaw(before, '/users').pathVariables).toEqual([]);
  });
});

describe('buildRequestUrl', () => {
  const build = (raw: string, pathVariables: KeyValue[] = []) =>
    buildRequestUrl({ raw, pathVariables });

  it.each([
    ['http://x/s?q=hello world&n=Zoë', 'http://x/s?q=hello%20world&n=Zo%C3%AB'],
    ['http://x/s?q=hello%20world&p=100%&r=%zz', 'http://x/s?q=hello%20world&p=100%25&r=%25zz'],
    ['http://x/a b/ü/%41', 'http://x/a%20b/%C3%BC/%41'],
    ["http://x/s?a=b:c/d?e&f=a+b&g=(x),*;$!'@", "http://x/s?a=b:c/d?e&f=a+b&g=(x),*;$!'@"],
    ['http://x/s?a=<"x">&b=[1]|{2}`^\\', 'http://x/s?a=%3C%22x%22%3E&b=%5B1%5D%7C%7B2%7D%60%5E%5C'],
    ['http://x/p;a=1/@:+$,&=', 'http://x/p;a=1/@:+$,&='],
    ['http://x/s?flag&e=&=v', 'http://x/s?flag&e=&=v'],
    ['http://x/s?a=1#frag ment', 'http://x/s?a=1'],
    ['http://x/s?', 'http://x/s'],
    ['  http://x/s?a=1  ', 'http://x/s?a=1'],
    ['http://x/s?e=😀&l=\uD800', 'http://x/s?e=%F0%9F%98%80&l=%EF%BF%BD'],
  ])('%j → %j', (raw, expected) => {
    expect(build(raw)).toBe(expected);
  });

  it('substitutes path variables in the path only and encodes their values', () => {
    const id = [{ key: 'id', value: '42' }];
    expect(build('{{baseUrl}}/users/:id', id)).toBe('{{baseUrl}}/users/42');
    expect(build('http://host:8080/users/:id?id=:id', id)).toBe('http://host:8080/users/42?id=:id');
    expect(build('http://x/files/:name', [{ key: 'name', value: 'my file ü.txt' }])).toBe(
      'http://x/files/my%20file%20%C3%BC.txt',
    );
  });

  it('leaves unknown and empty path variables as typed', () => {
    expect(build('http://x/:a/:b', [{ key: 'a', value: '' }])).toBe('http://x/:a/:b');
  });
});
