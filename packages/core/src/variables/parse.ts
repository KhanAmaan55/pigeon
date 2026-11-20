/**
 * `{{name}}` references (docs/api-execution.md §3). The resolver and the editors' highlighting
 * share this parser so they never disagree about what a variable is.
 */

export interface VariableToken {
  /** Offsets of `{{` and just after `}}`. */
  start: number;
  end: number;
  /** The name with surrounding whitespace trimmed (`{{ a }}` → `a`). */
  name: string;
}

const REFERENCE = /\{\{([^{}]*)\}\}/g;

export function findVariables(text: string): VariableToken[] {
  const tokens: VariableToken[] = [];
  for (const match of text.matchAll(REFERENCE)) {
    const name = match[1]!.trim();
    if (name === '') continue;
    tokens.push({ start: match.index!, end: match.index! + match[0].length, name });
  }
  return tokens;
}

/** True when `text` is exactly one `{{var}}` (form-data file sources are resolved only then). */
export function isSingleVariable(text: string): boolean {
  const tokens = findVariables(text);
  return tokens.length === 1 && tokens[0]!.start === 0 && tokens[0]!.end === text.length;
}

export function isDynamicName(name: string): boolean {
  return name.startsWith('$');
}
