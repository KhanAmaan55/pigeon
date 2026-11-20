/**
 * A small GraphQL syntax mode (PIGN-032): keywords, names, `$variables`, strings (and block
 * strings), numbers, directives and comments. No parser: schema-aware support is PIGN-055.
 */

import type { StreamParser } from '@codemirror/language';

const KEYWORDS = new Set([
  'query',
  'mutation',
  'subscription',
  'fragment',
  'on',
  'type',
  'input',
  'enum',
  'interface',
  'union',
  'scalar',
  'schema',
  'directive',
  'extend',
  'implements',
  'repeatable',
]);
const ATOMS = new Set(['true', 'false', 'null']);

interface State {
  inBlockString: boolean;
}

export const graphqlParser: StreamParser<State> = {
  name: 'graphql',
  startState: () => ({ inBlockString: false }),
  token(stream, state) {
    if (state.inBlockString) {
      if (stream.skipTo('"""')) {
        stream.match('"""');
        state.inBlockString = false;
      } else {
        stream.skipToEnd();
      }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('"""')) {
      state.inBlockString = true;
      return 'string';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\$[_A-Za-z][_0-9A-Za-z]*/)) return 'variableName';
    if (stream.match(/^@[_A-Za-z][_0-9A-Za-z]*/)) return 'meta';
    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';
    const word = stream.match(/^[_A-Za-z][_0-9A-Za-z]*/);
    if (word) {
      const text = (word as RegExpMatchArray)[0];
      if (KEYWORDS.has(text)) return 'keyword';
      if (ATOMS.has(text)) return 'atom';
      return 'propertyName';
    }
    if (stream.match(/^[{}()[\]:!=|&]|^\.\.\./)) return 'punctuation';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
};
