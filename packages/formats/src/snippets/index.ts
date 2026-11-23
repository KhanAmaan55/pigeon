/**
 * Code snippets from a request (PIGN-050): cURL (bash), JavaScript fetch, Python requests and Go
 * net/http. Pure text generation from a neutral request shape; `core` builds that shape (resolving
 * variables and masking secrets when asked). New languages implement `SnippetGenerator`.
 */

export type SnippetPart =
  | { name: string; kind: 'text'; value: string; contentType?: string }
  /** `path`: the file's project path or name; snippets read it from disk. */
  | { name: string; kind: 'file'; path: string; contentType?: string };

export type SnippetBody =
  | { kind: 'text'; text: string }
  | { kind: 'multipart'; parts: SnippetPart[] }
  | { kind: 'file'; path: string };

export interface SnippetRequest {
  method: string;
  url: string;
  /** In order, duplicates allowed. */
  headers: Array<[string, string]>;
  body?: SnippetBody;
}

export interface SnippetGenerator {
  id: string;
  label: string;
  /** For syntax highlighting. */
  language: 'shell' | 'javascript' | 'python' | 'go';
  generate(request: SnippetRequest): string;
}

/**
 * A bash word for `text`: bare when safe, `'…'` otherwise (`'` becomes `'\''`), and ANSI-C
 * `$'…'` when it holds control characters such as newlines (as Chromium's "Copy as cURL" does).
 */
export function shellQuote(text: string): string {
  if (/^[A-Za-z0-9_\-./:=@%+,]+$/.test(text)) return text;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(text)) {
    const named: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    // eslint-disable-next-line no-control-regex
    const escaped = text.replace(/[\\'\x00-\x1f\x7f]/g, (c) =>
      c === '\\' || c === "'"
        ? `\\${c}`
        : (named[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`),
    );
    return `$'${escaped}'`;
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** A double-quoted string literal valid in JavaScript, Python 3 and Go. */
function quoted(text: string): string {
  return JSON.stringify(text);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export const curlSnippet: SnippetGenerator = {
  id: 'curl',
  label: 'cURL',
  language: 'shell',
  generate(req) {
    const lines: string[] = [];
    const method = req.method.toUpperCase();
    const hasBody = req.body !== undefined;
    const first =
      method === 'HEAD'
        ? `curl --head ${shellQuote(req.url)}`
        : (method === 'GET' && !hasBody) || (method === 'POST' && hasBody)
          ? `curl ${shellQuote(req.url)}`
          : `curl --request ${method} ${shellQuote(req.url)}`;
    lines.push(first);
    for (const [name, value] of req.headers) {
      lines.push(`--header ${shellQuote(`${name}: ${value}`)}`);
    }
    const body = req.body;
    if (body?.kind === 'text') lines.push(`--data-raw ${shellQuote(body.text)}`);
    else if (body?.kind === 'file') lines.push(`--data-binary ${shellQuote(`@${body.path}`)}`);
    else if (body?.kind === 'multipart') {
      for (const part of body.parts) {
        if (part.kind === 'file') {
          const type = part.contentType ? `;type=${part.contentType}` : '';
          lines.push(`--form ${shellQuote(`${part.name}=@${part.path}${type}`)}`);
        } else {
          // --form-string never reads files, whatever the value starts with.
          lines.push(`--form-string ${shellQuote(`${part.name}=${part.value}`)}`);
        }
      }
    }
    return lines.join(' \\\n  ') + '\n';
  },
};

/** Headers as one value per name (Python dicts): duplicates joined like HTTP allows. */
function mergedHeaders(headers: ReadonlyArray<[string, string]>): Array<[string, string]> {
  const merged = new Map<string, [string, string]>();
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    const existing = merged.get(key);
    if (existing) existing[1] += key === 'cookie' ? `; ${value}` : `, ${value}`;
    else merged.set(key, [name, value]);
  }
  return [...merged.values()];
}

export const fetchSnippet: SnippetGenerator = {
  id: 'fetch',
  label: 'JavaScript (fetch)',
  language: 'javascript',
  generate(req) {
    const out: string[] = [];
    const body = req.body;
    if (body?.kind === 'multipart') {
      out.push('const form = new FormData();');
      for (const part of body.parts) {
        if (part.kind === 'file') {
          out.push(
            `form.append(${quoted(part.name)}, fileInput.files[0], ${quoted(baseName(part.path))}); // ${part.path}`,
          );
        } else if (part.contentType) {
          out.push(
            `form.append(${quoted(part.name)}, new Blob([${quoted(part.value)}], { type: ${quoted(part.contentType)} }));`,
          );
        } else {
          out.push(`form.append(${quoted(part.name)}, ${quoted(part.value)});`);
        }
      }
      out.push('');
    }
    const options: string[] = [`  method: ${quoted(req.method.toUpperCase())},`];
    if (req.headers.length > 0) {
      const duplicates =
        new Set(req.headers.map(([n]) => n.toLowerCase())).size !== req.headers.length;
      if (duplicates) {
        options.push('  headers: [');
        for (const [n, v] of req.headers) options.push(`    [${quoted(n)}, ${quoted(v)}],`);
        options.push('  ],');
      } else {
        options.push('  headers: {');
        for (const [n, v] of req.headers) options.push(`    ${quoted(n)}: ${quoted(v)},`);
        options.push('  },');
      }
    }
    if (body?.kind === 'text') options.push(`  body: ${quoted(body.text)},`);
    else if (body?.kind === 'multipart') options.push('  body: form,');
    else if (body?.kind === 'file') {
      options.push(`  body: fileInput.files[0], // ${body.path}`);
    }
    out.push(`const response = await fetch(${quoted(req.url)}, {`);
    out.push(...options);
    out.push('});');
    out.push('');
    out.push('console.log(response.status);');
    out.push('console.log(await response.text());');
    return out.join('\n') + '\n';
  },
};

