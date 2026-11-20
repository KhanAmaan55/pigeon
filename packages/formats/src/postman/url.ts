/**
 * Postman's URL decomposition (compatibility.md §A.4 item 2): exports carry `protocol`, `host[]`,
 * `port` and `path[]` derived from `raw`, which stays the source of truth. `{{variables}}` are
 * never split, so `{{baseUrl}}/users` is `host: ["{{baseUrl}}"], path: ["users"]`.
 */

export interface UrlParts {
  protocol?: string;
  host?: string[];
  port?: string;
  path?: string[];
}

/** Splits `text` on `separator` outside `{{…}}`. */
function splitOutsideVariables(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('{{', i)) {
      depth += 1;
      current += '{{';
      i += 1;
      continue;
    }
    if (depth > 0 && text.startsWith('}}', i)) {
      depth -= 1;
      current += '}}';
      i += 1;
      continue;
    }
    const char = text[i]!;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** The index of the first of `chars` outside `{{…}}`, or -1. */
function indexOutsideVariables(text: string, chars: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('{{', i)) {
      depth += 1;
      i += 1;
    } else if (depth > 0 && text.startsWith('}}', i)) {
      depth -= 1;
      i += 1;
    } else if (depth === 0 && chars.includes(text[i]!)) {
      return i;
    }
  }
  return -1;
}

/** `raw` as Postman decomposes it (query and hash are handled separately). */
export function decomposeUrl(raw: string): UrlParts {
  let rest = raw.trim();
  const end = indexOutsideVariables(rest, '?#');
  if (end !== -1) rest = rest.slice(0, end);
  const parts: UrlParts = {};
  const protocol = /^([A-Za-z][A-Za-z\d+.-]*):\/\//.exec(rest);
  if (protocol) {
    parts.protocol = protocol[1]!;
    rest = rest.slice(protocol[0].length);
  }
  const slash = indexOutsideVariables(rest, '/');
  let hostPort = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '' : rest.slice(slash + 1);
  const colon = splitOutsideVariables(hostPort, ':');
  if (colon.length > 1) {
    const port = colon.pop()!;
    if (/^(\d+|\{\{[^}]+\}\})$/.test(port)) {
      parts.port = port;
      hostPort = colon.join(':');
    }
  }
  if (hostPort !== '') parts.host = splitOutsideVariables(hostPort, '.');
  if (slash !== -1) parts.path = splitOutsideVariables(path, '/');
  return parts;
}
