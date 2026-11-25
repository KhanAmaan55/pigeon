import type { VariableScopes } from '@pigeon/core';

import { variableHighlighting } from './variables';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
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

import type { GraphQLSchema } from 'graphql';

import type { CodeLanguage } from './languages';
import { loadLanguage } from './languages';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLanguage;
  /** Syntax diagnostics where the language has them (JSON). Never blocks anything. */
  lint?: boolean;
  readOnly?: boolean;
  /** Fold markers in the gutter (Ctrl/Cmd+Alt+[ / ] too). */
  folding?: boolean;
  /** Find panel on Cmd/Ctrl+F, matches highlighted. */
  search?: boolean;
  /** Soft-wrap long lines (default on). */
  wrap?: boolean;
  /** Accessible name of the editable area. */
  ariaLabel: string;
  /** `data-testid` of the editable area (a contenteditable element). */
  testId?: string;
  placeholder?: string;
  className?: string;
  /** Highlight `{{variables}}` against these scopes (request bodies). */
  variables?: VariableScopes;
  /** Scrolls to (and selects the start of) a 0-based line; a new `nonce` repeats it. */
  revealLine?: { line: number; nonce: number };
  /** `language="graphql"` (PIGN-055): the schema for completion, diagnostics and hover. */
  graphqlSchema?: GraphQLSchema | null;
  /** Cmd/Ctrl+click on a field or type in a GraphQL query. */
  onShowInDocs?: (type: string) => void;
}

/**
 * Colours from the design tokens, so the editor follows the light/dark theme. The host `div`
 * shows focus (like a text field); the editor itself draws no outline.
 */
const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    color: 'var(--pg-fg)',
    backgroundColor: 'var(--pg-bg)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--pg-font-mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--pg-fg)', padding: '6px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--pg-fg)' },
  '.cm-gutters': {
    backgroundColor: 'var(--pg-bg)',
    // Full muted colour: line numbers are text and need 4.5:1 (PIGN-058).
    color: 'var(--pg-fg-muted)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 10px' },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--pg-hover) 50%, transparent)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--pg-fg)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'color-mix(in srgb, var(--pg-accent) 22%, transparent)' },
  '.cm-placeholder': { color: 'var(--pg-fg-muted)' },
  '.cm-panels': {
    backgroundColor: 'var(--pg-surface)',
    color: 'var(--pg-fg)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--pg-border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--pg-border)' },
  '.cm-panels input, .cm-panels button': { fontSize: '12px' },
  '.cm-panel.cm-search': { padding: '6px 8px' },
  '.cm-textfield': {
    backgroundColor: 'var(--pg-sunken)',
    color: 'var(--pg-fg)',
    border: '1px solid var(--pg-border)',
    borderRadius: '6px',
    padding: '2px 6px',
    outline: 'none',
  },
  '.cm-textfield:focus': {
    borderColor: 'var(--pg-accent)',
    boxShadow: '0 0 0 3px var(--pg-focus)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--pg-surface-raised)',
    color: 'var(--pg-fg)',
    border: '1px solid var(--pg-border)',
    borderRadius: '6px',
    padding: '2px 8px',
  },
  '.cm-button:hover': { backgroundColor: 'var(--pg-hover)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--pg-warn) 25%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--pg-warn) 50%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--pg-accent) 35%, transparent)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--pg-hover)',
    border: 'none',
    borderRadius: '4px',
    color: 'var(--pg-fg-muted)',
    padding: '0 4px',
  },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--pg-fg-muted)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--pg-surface-raised)',
    color: 'var(--pg-fg)',
    border: '1px solid var(--pg-border)',
    borderRadius: '8px',
    boxShadow: 'var(--pg-shadow-md)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--pg-font-mono)',
    padding: '4px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    borderRadius: '6px',
    padding: '2px 8px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--pg-selected)',
    color: 'var(--pg-fg)',
  },
  '.cm-completionDetail': { color: 'var(--pg-fg-muted)' },
  '.cm-completionInfo': { padding: '6px 10px' },
  '.cm-tooltip-hover, .cm-tooltip-lint': { padding: '2px 0' },
  '.cm-diagnostic': { padding: '4px 10px' },
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

