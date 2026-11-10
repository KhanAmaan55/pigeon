import { EditorView } from '@codemirror/view';
import { act, screen } from '@testing-library/react';

/** The request body editor, once its lazily loaded code has arrived. */
export function bodyInput(): Promise<HTMLElement> {
  return screen.findByTestId('body-input');
}

/** The CodeMirror view behind a `CodeEditor`'s editable element (its `testId`). */
export function editorView(content: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error('not a CodeMirror editor');
  return view;
}

/**
 * Replaces the editor's text as typing would (one transaction through the update listener).
 * jsdom has no layout, so CodeMirror's own input handling is exercised in Playwright instead.
 */
export function setEditorText(content: HTMLElement, text: string): void {
  const view = editorView(content);
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
}

export function editorText(content: HTMLElement): string {
  return editorView(content).state.doc.toString();
}
