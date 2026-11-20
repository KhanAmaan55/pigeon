/** `{{variable}}` marks in CodeMirror, using the same parser and states as `VariableInput`. */

import type { Extension } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, EditorView, MatchDecorator, ViewPlugin } from '@codemirror/view';
import type { VariableScopes } from '@pigeon/core';
import { describeVariable } from '@pigeon/core';

import { variablesTooltip } from '../VariableInput/describe';

export function variableHighlighting(scopes: VariableScopes): Extension {
  const decorator = new MatchDecorator({
    regexp: /\{\{([^{}]*)\}\}/g,
    decoration: (match) => {
      const name = match[1]!.trim();
      const state = name === '' ? 'unresolved' : describeVariable(name, scopes).state;
      return Decoration.mark({
        class: `cm-pg-variable cm-pg-variable-${state}`,
        attributes: {
          title: variablesTooltip(match[0], scopes) ?? '',
          'data-variable-state': state,
        },
      });
    },
  });
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorator.createDeco(view);
        }
        update(update: ViewUpdate) {
          this.decorations = decorator.updateDeco(update, this.decorations);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.baseTheme({
      '.cm-pg-variable': { borderRadius: '2px' },
      '.cm-pg-variable-resolved': {
        backgroundColor: 'color-mix(in srgb, var(--pg-pass) 20%, transparent)',
      },
      '.cm-pg-variable-unresolved': {
        backgroundColor: 'color-mix(in srgb, var(--pg-fail) 25%, transparent)',
      },
      '.cm-pg-variable-dynamic': {
        backgroundColor: 'color-mix(in srgb, var(--pg-method-patch) 20%, transparent)',
      },
    }),
  ];
}