/** The optional features, as one extension (reconfigured when the props change). */
function features(opts: { folding: boolean; search: boolean; wrap: boolean }): Extension {
  return [
    opts.wrap ? EditorView.lineWrapping : [],
    opts.folding ? [codeFolding(), foldGutter(), keymap.of(foldKeymap)] : [],
    opts.search
      ? [search({ top: true }), highlightSelectionMatches(), keymap.of(searchKeymap)]
      : [],
  ];
}

/**
 * CodeMirror 6 editor (docs/ui-ux.md): line numbers, history, bracket matching, syntax colours,
 * and optional lint, folding and search. Language support is loaded lazily (./languages.ts).
 * Controlled: `value` changes from outside replace the document.
 */
export function CodeEditor({
  value,
  onChange,
  language = 'text',
  lint = false,
  readOnly = false,
  folding = false,
  search: searchable = false,
  wrap = true,
  ariaLabel,
  testId,
  placeholder = '',
  className = '',
  variables,
  revealLine,
  graphqlSchema = null,
  onShowInDocs,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  // The text the editor holds, so re-renders don't stringify a large document to compare.
  const valueRef = useRef(value);
  const compartments = useRef({
    language: new Compartment(),
    readOnly: new Compartment(),
    attributes: new Compartment(),
    features: new Compartment(),
    variables: new Compartment(),
  });

  const onShowInDocsRef = useRef(onShowInDocs);

  useEffect(() => {
    onChangeRef.current = onChange;
    onShowInDocsRef.current = onShowInDocs;
  }, [onChange, onShowInDocs]);

  // Variable marks follow the scopes (environment switch, edited values).
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.variables.reconfigure(
        variables ? variableHighlighting(variables) : [],
      ),
    });
  }, [variables]);

  // Created once; props below are applied through compartments and effects.
  useEffect(() => {
    const {
      language: languageSlot,
      readOnly: readOnlySlot,
      attributes,
      features: featureSlot,
    } = compartments.current;
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
          featureSlot.of(features({ folding, search: searchable, wrap })),
          keymap.of(keys),
          theme,
          placeholderExtension(placeholder),
          languageSlot.of([]),
          readOnlySlot.of(EditorState.readOnly.of(readOnly)),
          attributes.of([]),
          compartments.current.variables.of(variables ? variableHighlighting(variables) : []),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || !onChangeRef.current) return;
            valueRef.current = update.state.doc.toString();
            onChangeRef.current(valueRef.current);
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
    if (!view || value === valueRef.current) return;
    valueRef.current = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.features.reconfigure(
        features({ folding, search: searchable, wrap }),
      ),
    });
  }, [folding, searchable, wrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { attributes, readOnly: readOnlySlot } = compartments.current;
    view.dispatch({
      effects: [
        attributes.reconfigure(
          EditorView.contentAttributes.of({
            // Explicitly focusable, so a scrolling read-only view (a response body) can be
            // reached and scrolled with the keyboard (axe scrollable-region-focusable).
            tabindex: '0',
            'aria-label': ariaLabel,
            ...(testId === undefined ? {} : { 'data-testid': testId }),
          }),
        ),
        readOnlySlot.reconfigure(EditorState.readOnly.of(readOnly)),
      ],
    });
  }, [ariaLabel, testId, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !revealLine) return;
    const line = view.state.doc.line(
      Math.min(Math.max(revealLine.line + 1, 1), view.state.doc.lines),
    );
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by nonce
  }, [revealLine?.nonce]);

  useEffect(() => {
    let current = true;
    void loadLanguage(language, lint, {
      graphqlSchema: language === 'graphql' ? graphqlSchema : null,
      onShowInDocs: (type) => onShowInDocsRef.current?.(type),
    }).then((extension) => {
      if (current) {
        viewRef.current?.dispatch({
          effects: compartments.current.language.reconfigure(extension),
        });
      }
    });
    return () => {
      current = false;
    };
  }, [language, lint, graphqlSchema]);

  return (
    <div
      ref={hostRef}
      data-language={language}
      className={`min-h-0 overflow-hidden rounded-lg border border-border bg-bg transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-focus ${className}`}
    />
  );
}
