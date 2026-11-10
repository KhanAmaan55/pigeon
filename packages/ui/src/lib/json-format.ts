/**
 * Re-indents JSON text without parsing values into JS: numbers such as `12345678901234567890`
 * or `1.0` and string escapes stay exactly as typed. Returns `null` for invalid JSON.
 */
export function beautifyJson(text: string, indent = '  '): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  let out = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  const newline = () => `\n${indent.repeat(depth)}`;

  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? '';
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    switch (char) {
      case '"':
        inString = true;
        out += char;
        break;
      case '{':
      case '[': {
        const close = char === '{' ? '}' : ']';
        let next = i + 1;
        while (/\s/.test(text[next] ?? '')) next++;
        if (text[next] === close) {
          out += char + close;
          i = next;
        } else {
          depth++;
          out += char + newline();
        }
        break;
      }
      case '}':
      case ']':
        depth--;
        out += newline() + char;
        break;
      case ',':
        out += char + newline();
        break;
      case ':':
        out += ': ';
        break;
      case ' ':
      case '\t':
      case '\n':
      case '\r':
        break;
      default:
        out += char;
    }
  }
  return out;
}
