import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { CurlRequest, Shell, SnippetRequest } from '../src/index';
import {
  curlSnippet,
  detectFormat,
  detectShell,
  fetchSnippet,
  goSnippet,
  isCurlCommand,
  parseCurl,
  pythonSnippet,
  SNIPPET_GENERATORS,
  tokenizeShell,
} from '../src/index';

const fixtures = fileURLToPath(new URL('../../fixtures/curl/', import.meta.url));
const fixture = (name: string) => readFileSync(join(fixtures, name), 'utf8');

function parsed(text: string): CurlRequest {
  const result = parseCurl(text);
  if (!result.ok) throw new Error(result.message);
  return result.request;
}

const header = (request: CurlRequest, name: string) =>
  request.headers.filter((h) => h.key.toLowerCase() === name).map((h) => h.value);

describe('Chrome "Copy as cURL" fixtures (PIGN-050)', () => {
  const POST_JSON: Array<[string, Shell]> = [
    ['chrome-bash-post-json.txt', 'bash'],
    ['chrome-cmd-post-json.txt', 'cmd'],
    ['powershell-post-json.txt', 'powershell'],
  ];
  it.each(POST_JSON)('%s imports as the same POST request', (name, shell) => {
    const request = parsed(fixture(name));
    expect(request.shell).toBe(shell);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.example.com/users?page=2&q=a%20b');
    expect(header(request, 'content-type')).toEqual(['application/json']);
    expect(header(request, 'cookie')).toEqual(['session=abc123; theme=dark']);
    expect(request.body).toEqual({
      mode: 'raw',
      raw: '{"name":"Ada","note":"it\'s \\"quoted\\""}',
      language: 'json',
    });
    expect(JSON.parse((request.body as { raw: string }).raw)).toEqual({
      name: 'Ada',
      note: 'it\'s "quoted"',
    });
    expect(request.warnings).toEqual([]);
  });

  it('bash and cmd keep the full user agent', () => {
    expect(header(parsed(fixture('chrome-bash-post-json.txt')), 'user-agent')[0]).toMatch(
      /^Mozilla\/5\.0 \(Macintosh;.*Safari\/537\.36$/,
    );
    expect(header(parsed(fixture('chrome-cmd-post-json.txt')), 'user-agent')[0]).toMatch(
      /^Mozilla\/5\.0 \(Windows NT.*Safari\/537\.36$/,
    );
  });

  it("decodes bash $'…' strings and an explicit -X", () => {
    const request = parsed(fixture('chrome-bash-ansi.txt'));
    expect(request.method).toBe('PUT');
    expect(request.body).toEqual({
      mode: 'raw',
      raw: "line one\nline two\ttabbed 'single' café",
      language: 'text',
    });
  });

  it('maps a urlencoded --data-raw to form fields; --compressed is accepted', () => {
    const request = parsed(fixture('chrome-bash-form.txt'));
    expect(request.method).toBe('POST');
    expect(request.body).toEqual({
      mode: 'urlencoded',
      params: [
        { key: 'user', value: 'ada@example.com' },
        { key: 'password', value: 'p&ss word' },
        { key: 'remember', value: 'on' },
      ],
    });
    expect(request.warnings).toEqual([]);
  });

  it('detectFormat recognizes cURL text', () => {
    const detected = detectFormat(new TextEncoder().encode(fixture('chrome-cmd-post-json.txt')));
    expect(detected.kind).toBe('curl');
    expect(detectFormat('curl').kind).toBe('unknown');
    expect(detectFormat('hello').kind).toBe('unknown');
  });
});

describe('tokenizer', () => {
  const CASES: Array<[Shell, string, string[]]> = [
    ['bash', `curl 'a b' "c \\"d\\" \\$e" f\\ g`, ['curl', 'a b', 'c "d" $e', 'f g']],
    ['bash', 'curl -H \'x: 1\' \\\n  -H "y: 2"', ['curl', '-H', 'x: 1', '-H', 'y: 2']],
    ['bash', "curl $'a\\x41\\u00e9\\'b'", ['curl', "aAé'b"]],
    ['bash', "curl ''", ['curl', '']],
    ['cmd', 'curl ^"a^&b^" ^\r\n  -d ^"x^"', ['curl', 'a&b', '-d', 'x']],
    ['cmd', 'curl "say \\"hi\\"" "back\\\\slash"', ['curl', 'say "hi"', 'back\\\\slash']],
    ['cmd', 'curl ^"one^\n\ntwo^"', ['curl', 'one\ntwo']],
    ['powershell', "curl.exe 'it''s' `\n  \"a`tb\"", ['curl.exe', "it's", 'a\tb']],
  ];
  it.each(CASES)('%s: %j', (shell, text, words) => {
    expect(tokenizeShell(text, shell)).toEqual(words);
  });

  it('detects the shell from its continuation and escape characters', () => {
    expect(detectShell('curl x \\\n -v')).toBe('bash');
    expect(detectShell('curl ^"x^"')).toBe('cmd');
    expect(detectShell('curl x `\n -v')).toBe('powershell');
    expect(detectShell('curl.exe x')).toBe('powershell');
  });
});

describe('options', () => {
  it('-u, -k, -L, -A, -e, --url, -m and bundled flags', () => {
    const request = parsed(
      "curl -sSLk -u 'ada:pa:ss' -A agent -e https://ref --url example.com/x -m 2.5 --max-redirs 3",
    );
    expect(request.url).toBe('http://example.com/x');
    expect(request.auth).toEqual({ type: 'basic', username: 'ada', password: 'pa:ss' });
    expect(request.settings).toEqual({
      followRedirects: true,
      strictSSL: false,
      timeoutMs: 2500,
      maxRedirects: 3,
    });
    expect(header(request, 'user-agent')).toEqual(['agent']);
    expect(header(request, 'referer')).toEqual(['https://ref']);
  });

  it('-G moves the data into the query string', () => {
    const request = parsed("curl -G https://x.test/s -d q=1 --data-urlencode 'name=a b'");
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://x.test/s?q=1&name=a%20b');
    expect(request.body).toEqual({ mode: 'none' });
  });

  it('-F builds form-data with text and file fields', () => {
    const request = parsed(
      "curl https://x.test/up -F 'title=Hello' -F 'doc=@./a b.pdf;type=application/pdf' --form-string 'raw=@literal'",
    );
    expect(request.method).toBe('POST');
    expect(request.body).toEqual({
      mode: 'formdata',
      params: [
        { key: 'title', value: 'Hello', kind: 'text' },
        { key: 'doc', value: '', kind: 'file', src: './a b.pdf', contentType: 'application/pdf' },
        { key: 'raw', value: '@literal', kind: 'text' },
      ],
    });
    expect(request.warnings).toEqual([expect.stringMatching(/"doc" uploads "\.\/a b\.pdf"/)]);
  });

  it('--json sets JSON headers; --data-binary @file is a file body', () => {
    const json = parsed(`curl --json '{"a":1}' https://x.test`);
    expect(json.body).toEqual({ mode: 'raw', raw: '{"a":1}', language: 'json' });
    expect(header(json, 'content-type')).toEqual(['application/json']);
    expect(header(json, 'accept')).toEqual(['application/json']);
    const file = parsed('curl -X PUT --data-binary @payload.bin https://x.test');
    expect(file).toMatchObject({ method: 'PUT', body: { mode: 'file', src: 'payload.bin' } });
  });

  it('--oauth2-bearer is bearer auth', () => {
    expect(parsed('curl --oauth2-bearer t0k https://x.test').auth).toEqual({
      type: 'bearer',
      token: 't0k',
    });
  });

  it('-I is HEAD; -X wins over the inferred method', () => {
    expect(parsed('curl -I https://x.test').method).toBe('HEAD');
    expect(parsed('curl -X delete https://x.test -d a=1').method).toBe('DELETE');
  });

  it('reports unknown options and keeps going', () => {
    const request = parsed('curl --proxy http://p:1 --frobnicate https://x.test -Z');
    expect(request.url).toBe('https://x.test');
    expect(request.warnings).toEqual([
      'Option --proxy was ignored.',
      'Unknown option --frobnicate was ignored.',
      'Unknown option -Z was ignored.',
    ]);
  });

  it('rejects non-cURL text and commands without a URL', () => {
    expect(isCurlCommand('  curl https://x')).toBe(true);
    expect(isCurlCommand('curly https://x')).toBe(false);
    expect(parseCurl('wget https://x')).toMatchObject({ ok: false });
    expect(parseCurl('curl -H "a: b"')).toEqual({
      ok: false,
      message: 'The cURL command has no URL.',
    });
  });
});

const SNIPPET_FIXTURES: Record<string, SnippetRequest> = {
  get: {
    method: 'GET',
    url: 'https://api.example.com/users?page=2',
    headers: [
      ['Accept', 'application/json'],
      ['Authorization', 'Bearer ••••••'],
    ],
  },
  postJson: {
    method: 'POST',
    url: 'https://api.example.com/users',
    headers: [['Content-Type', 'application/json']],
    body: { kind: 'text', text: '{"name":"Ada","note":"it\'s \\"quoted\\""}' },
  },
  putText: {
    method: 'PUT',
    url: 'http://localhost:4010/echo',
    headers: [['Content-Type', 'text/plain']],
    body: { kind: 'text', text: "line one\nline 'two'" },
  },
  form: {
    method: 'POST',
    url: 'https://x.test/login',
    headers: [['Content-Type', 'application/x-www-form-urlencoded']],
    body: { kind: 'text', text: 'user=ada%40example.com&password=p%26ss' },
  },
  multipart: {
    method: 'POST',
    url: 'https://x.test/upload',
    headers: [],
    body: {
      kind: 'multipart',
      parts: [
        { name: 'title', kind: 'text', value: '@not-a-file' },
        { name: 'doc', kind: 'file', path: 'files/a b.pdf', contentType: 'application/pdf' },
      ],
    },
  },
  file: {
    method: 'PUT',
    url: 'https://x.test/blob',
    headers: [['Content-Type', 'application/octet-stream']],
    body: { kind: 'file', path: 'files/data.bin' },
  },
  head: { method: 'HEAD', url: 'https://x.test', headers: [] },
  getWithBody: {
    method: 'GET',
    url: 'https://x.test/search',
    headers: [['Content-Type', 'application/json']],
    body: { kind: 'text', text: '{"q":1}' },
  },
};

describe('snippets (PIGN-050)', () => {
  for (const generator of SNIPPET_GENERATORS) {
    it(`${generator.label} snapshots`, () => {
      const out = Object.fromEntries(
        Object.entries(SNIPPET_FIXTURES).map(([name, request]) => [
          name,
          generator.generate(request),
        ]),
      );
      expect(out).toMatchSnapshot();
    });
  }

  it.each(Object.entries(SNIPPET_FIXTURES))(
    'generated cURL for %s round-trips through the parser',
    (_, request) => {
      const back = parsed(curlSnippet.generate(request));
      expect(back.method).toBe(request.method);
      expect(back.url).toBe(request.url);
      expect(back.headers.map((h) => [h.key, h.value])).toEqual(request.headers);
      const body = request.body;
      if (!body) expect(back.body).toEqual({ mode: 'none' });
      else if (body.kind === 'file') expect(back.body).toEqual({ mode: 'file', src: body.path });
      else if (body.kind === 'multipart') {
        expect(back.body).toEqual({
          mode: 'formdata',
          params: body.parts.map((p) =>
            p.kind === 'file'
              ? { key: p.name, value: '', kind: 'file', src: p.path, contentType: p.contentType }
              : { key: p.name, value: p.value, kind: 'text' },
          ),
        });
      } else if (back.body.mode === 'urlencoded') {
        expect(new URLSearchParams(body.text).toString()).toBe(
          new URLSearchParams(
            back.body.params.map((p): [string, string] => [p.key, p.value]),
          ).toString(),
        );
      } else {
        expect(back.body).toMatchObject({ mode: 'raw', raw: body.text });
      }
    },
  );

  it('string literals escape quotes and newlines for every language', () => {
    const request = SNIPPET_FIXTURES['putText']!;
    expect(fetchSnippet.generate(request)).toContain(`body: "line one\\nline 'two'",`);
    expect(pythonSnippet.generate(request)).toContain(`data = "line one\\nline 'two'"`);
    expect(goSnippet.generate(request)).toContain(
      `payload := strings.NewReader("line one\\nline 'two'")`,
    );
    expect(curlSnippet.generate(request)).toContain(`--data-raw $'line one\\nline \\'two\\''`);
  });
});
