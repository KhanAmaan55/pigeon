/**
 * cURL commands → a request (PIGN-050). Pure parsing, no shell execution: the text is split into
 * words with the quoting of bash, Windows `cmd` or PowerShell (what Chromium's "Copy as cURL"
 * writes on each OS), then curl's options are mapped. Options Pigeon doesn't model are reported.
 */

import type {
  ProjectAuth,
  ProjectBody,
  ProjectKeyValue,
  ProjectRequestSettings,
} from '../project/types';

export type Shell = 'bash' | 'cmd' | 'powershell';

export interface CurlRequest {
  method: string;
  url: string;
  headers: ProjectKeyValue[];
  body: ProjectBody;
  auth?: ProjectAuth;
  settings: ProjectRequestSettings;
  /** Options that were ignored or only partly mapped. */
  warnings: string[];
  shell: Shell;
}

export type CurlParseResult = { ok: true; request: CurlRequest } | { ok: false; message: string };

/** Whether `text` looks like a cURL command (first word `curl` or `curl.exe`). */
export function isCurlCommand(text: string): boolean {
  return /^\s*curl(\.exe)?(\s|$)/i.test(text.replace(/^\uFEFF/, ''));
}

export function detectShell(text: string): Shell {
  if (/\^\r?\n/.test(text) || /\^"/.test(text)) return 'cmd';
  if (/`\r?\n/.test(text) || /^\s*curl\.exe\b/i.test(text)) return 'powershell';
  return 'bash';
}

const ANSI_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  "'": "'",
  '"': '"',
  a: '\u0007',
  b: '\b',
  e: '\u001b',
  f: '\f',
  v: '\v',
  '?': '?',
};

function tokenizeBash(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, ' ');
  const words: string[] = [];
  let word: string | null = null;
  const push = (s: string) => (word = (word ?? '') + s);
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      push(text.slice(i + 1, end === -1 ? undefined : end));
      i = end === -1 ? text.length : end;
    } else if (c === '$' && text[i + 1] === "'") {
      let out = '';
      let j = i + 2;
      for (; j < text.length && text[j] !== "'"; j++) {
        if (text[j] === '\\' && j + 1 < text.length) {
          const next = text[j + 1]!;
          if (next === 'x' && /^[0-9a-fA-F]{2}/.test(text.slice(j + 2, j + 4))) {
            out += String.fromCharCode(parseInt(text.slice(j + 2, j + 4), 16));
            j += 3;
          } else if (next === 'u' && /^[0-9a-fA-F]{4}/.test(text.slice(j + 2, j + 6))) {
            out += String.fromCharCode(parseInt(text.slice(j + 2, j + 6), 16));
            j += 5;
          } else {
            out += ANSI_ESCAPES[next] ?? `\\${next}`;
            j += 1;
          }
        } else out += text[j];
      }
      push(out);
      i = j;
    } else if (c === '"') {
      let out = '';
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && '"\\$`\n'.includes(text[j + 1] ?? '')) {
          out += text[j + 1];
          j += 1;
        } else out += text[j];
      }
      push(out);
      i = j;
    } else if (c === '\\' && i + 1 < text.length) {
      push(text[i + 1]!);
      i += 1;
    } else push(c);
  }
  if (word !== null) words.push(word);
  return words;
}

/** Windows argv rules (CommandLineToArgvW): quotes group, `\"` is a quote, backslashes pair up. */
function windowsArgv(text: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\') {
      let n = 0;
      while (text[i + n] === '\\') n++;
      if (text[i + n] === '"') {
        word = (word ?? '') + '\\'.repeat(Math.floor(n / 2));
        if (n % 2 === 1) word += '"';
        else quoted = !quoted;
        i += n;
      } else {
        word = (word ?? '') + '\\'.repeat(n);
        i += n - 1;
      }
    } else if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        word = (word ?? '') + '"';
        i += 1;
      } else {
        quoted = !quoted;
        word ??= '';
      }
    } else if (/\s/.test(c) && !quoted) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? '') + c;
  }
  if (word !== null) words.push(word);
  return words;
}

function tokenizeCmd(input: string): string[] {
  // cmd first: `^` escapes the next character (and `^` + newline continues the line).
  // Chromium writes a newline inside an argument as `^` + two line breaks.
  const unescaped = input
    .replace(/\^\r?\n\r?\n/g, '\n')
    .replace(/\^\r?\n/g, ' ')
    .replace(/\^([^])/g, '$1');
  return windowsArgv(unescaped);
}

