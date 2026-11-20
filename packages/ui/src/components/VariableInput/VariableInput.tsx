import { visibleVariables } from '@pigeon/core';
import type { ChangeEvent, InputHTMLAttributes, KeyboardEvent } from 'react';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';

import type { VariableState } from './describe';
import { completionPrefix, variableSegments, variablesTooltip } from './describe';
import { useVariableScopes } from './VariablesContext';

const STATE_CLASSES: Record<VariableState, string> = {
  resolved: 'bg-pass/20',
  unresolved: 'bg-fail/25',
  dynamic: 'bg-method-patch/20',
};

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

/**
 * A single-line input that highlights `{{variables}}` (docs/ui-ux.md §3.3): resolved green,
 * unresolved red, dynamic purple, with a tooltip listing their values and `{{` autocomplete.
 * The highlights are drawn behind the (transparent-background) input, aligned by sharing its
 * font and padding and following its horizontal scroll.
 */
export const VariableInput = forwardRef<HTMLInputElement, Props>(function VariableInput(
  { value, onChange, className = '', onKeyDown, onScroll, title, ...rest },
  ref,
) {
  const scopes = useVariableScopes();
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => inputRef.current!, []);
  const [completion, setCompletion] = useState<{
    start: number;
    prefix: string;
    index: number;
  } | null>(null);

  const segments = useMemo(() => variableSegments(value, scopes), [value, scopes]);
  const hasVariables = segments.some((segment) => segment.state);
  const suggestions = useMemo(
    () =>
      completion
        ? visibleVariables(scopes)
            .filter((variable) =>
              variable.name.toLowerCase().startsWith(completion.prefix.toLowerCase()),
            )
            .slice(0, 8)
        : [],
    [completion, scopes],
  );

  const syncScroll = () => {
    if (backdropRef.current && inputRef.current)
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
  };
  const updateCompletion = (text: string, caret: number | null) => {
    const found = caret === null ? undefined : completionPrefix(text, caret);
    setCompletion(found ? { ...found, index: 0 } : null);
  };
  const accept = (name: string) => {
    const input = inputRef.current;
    if (!input || !completion) return;
    const caret = input.selectionStart ?? value.length;
    const after = value.slice(caret).replace(/^[^{}\s]*\}\}/, '');
    const next = `${value.slice(0, completion.start)}{{${name}}}${after}`;
    // Through the native setter + input event, so React's onChange sees it like typing.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const position = completion.start + name.length + 4;
    input.setSelectionRange(position, position);
    setCompletion(null);
  };

  return (
    <div className="relative min-w-0 flex-1">
      {hasVariables && (
        <div
          ref={backdropRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 flex items-center overflow-hidden border-transparent whitespace-pre text-transparent ${className}`}
        >
          {segments.map((segment, index) =>
            segment.state ? (
              <span
                key={index}
                data-variable-state={segment.state}
                className={`rounded-sm ${STATE_CLASSES[segment.state]}`}
              >
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </div>
      )}
      <input
        {...rest}
        ref={inputRef}
        value={value}
        title={title ?? variablesTooltip(value, scopes)}
        data-has-variables={hasVariables || undefined}
        onChange={(event) => {
          onChange(event);
          updateCompletion(event.target.value, event.target.selectionStart);
          syncScroll();
        }}
        onScroll={(event) => {
          syncScroll();
          onScroll?.(event);
        }}
        onBlur={() => setCompletion(null)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (completion && suggestions.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              setCompletion({
                ...completion,
                index: (completion.index + delta + suggestions.length) % suggestions.length,
              });
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              accept(suggestions[completion.index]!.name);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setCompletion(null);
              return;
            }
          }
          onKeyDown?.(event);
        }}
        className={`relative w-full bg-transparent ${className}`}
      />
      {completion && suggestions.length > 0 && (
        <ul
          role="listbox"
          data-testid="variable-suggestions"
          className="absolute top-full left-0 z-50 mt-1 max-h-60 min-w-56 overflow-y-auto rounded-md border border-border bg-surface-raised p-1 text-sm shadow-lg"
        >
          {suggestions.map((variable, index) => (
            <li
              key={variable.name}
              role="option"
              aria-selected={index === completion.index}
              data-testid="variable-suggestion"
              onMouseDown={(event) => {
                event.preventDefault();
                accept(variable.name);
              }}
              className={`flex cursor-default items-center gap-3 rounded px-2 py-1 ${index === completion.index ? 'bg-hover' : ''}`}
            >
              <span className="font-mono">{variable.name}</span>
              <span className="ml-auto max-w-40 truncate text-xs text-fg-muted">
                {variable.secret ? '••••' : variable.value} · {variable.scopeName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