export const pythonSnippet: SnippetGenerator = {
  id: 'python',
  label: 'Python (requests)',
  language: 'python',
  generate(req) {
    const out = ['import requests', '', `url = ${quoted(req.url)}`];
    const args = ['url'];
    const headers = mergedHeaders(req.headers);
    if (headers.length > 0) {
      out.push('headers = {');
      for (const [n, v] of headers) out.push(`    ${quoted(n)}: ${quoted(v)},`);
      out.push('}');
      args.push('headers=headers');
    }
    const body = req.body;
    if (body?.kind === 'text') {
      out.push(`data = ${quoted(body.text)}`);
      args.push('data=data.encode("utf-8")');
    } else if (body?.kind === 'file') {
      out.push(`data = open(${quoted(body.path)}, "rb")`);
      args.push('data=data');
    } else if (body?.kind === 'multipart') {
      out.push('files = [');
      for (const part of body.parts) {
        const type = part.contentType ? `, ${quoted(part.contentType)}` : '';
        out.push(
          part.kind === 'file'
            ? `    (${quoted(part.name)}, (${quoted(baseName(part.path))}, open(${quoted(part.path)}, "rb")${type})),`
            : `    (${quoted(part.name)}, (None, ${quoted(part.value)}${type})),`,
        );
      }
      out.push(']');
      args.push('files=files');
    }
    out.push('');
    out.push(
      `response = requests.request(${quoted(req.method.toUpperCase())}, ${args.join(', ')})`,
    );
    out.push('');
    out.push('print(response.status_code)');
    out.push('print(response.text)');
    return out.join('\n') + '\n';
  },
};

export const goSnippet: SnippetGenerator = {
  id: 'go',
  label: 'Go (net/http)',
  language: 'go',
  generate(req) {
    const imports = new Set(['fmt', 'io', 'net/http']);
    const body: string[] = [];
    let reader = 'nil';
    const b = req.body;
    if (b?.kind === 'text') {
      imports.add('strings');
      body.push(`\tpayload := strings.NewReader(${quoted(b.text)})`, '');
      reader = 'payload';
    } else if (b?.kind === 'file') {
      imports.add('os');
      body.push(
        `\tpayload, err := os.Open(${quoted(b.path)})`,
        '\tif err != nil {',
        '\t\tpanic(err)',
        '\t}',
        '\tdefer payload.Close()',
        '',
      );
      reader = 'payload';
    } else if (b?.kind === 'multipart') {
      imports.add('bytes');
      imports.add('mime/multipart');
      body.push('\tpayload := &bytes.Buffer{}', '\twriter := multipart.NewWriter(payload)');
      for (const part of b.parts) {
        if (part.kind === 'file') {
          imports.add('os');
          body.push(
            '\t{',
            `\t\tfile, err := os.Open(${quoted(part.path)})`,
            '\t\tif err != nil {',
            '\t\t\tpanic(err)',
            '\t\t}',
            `\t\tpart, err := writer.CreateFormFile(${quoted(part.name)}, ${quoted(baseName(part.path))})`,
            '\t\tif err != nil {',
            '\t\t\tpanic(err)',
            '\t\t}',
            '\t\tif _, err := io.Copy(part, file); err != nil {',
            '\t\t\tpanic(err)',
            '\t\t}',
            '\t\tfile.Close()',
            '\t}',
          );
        } else {
          body.push(`\t_ = writer.WriteField(${quoted(part.name)}, ${quoted(part.value)})`);
        }
      }
      body.push('\tif err := writer.Close(); err != nil {', '\t\tpanic(err)', '\t}', '');
      reader = 'payload';
    }
    body.push(
      `\treq, err := http.NewRequest(${quoted(req.method.toUpperCase())}, ${quoted(req.url)}, ${reader})`,
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
    );
    for (const [n, v] of req.headers) body.push(`\treq.Header.Add(${quoted(n)}, ${quoted(v)})`);
    if (b?.kind === 'multipart') {
      body.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())');
    }
    body.push(
      '',
      '\tres, err := http.DefaultClient.Do(req)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tdefer res.Body.Close()',
      '',
      '\tdata, err := io.ReadAll(res.Body)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tfmt.Println(res.Status)',
      '\tfmt.Println(string(data))',
    );
    const sorted = [...imports].sort();
    return [
      'package main',
      '',
      'import (',
      ...sorted.map((i) => `\t${quoted(i)}`),
      ')',
      '',
      'func main() {',
      ...body,
      '}',
      '',
    ].join('\n');
  },
};

export const SNIPPET_GENERATORS: readonly SnippetGenerator[] = [
  curlSnippet,
  fetchSnippet,
  pythonSnippet,
  goSnippet,
];

export function snippetGenerator(id: string): SnippetGenerator | undefined {
  return SNIPPET_GENERATORS.find((g) => g.id === id);
}
