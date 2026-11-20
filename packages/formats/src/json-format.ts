/**
 * Re-indents JSON text without parsing values into JS: numbers such as `12345678901234567890`
 * or `1.0` and string escapes stay exactly as typed. Returns `null` for invalid JSON.
 * `knownValid` skips the validation parse (e.g. `NormalizedResponse.json` already exists).
 *
 * Copies strings and literals as slices, so a 5 MB body formats in well under a second.
 */
export function beautifyJson(text: string, indent = '  ', knownValid = false): string | null {
  if (!knownValid) {
    try {
      JSON.parse(text);
    } catch {
      return null;
    }
  }
  const out: string[] = [];
  const indents: string[] = [''];
  const newline = (depth: number) => {
    while (indents.length <= depth) indents.push(indents[indents.length - 1] + indent);
    return `\n${indents[depth]}`;
  };
  let depth = 0;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const char = text[i];
    switch (char) {
      case '"': {
        let end = i + 1;
        while (end < n) {
          const c = text.charCodeAt(end);
          if (c === 0x22) break;
          // A backslash also skips the character it escapes.
          end += c === 0x5c ? 2 : 1;
        }
        out.push(text.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      case '{':
      case '[': {
        const close = char === '{' ? '}' : ']';
        let next = i + 1;
        while (next < n && isSpace(text.charCodeAt(next))) next++;
        if (text[next] === close) {
          out.push(char + close);
          i = next + 1;
        } else {
          depth++;
          out.push(char, newline(depth));
          i++;
        }
        continue;
      }
      case '}':
      case ']':
        depth--;
        out.push(newline(depth), char);
        i++;
        continue;
      case ',':
        out.push(',', newline(depth));
        i++;
        continue;
      case ':':
        out.push(': ');
        i++;
        continue;
    }
    if (isSpace(text.charCodeAt(i))) {
      i++;
      continue;
    }
    // A number or literal: copy up to the next structural character or space.
    let end = i + 1;
    while (end < n && !isBoundary(text.charCodeAt(end))) end++;
    out.push(text.slice(i, end));
    i = end;
  }
  return out.join('');
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
}

function isBoundary(code: number): boolean {
  return (
    isSpace(code) ||
    code === 0x2c || // ,
    code === 0x3a || // :
    code === 0x5d || // ]
    code === 0x7d || // }
    code === 0x22 // "
  );
}