function tokenizePowerShell(input: string): string[] {
  const text = input.replace(/`\r?\n/g, ' ');
  const words: string[] = [];
  let word: string | null = null;
  const push = (s: string) => (word = (word ?? '') + s);
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else if (c === "'") {
      let out = '';
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "'" && text[j + 1] === "'") {
          out += "'";
          j += 1;
        } else if (text[j] === "'") break;
        else out += text[j];
      }
      push(out);
      i = j;
    } else if (c === '"') {
      let out = '';
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '`' && j + 1 < text.length) {
          const next = text[j + 1]!;
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          j += 1;
        } else if (text[j] === '"' && text[j + 1] === '"') {
          out += '"';
          j += 1;
        } else if (text[j] === '"') break;
        else out += text[j];
      }
      push(out);
      i = j;
    } else if (c === '`' && i + 1 < text.length) {
      push(text[i + 1]!);
      i += 1;
    } else push(c);
  }
  if (word !== null) words.push(word);
  return words;
}

export function tokenize(text: string, shell: Shell = detectShell(text)): string[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  return shell === 'cmd'
    ? tokenizeCmd(trimmed)
    : shell === 'powershell'
      ? tokenizePowerShell(trimmed)
      : tokenizeBash(trimmed);
}

/** Options that take a value; long names map to their short form where curl has one. */
const VALUE_OPTIONS = new Map<string, string>([
  ['-X', 'X'],
  ['--request', 'X'],
  ['-H', 'H'],
  ['--header', 'H'],
  ['-d', 'd'],
  ['--data', 'd'],
  ['--data-ascii', 'd'],
  ['--data-binary', 'data-binary'],
  ['--data-raw', 'data-raw'],
  ['--data-urlencode', 'data-urlencode'],
  ['--json', 'json'],
  ['-F', 'F'],
  ['--form', 'F'],
  ['--form-string', 'form-string'],
  ['-u', 'u'],
  ['--user', 'u'],
  ['-b', 'b'],
  ['--cookie', 'b'],
  ['-A', 'A'],
  ['--user-agent', 'A'],
  ['-e', 'e'],
  ['--referer', 'e'],
  ['--url', 'url'],
  ['-m', 'm'],
  ['--max-time', 'm'],
  ['--max-redirs', 'max-redirs'],
  ['-o', 'ignore'],
  ['--output', 'ignore'],
  ['-w', 'ignore'],
  ['--write-out', 'ignore'],
  ['--connect-timeout', 'ignore'],
  ['--retry', 'ignore'],
  ['--oauth2-bearer', 'oauth2-bearer'],
  // Taken but not modelled: reported, and their value is not mistaken for the URL.
  ...[
    '-x',
    '--proxy',
    '-U',
    '--proxy-user',
    '--cacert',
    '--capath',
    '-E',
    '--cert',
    '--key',
    '--resolve',
    '--connect-to',
    '--interface',
    '--limit-rate',
    '-T',
    '--upload-file',
    '-c',
    '--cookie-jar',
    '-K',
    '--config',
    '-r',
    '--range',
    '-z',
    '--time-cond',
    '--unix-socket',
  ].map((name): [string, string] => [name, 'warn']),
]);
/** Flags without a value. */
const FLAG_OPTIONS = new Map<string, string>([
  ['-G', 'G'],
  ['--get', 'G'],
  ['-I', 'I'],
  ['--head', 'I'],
  ['-k', 'k'],
  ['--insecure', 'k'],
  ['-L', 'L'],
  ['--location', 'L'],
  ['--compressed', 'ignore'],
  ['-s', 'ignore'],
  ['--silent', 'ignore'],
  ['-S', 'ignore'],
  ['--show-error', 'ignore'],
  ['-v', 'ignore'],
  ['--verbose', 'ignore'],
  ['-i', 'ignore'],
  ['--include', 'ignore'],
  ['-f', 'ignore'],
  ['--fail', 'ignore'],
  ['-#', 'ignore'],
  ['--progress-bar', 'ignore'],
  ['--http1.1', 'ignore'],
  ['--http2', 'ignore'],
  ['--globoff', 'ignore'],
  ['-g', 'ignore'],
]);
/** Short flags that may be bundled (`-sSL`). */
const BUNDLE = new Set(['G', 'I', 'k', 'L', 's', 'S', 'v', 'i', 'f', 'g']);

