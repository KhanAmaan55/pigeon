import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

import type { CodeLanguage } from './languages';
import { loadLanguage } from './languages';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLanguage;
  /** Syntax diagnostics where the language has them (JSON). Never blocks anything. */
  lint?: boolean;
  readOnly?: boolean;
  /** Accessible name of the editable area. */
  ariaLabel: string;
  /** `data-testid` of the editable area (a contenteditable element). */
  testId?: string;
  placeholder?: string;
  className?: string;
}

/** Colours from the design tokens, so the editor follows the light/dark theme. */
const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    color: 'var(--pg-fg)',
    backgroundColor: 'var(--pg-bg)',
  },
  '&.cm-focused': { outline: '1px solid var(--pg-accent)' },
  '.cm-scroller': { fontFamily: 'var(--pg-font-mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--pg-fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--pg-fg)' },
  '.cm-gutters': {
    backgroundColor: 'var(--pg-surface)',
    color: 'var(--pg-fg-muted)',
    borderRight: '1px solid var(--pg-border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--pg-hover)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'color-mix(in srgb, var(--pg-accent) 25%, transparent)' },
  '.cm-placeholder': { color: 'var(--pg-fg-muted)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--pg-surface-raised)',
    color: 'var(--pg-fg)',
    border: '1px solid var(--pg-border)',
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--pg-method-put)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--pg-method-get)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--pg-method-patch)' },
  { tag: [tags.keyword, tags.operatorKeyword], color: 'var(--pg-method-options)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--pg-method-delete)' },
  { tag: tags.attributeName, color: 'var(--pg-method-post)' },
  { tag: [tags.comment, tags.meta], color: 'var(--pg-fg-muted)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--pg-fail)' },
]);

/** Cmd/Ctrl+Enter belongs to the request editor (Send), not to "insert blank line". */
const keys = [...defaultKeymap.filter((binding) => binding.key !== 'Mod-Enter'), ...historyKeymap];

/**
 * CodeMirror 6 editor (docs/ui-ux.md): line numbers, history, bracket matching, syntax colours
 * and optional lint. Language support is loaded lazily (./languages.ts). Controlled: `value`
 * changes from outside replace the document.
 */
export function CodeEditor({
  value,
  onChange,
  language = 'text',
  lint = false,
  readOnly = false,
  ariaLabel,
  testId,
  placeholder = '',
  className = '',
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const compartments = useRef({
    language: new Compartment(),
    readOnly: new Compartment(),
    attributes: new Compartment(),
  });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Created once; props below are applied through compartments and effects.
  useEffect(() => {
    const { language: languageSlot, readOnly: readOnlySlot, attributes } = compartments.current;
    const view = new EditorView({
      parent: hostRef.current ?? undefined,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          keymap.of(keys),
          theme,
          placeholderExtension(placeholder),
          languageSlot.of([]),
          readOnlySlot.of(EditorState.readOnly.of(readOnly)),
          attributes.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { attributes, readOnly: readOnlySlot } = compartments.current;
    view.dispatch({
      effects: [
        attributes.reconfigure(
          EditorView.contentAttributes.of({
            'aria-label': ariaLabel,
            ...(testId === undefined ? {} : { 'data-testid': testId }),
          }),
        ),
        readOnlySlot.reconfigure(EditorState.readOnly.of(readOnly)),
      ],
    });
  }, [ariaLabel, testId, readOnly]);

  useEffect(() => {
    let current = true;
    void loadLanguage(language, lint).then((extension) => {
      if (current) {
        viewRef.current?.dispatch({
          effects: compartments.current.language.reconfigure(extension),
        });
      }
    });
    return () => {
      current = false;
    };
  }, [language, lint]);

  return (
    <div
      ref={hostRef}
      data-language={language}
      className={`min-h-0 overflow-hidden rounded border border-border ${className}`}
    />
  );
}
