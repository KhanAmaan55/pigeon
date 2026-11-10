import { describe, expect, it } from 'vitest';

import {
  bodyLanguage,
  describeBody,
  DISPLAY_LIMIT,
  hexDump,
  PRETTY_LIMIT,
  suggestFileName,
  truncateText,
} from '../src/features/response-viewer/body-view';
import { formatMarkup, formatSync } from '../src/features/response-viewer/formatting';

const text = (contentType: string | undefined, bodyText = 'x', sizeBytes = bodyText.length) => ({
  ...(contentType === undefined ? {} : { contentType }),
  bodyText,
  sizeBytes,
});

describe('describeBody', () => {
  it.each([
    ['application/json', 'json', ['pretty', 'raw'], 'pretty'],
    ['application/problem+json', 'json', ['pretty', 'raw'], 'pretty'],
    ['application/xml', 'xml', ['pretty', 'raw'], 'pretty'],
    ['application/atom+xml', 'xml', ['pretty', 'raw'], 'pretty'],
    ['text/html', 'html', ['pretty', 'raw', 'preview'], 'pretty'],
    ['application/javascript', 'javascript', ['pretty', 'raw'], 'pretty'],
    ['text/plain', 'text', ['raw'], 'raw'],
    ['text/csv', 'text', ['raw'], 'raw'],
    ['image/svg+xml', 'xml', ['pretty', 'raw', 'preview'], 'preview'],
  ] as const)('%s → %s, views %j, opens %s', (type, language, modes, defaultMode) => {
    expect(describeBody(text(type))).toMatchObject({ kind: 'text', language, modes, defaultMode });
  });

  it('opens raster images in Preview and other binaries in the binary summary', () => {
    expect(describeBody({ contentType: 'image/png', sizeBytes: 10 })).toMatchObject({
      kind: 'binary',
      preview: 'image',
      modes: ['preview'],
      defaultMode: 'preview',
    });
    expect(describeBody({ contentType: 'application/octet-stream', sizeBytes: 10 })).toMatchObject({
      kind: 'binary',
      modes: [],
      defaultMode: undefined,
    });
  });

  it('treats an empty body as empty whatever its type', () => {
    expect(
      describeBody({ contentType: 'application/json', bodyText: '', sizeBytes: 0 }),
    ).toMatchObject({ kind: 'empty', modes: [] });
  });

  it('opens bodies over 2 MB in Raw and flags bodies over 20 MB', () => {
    const at = (size: number) => describeBody(text('application/json', '{}', size));
    expect(at(PRETTY_LIMIT)).toMatchObject({ large: false, huge: false, defaultMode: 'pretty' });
    expect(at(PRETTY_LIMIT + 1)).toMatchObject({ large: true, huge: false, defaultMode: 'raw' });
    expect(at(DISPLAY_LIMIT)).toMatchObject({ large: true, huge: false });
    expect(at(DISPLAY_LIMIT + 1)).toMatchObject({ large: true, huge: true, defaultMode: 'raw' });
  });

  it('sniffs JSON and markup only when there is no Content-Type', () => {
    expect(bodyLanguage(undefined, '  {"a":1}')).toBe('json');
    expect(bodyLanguage(undefined, '[1]')).toBe('json');
    expect(bodyLanguage(undefined, '<!DOCTYPE html><p>')).toBe('html');
    expect(bodyLanguage(undefined, '<a/>')).toBe('xml');
    expect(bodyLanguage(undefined, 'plain')).toBe('text');
    expect(bodyLanguage('text/plain', '{"a":1}')).toBe('text');
  });
});

describe('truncateText', () => {
  it('cuts at the limit without splitting a surrogate pair', () => {
    expect(truncateText('abcdef', 10)).toEqual({ text: 'abcdef', cut: false });
    expect(truncateText('abcdef', 4)).toEqual({ text: 'abcd', cut: true });
    expect(truncateText('ab🐦cd', 3)).toEqual({ text: 'ab', cut: true });
  });
});

