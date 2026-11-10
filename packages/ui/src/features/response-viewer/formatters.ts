/**
 * Pretty-printers for the response body's Pretty view. JSON is re-indented token by token
 * (values stay as received); XML and HTML get one element per line. Pure and DOM-free, so the
 * formatting worker (./format.worker.ts) can import it.
 */

import { beautifyJson } from '../../lib/json-format';
import type { BodyLanguage } from './body-view';

export interface FormatRequest {
  text: string;
  language: BodyLanguage;
  /** The text is known to be valid JSON (`NormalizedResponse.json` exists): skip validating. */
  knownValidJson?: boolean;
}

/** Formatted text, or `text` unchanged when it can't (or needn't) be formatted. */
export function formatSync({ text, language, knownValidJson = false }: FormatRequest): string {
  switch (language) {
    case 'json':
      return beautifyJson(text, '  ', knownValidJson) ?? text;
    case 'xml':
      return formatMarkup(text, false);
    case 'html':
      return formatMarkup(text, true);
    case 'javascript':
    case 'text':
      return text;
  }
}

// --- markup -----------------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
/** Kept verbatim: whitespace inside matters, or it isn't markup. */
const RAW_ELEMENTS = new Set(['script', 'style', 'pre', 'textarea']);
const INLINE_TEXT_MAX = 80;

type Token =
  | { kind: 'open'; name: string; text: string; selfClosing: boolean }
  | { kind: 'close'; name: string; text: string }
  | { kind: 'other'; text: string } // comment, doctype, processing instruction, CDATA
  | { kind: 'text'; text: string };

const TAG = /^<(\/?)([A-Za-z][\w:.-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/;

function tokenize(source: string, html: boolean): Token[] | null {
  const tokens: Token[] = [];
  let lower: string | undefined;
  let i = 0;
  while (i < source.length) {
    if (source[i] !== '<') {
      const end = source.indexOf('<', i);
      const stop = end === -1 ? source.length : end;
      tokens.push({ kind: 'text', text: source.slice(i, stop) });
      i = stop;
      continue;
    }
    const rest = source.slice(i, i + 9);
    const special = rest.startsWith('<!--')
      ? '-->'
      : rest.startsWith('<![CDATA[')
        ? ']]>'
        : rest.startsWith('<?')
          ? '?>'
          : rest.startsWith('<!')
            ? '>'
            : undefined;
    if (special) {
      const end = source.indexOf(special, i);
      if (end === -1) return null;
      tokens.push({ kind: 'other', text: source.slice(i, end + special.length) });
      i = end + special.length;
      continue;
    }
    const match = TAG.exec(source.slice(i, i + 64 * 1024));
    if (!match) {
      tokens.push({ kind: 'text', text: '<' });
      i++;
      continue;
    }
    const [text, slash, rawName = ''] = match;
    const name = html ? rawName.toLowerCase() : rawName;
    i += text.length;
    if (slash) {
      tokens.push({ kind: 'close', name, text });
      continue;
    }
    const selfClosing = text.endsWith('/>') || (html && VOID_ELEMENTS.has(name));
    tokens.push({ kind: 'open', name, text, selfClosing });
    if (html && RAW_ELEMENTS.has(name) && !selfClosing) {
      lower ??= source.toLowerCase();
      const close = lower.indexOf(`</${name}`, i);
      const end = close === -1 ? source.length : close;
      if (end > i) tokens.push({ kind: 'text', text: source.slice(i, end) });
      i = end;
    }
  }
  return tokens;
}

/**
 * One element per line, children indented by two spaces; short text stays inline
 * (`<a>text</a>`). HTML raw-text elements keep their content as received. XML that doesn't
 * nest properly is returned unchanged.
 */
export function formatMarkup(source: string, html: boolean): string {
  const tokens = tokenize(source, html);
  if (!tokens) return source;
  const lines: string[] = [];
  let depth = 0;
  const pad = () => '  '.repeat(Math.max(0, depth));

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    switch (token.kind) {
      case 'text': {
        const trimmed = token.text.trim();
        if (trimmed !== '') lines.push(pad() + trimmed);
        break;
      }
      case 'other':
        lines.push(pad() + token.text);
        break;
      case 'close':
        depth--;
        if (depth < 0 && !html) return source;
        lines.push(pad() + token.text);
        break;
      case 'open': {
        if (token.selfClosing) {
          lines.push(pad() + token.text);
          break;
        }
        const next = tokens[t + 1];
        const after = tokens[t + 2];
        const raw = html && RAW_ELEMENTS.has(token.name);
        if (raw && next?.kind === 'text') {
          // Verbatim: `<pre>  x\n y</pre>` keeps every character between the tags.
          const closing = after?.kind === 'close' ? after.text : '';
          lines.push(pad() + token.text + next.text + closing);
          t += closing ? 2 : 1;
          break;
        }
        if (next?.kind === 'close' && next.name === token.name) {
          lines.push(pad() + token.text + next.text);
          t += 1;
          break;
        }
        if (
          next?.kind === 'text' &&
          after?.kind === 'close' &&
          after.name === token.name &&
          !next.text.trim().includes('\n') &&
          next.text.trim().length <= INLINE_TEXT_MAX
        ) {
          lines.push(pad() + token.text + next.text.trim() + after.text);
          t += 2;
          break;
        }
        lines.push(pad() + token.text);
        depth++;
        break;
      }
    }
  }
  if (depth !== 0 && !html) return source;
  return lines.join('\n');
}
