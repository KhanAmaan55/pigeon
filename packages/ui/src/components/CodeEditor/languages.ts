/**
 * Language support for `CodeEditor`, loaded on first use so the language packages stay out of
 * the initial bundle (Vite splits each dynamic import into its own chunk).
 */

import type { Extension } from '@codemirror/state';

export const CODE_LANGUAGES = ['json', 'xml', 'html', 'javascript', 'graphql', 'text'] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** The extensions for `language`; `lint` adds JSON syntax diagnostics (inline + gutter). */
export async function loadLanguage(language: CodeLanguage, lint: boolean): Promise<Extension> {
  switch (language) {
    case 'json': {
      const { json, jsonParseLinter } = await import('@codemirror/lang-json');
      if (!lint) return json();
      const { linter, lintGutter } = await import('@codemirror/lint');
      return [json(), linter(jsonParseLinter(), { delay: 300 }), lintGutter()];
    }
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml();
    case 'html':
      return (await import('@codemirror/lang-html')).html();
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript();
    case 'graphql': {
      const [{ StreamLanguage }, { graphqlParser }] = await Promise.all([
        import('@codemirror/language'),
        import('./graphql-language'),
      ]);
      return StreamLanguage.define(graphqlParser);
    }
    case 'text':
      return [];
  }
}