describe('suggestFileName', () => {
  const response = (url: string, contentType?: string, disposition?: string) => ({
    url,
    ...(contentType === undefined ? {} : { contentType }),
    headers:
      disposition === undefined
        ? []
        : ([['Content-Disposition', disposition]] as Array<[string, string]>),
  });

  it.each([
    ['http://h/json/user', 'application/json', undefined, 'user.json'],
    ['http://h/files/report.csv', 'text/csv', undefined, 'report.csv'],
    ['http://h/', 'text/html', undefined, 'response.html'],
    ['http://h/a%20b', 'application/octet-stream', undefined, 'a b.bin'],
    ['http://h/x', 'application/vnd.api+json', undefined, 'x.json'],
    ['http://h/x', undefined, undefined, 'x'],
    ['http://h/u', 'application/json', `inline; filename="plain.json"`, 'plain.json'],
    [
      'http://h/unicode',
      'application/json',
      `inline; filename="unicode.json"; filename*=UTF-8''%F0%9F%90%A6-%C3%BCn%C3%AFc%C3%B6d%C3%A9.json`,
      '🐦-ünïcödé.json',
    ],
    ['http://h/u', 'text/plain', `attachment; filename="../../etc/pass:wd"`, '_.._etc_pass_wd'],
  ])('%s %s %s → %s', (url, type, disposition, name) => {
    expect(suggestFileName(response(url, type, disposition))).toBe(name);
  });
});

describe('hexDump', () => {
  it('prints offsets, two groups of hex and printable ASCII', () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => (i === 0 ? 0x41 : i));
    expect(hexDump(bytes)).toEqual([
      '00000000  41 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  |A...............|',
      '00000010  10 11 12 13                                       |....|',
    ]);
    expect(hexDump(new Uint8Array(1000))).toHaveLength(16);
  });
});

describe('formatSync', () => {
  it('re-indents JSON keeping values exactly, and leaves invalid JSON as is', () => {
    expect(formatSync({ text: '{"n":9007199254740993,"f":1.0}', language: 'json' })).toBe(
      '{\n  "n": 9007199254740993,\n  "f": 1.0\n}',
    );
    expect(formatSync({ text: '{nope', language: 'json' })).toBe('{nope');
    // Known-valid JSON skips validation (its parse result already exists).
    expect(formatSync({ text: '[1,2]', language: 'json', knownValidJson: true })).toBe(
      '[\n  1,\n  2\n]',
    );
  });

  it('keeps unicode and escapes untouched', () => {
    const json = '{"emoji":"🐦 👩‍💻","nfd":"é","esc":"a\\"b\\\\n"}';
    expect(JSON.parse(formatSync({ text: json, language: 'json' }))).toEqual(JSON.parse(json));
  });

  it('leaves text and JavaScript alone', () => {
    expect(formatSync({ text: 'a  b', language: 'text' })).toBe('a  b');
    expect(formatSync({ text: 'f( 1 )', language: 'javascript' })).toBe('f( 1 )');
  });
});

describe('formatMarkup', () => {
  it('puts one XML element per line, keeping short text inline', () => {
    expect(
      formatMarkup(
        '<?xml version="1.0"?><a x="1>2"><b>text</b><c/><!-- note --><d><e>1</e></d><f></f></a>',
        false,
      ),
    ).toBe(
      [
        '<?xml version="1.0"?>',
        '<a x="1>2">',
        '  <b>text</b>',
        '  <c/>',
        '  <!-- note -->',
        '  <d>',
        '    <e>1</e>',
        '  </d>',
        '  <f></f>',
        '</a>',
      ].join('\n'),
    );
  });

  it('returns XML that does not nest unchanged', () => {
    expect(formatMarkup('<a><b></a>', false)).toBe('<a><b></a>');
    expect(formatMarkup('<a>', false)).toBe('<a>');
  });

  it('knows HTML void elements and keeps script and pre content verbatim', () => {
    expect(
      formatMarkup(
        '<!doctype html><html><body><br><img src=x><pre>  a\n b</pre><script>if (a < b) {}</script></body></html>',
        true,
      ),
    ).toBe(
      [
        '<!doctype html>',
        '<html>',
        '  <body>',
        '    <br>',
        '    <img src=x>',
        '    <pre>  a\n b</pre>',
        '    <script>if (a < b) {}</script>',
        '  </body>',
        '</html>',
      ].join('\n'),
    );
  });
});
