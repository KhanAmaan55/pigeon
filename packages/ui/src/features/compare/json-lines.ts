/**
 * Where each JSON path starts in pretty-printed JSON (`beautifyJson` output: one member or
 * element per line). Used to put diff markers next to lines and to scroll to a finding.
 */

import { keySegment } from '@pigeon/compare';
import { beautifyJson } from '@pigeon/formats';

export interface JsonLines {
  /** The pretty text's lines. */
  lines: string[];
  /** Concrete path (`$.items[3].id`) → first line (0-based). */
  concrete: Map<string, number>;
  /** Schema path (`$.items[*].id`) → first line. */
  schema: Map<string, number>;
}

const KEY = /^("(?:[^"\\]|\\.)*")\s*:\s?/;

/** Pretty-prints `text` (left as is when it isn't JSON) and indexes its paths. */
export function indexJson(text: string): JsonLines {
  const pretty = beautifyJson(text, '  ') ?? text;
  const lines = pretty.split('\n');
  const concrete = new Map<string, number>();
  const schema = new Map<string, number>();
  const stack: Array<{
    kind: 'object' | 'array';
    path: string;
    schemaPath: string;
    index: number;
  }> = [];
  for (const [number, line] of lines.entries()) {
    let rest = line.trim();
    if (rest === '') continue;
    if (rest.startsWith('}') || rest.startsWith(']')) {
      stack.pop();
      continue;
    }
    const top = stack.at(-1);
    let path = '$';
    let schemaPath = '$';
    if (top?.kind === 'object') {
      const key = KEY.exec(rest);
      if (!key) continue;
      const name = JSON.parse(key[1]!) as string;
      path = top.path + keySegment(name);
      schemaPath = top.schemaPath + keySegment(name);
      rest = rest.slice(key[0].length);
    } else if (top?.kind === 'array') {
      path = `${top.path}[${top.index}]`;
      schemaPath = `${top.schemaPath}[*]`;
      top.index += 1;
    }
    if (!concrete.has(path)) concrete.set(path, number);
    if (!schema.has(schemaPath)) schema.set(schemaPath, number);
    const value = rest.replace(/,$/, '');
    if (value === '{') stack.push({ kind: 'object', path, schemaPath, index: 0 });
    else if (value === '[') stack.push({ kind: 'array', path, schemaPath, index: 0 });
  }
  return { lines, concrete, schema };
}

/** The line of `path` (concrete first, then by schema path), or `undefined`. */
export function lineOf(
  index: JsonLines,
  path: string | undefined,
  schemaPath?: string,
): number | undefined {
  if (path !== undefined) {
    const line = index.concrete.get(path) ?? index.schema.get(path);
    if (line !== undefined) return line;
  }
  return schemaPath === undefined ? undefined : index.schema.get(schemaPath);
}
