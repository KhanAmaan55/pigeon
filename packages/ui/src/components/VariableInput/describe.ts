import type { VariableScopes } from '@pigeon/core';
import { describeVariable, findVariables } from '@pigeon/core';

export type VariableState = 'resolved' | 'unresolved' | 'dynamic';

/** One line per `{{var}}` in `text`, for the input's tooltip; secrets masked. */
export function variablesTooltip(text: string, scopes: VariableScopes): string | undefined {
  const lines = new Map<string, string>();
  for (const token of findVariables(text)) {
    if (lines.has(token.name)) continue;
    const info = describeVariable(token.name, scopes);
    lines.set(
      token.name,
      info.state === 'dynamic'
        ? `${token.name}: dynamic (new value on every send)`
        : info.state === 'unresolved'
          ? `${token.name}: not defined${info.scopeName ? ` (cycle in ${info.scopeName})` : ' in the selected environment'}`
          : `${token.name} = ${info.secret ? '••••' : info.value} (${info.scopeName})`,
    );
  }
  return lines.size === 0 ? undefined : [...lines.values()].join('\n');
}

/** Text split into plain runs and `{{var}}` runs with their state. */
export function variableSegments(
  text: string,
  scopes: VariableScopes,
): Array<{ text: string; state?: VariableState }> {
  const segments: Array<{ text: string; state?: VariableState }> = [];
  let at = 0;
  for (const token of findVariables(text)) {
    if (token.start > at) segments.push({ text: text.slice(at, token.start) });
    segments.push({
      text: text.slice(token.start, token.end),
      state: describeVariable(token.name, scopes).state,
    });
    at = token.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}

/** The `{{prefix` being typed just before `caret`, if any. */
export function completionPrefix(
  text: string,
  caret: number,
): { start: number; prefix: string } | undefined {
  const before = text.slice(0, caret);
  const match = /\{\{([^{}\s]*)$/.exec(before);
  return match ? { start: match.index, prefix: match[1]! } : undefined;
}