function header(line: string): ProjectKeyValue | null {
  const colon = line.indexOf(':');
  if (colon === -1) {
    // `Name;` sends an empty header in curl.
    return line.endsWith(';') ? { key: line.slice(0, -1).trim(), value: '' } : null;
  }
  return { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
}

function hasHeader(headers: readonly ProjectKeyValue[], name: string): string | undefined {
  return headers.find((h) => h.key.toLowerCase() === name)?.value;
}

const FORM_PAIRS = /^[^=&\s]+=[^&]*(?:&[^=&\s]+=[^&]*)*$/;

function decodeForm(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

export function parseCurl(text: string): CurlParseResult {
  if (!isCurlCommand(text))
    return { ok: false, message: 'Not a cURL command (it should start with "curl").' };
  const shell = detectShell(text);
  const words = tokenize(text, shell);
  const warnings: string[] = [];
  const headers: ProjectKeyValue[] = [];
  const data: string[] = [];
  let dataKind = 'raw' as 'form' | 'raw' | 'json';
  let explicitMethod: string | undefined;
  let url: string | undefined;
  let get = false;
  let head = false;
  let auth: ProjectAuth | undefined;
  const settings: ProjectRequestSettings = {};
  const form: Array<{ name: string; value: string; file?: string; contentType?: string }> = [];
  let fileBody: string | undefined;

  const apply = (option: string, value: string | undefined) => {
    switch (option) {
      case 'X':
        explicitMethod = (value ?? '').toUpperCase();
        break;
      case 'H': {
        const parsed = header(value ?? '');
        if (parsed) headers.push(parsed);
        else warnings.push(`Header "${value}" has no ":" and was ignored.`);
        break;
      }
      case 'd':
        if ((value ?? '').startsWith('@')) {
          fileBody = value!.slice(1);
          warnings.push(
            `The body is read from the file "${fileBody}": pick the file in the Body tab.`,
          );
        } else {
          data.push(value ?? '');
          if (dataKind !== 'json') dataKind = 'form';
        }
        break;
      case 'data-raw':
        data.push(value ?? '');
        if (dataKind !== 'json') dataKind = 'form';
        break;
      case 'data-binary':
        if ((value ?? '').startsWith('@')) {
          fileBody = value!.slice(1);
          warnings.push(
            `The body is read from the file "${fileBody}": pick the file in the Body tab.`,
          );
        } else data.push(value ?? '');
        break;
      case 'data-urlencode': {
        const v = value ?? '';
        const eq = v.indexOf('=');
        if (v.includes('@') && (eq === -1 || v.indexOf('@') < eq)) {
          warnings.push(`--data-urlencode "${v}" reads a file and was ignored.`);
        } else if (eq === -1) data.push(encodeURIComponent(v));
        else data.push(`${v.slice(0, eq)}=${encodeURIComponent(v.slice(eq + 1))}`);
        if (dataKind !== 'json') dataKind = 'form';
        break;
      }
      case 'json':
        data.push(value ?? '');
        dataKind = 'json';
        if (!hasHeader(headers, 'content-type'))
          headers.push({ key: 'Content-Type', value: 'application/json' });
        if (!hasHeader(headers, 'accept'))
          headers.push({ key: 'Accept', value: 'application/json' });
        break;
      case 'F':
      case 'form-string': {
        const v = value ?? '';
        const eq = v.indexOf('=');
        if (eq === -1) {
          warnings.push(`Form field "${v}" has no "=" and was ignored.`);
          break;
        }
        const name = v.slice(0, eq);
        const rest = v.slice(eq + 1);
        if (option === 'F' && (rest.startsWith('@') || rest.startsWith('<'))) {
          const [path = '', ...params] = rest.slice(1).split(';');
          const type = params
            .find((p) => p.trim().startsWith('type='))
            ?.trim()
            .slice(5);
          form.push({ name, value: '', file: path, ...(type ? { contentType: type } : {}) });
          warnings.push(`Form field "${name}" uploads "${path}": pick the file in the Body tab.`);
        } else {
          form.push({ name, value: rest });
        }
        break;
      }
      case 'u': {
        const v = value ?? '';
        const colon = v.indexOf(':');
        auth = {
          type: 'basic',
          username: colon === -1 ? v : v.slice(0, colon),
          password: colon === -1 ? '' : v.slice(colon + 1),
        };
        break;
      }
      case 'b':
        if ((value ?? '').includes('=')) headers.push({ key: 'Cookie', value: value! });
        else warnings.push(`Cookies read from the file "${value}" were ignored.`);
        break;
      case 'A':
        headers.push({ key: 'User-Agent', value: value ?? '' });
        break;
      case 'e':
        headers.push({ key: 'Referer', value: value ?? '' });
        break;
      case 'url':
        url ??= value;
        break;
      case 'm': {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0)
          settings.timeoutMs = Math.round(seconds * 1000);
        break;
      }
      case 'max-redirs': {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0) settings.maxRedirects = n;
        break;
      }
      case 'oauth2-bearer':
        auth = { type: 'bearer', token: value ?? '' };
        break;
      case 'G':
        get = true;
        break;
      case 'I':
        head = true;
        break;
      case 'k':
        settings.strictSSL = false;
        break;
      case 'L':
        settings.followRedirects = true;
        break;
    }
  };

  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--') {
      url ??= words[i + 1];
      break;
    }
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const name = eq === -1 ? word : word.slice(0, eq);
      const valueOption = VALUE_OPTIONS.get(name);
      if (valueOption) {
        const value = eq === -1 ? words[++i] : word.slice(eq + 1);
        if (valueOption === 'warn') warnings.push(`Option ${name} was ignored.`);
        else if (valueOption !== 'ignore') apply(valueOption, value);
        continue;
      }
      const flag = FLAG_OPTIONS.get(name);
      if (flag) {
        if (flag !== 'ignore') apply(flag, undefined);
        continue;
      }
      warnings.push(`Unknown option ${name} was ignored.`);
      continue;
    }
    if (word.startsWith('-') && word.length > 1) {
      const short = word.slice(0, 2);
      const valueOption = VALUE_OPTIONS.get(short);
      if (valueOption) {
        const value = word.length > 2 ? word.slice(2) : words[++i];
        if (valueOption === 'warn') warnings.push(`Option ${short} was ignored.`);
        else if (valueOption !== 'ignore') apply(valueOption, value);
        continue;
      }
      // Bundled flags: -sSL
      const letters = word.slice(1).split('');
      if (letters.every((l) => BUNDLE.has(l))) {
        for (const letter of letters) {
          const flag = FLAG_OPTIONS.get(`-${letter}`);
          if (flag && flag !== 'ignore') apply(flag, undefined);
        }
        continue;
      }
      warnings.push(`Unknown option ${word} was ignored.`);
      continue;
    }
    url ??= word;
  }

  if (!url) return { ok: false, message: 'The cURL command has no URL.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith('{{')) url = `http://${url}`;

  let body: ProjectBody = { mode: 'none' };
  let method = explicitMethod ?? (head ? 'HEAD' : 'GET');
  if (get && data.length > 0) {
    url += (url.includes('?') ? '&' : '?') + data.join('&');
  } else if (form.length > 0) {
    body = {
      mode: 'formdata',
      params: form.map((f) =>
        f.file !== undefined
          ? {
              key: f.name,
              value: '',
              kind: 'file' as const,
              src: f.file,
              ...(f.contentType ? { contentType: f.contentType } : {}),
            }
          : { key: f.name, value: f.value, kind: 'text' as const },
      ),
    };
    method = explicitMethod ?? 'POST';
  } else if (fileBody !== undefined) {
    body = { mode: 'file', src: fileBody };
    method = explicitMethod ?? 'POST';
  } else if (data.length > 0) {
    const text = data.join('&');
    const contentType = (hasHeader(headers, 'content-type') ?? '').toLowerCase();
    const json = dataKind === 'json' || contentType.includes('json') || /^\s*[[{]/.test(text);
    if (json) {
      body = { mode: 'raw', raw: text, language: 'json' };
    } else if (
      (contentType === '' || contentType.includes('x-www-form-urlencoded')) &&
      FORM_PAIRS.test(text)
    ) {
      body = {
        mode: 'urlencoded',
        params: text.split('&').map((pair) => {
          const eq = pair.indexOf('=');
          return { key: decodeForm(pair.slice(0, eq)), value: decodeForm(pair.slice(eq + 1)) };
        }),
      };
    } else {
      body = {
        mode: 'raw',
        raw: text,
        language: contentType.includes('xml')
          ? 'xml'
          : contentType.includes('html')
            ? 'html'
            : 'text',
      };
    }
    method = explicitMethod ?? 'POST';
  }
  return {
    ok: true,
    request: {
      method,
      url,
      headers,
      body,
      ...(auth ? { auth } : {}),
      settings,
      warnings,
      shell,
    },
  };
}
