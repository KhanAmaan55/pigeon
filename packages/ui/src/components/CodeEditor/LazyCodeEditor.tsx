import { lazy, Suspense } from 'react';

import type { CodeEditorProps } from './CodeEditor';

const Editor = lazy(async () => ({ default: (await import('./CodeEditor')).CodeEditor }));

/**
 * `CodeEditor`, loaded on first render: CodeMirror (~100 kB gzipped) stays out of the initial
 * bundle until a raw body (or another code view) is shown.
 */
export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div
          aria-busy
          data-testid="code-editor-loading"
          className={`min-h-0 rounded border border-border bg-bg ${props.className ?? ''}`}
        />
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
