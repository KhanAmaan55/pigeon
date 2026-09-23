// @ts-check
import { builtinModules } from 'node:module';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Package dependency rules — see docs/architecture.md §2 ("Allowed dependencies").
 * Each entry lists the internal packages a package may import and which external
 * platform families are forbidden.
 */
const packages = {
  platform: { pigeon: [], pure: true },
  formats: { pigeon: ['platform'], pure: true },
  compare: { pigeon: [], pure: true },
  core: { pigeon: ['platform', 'formats', 'compare'], pure: true },
  fixtures: { pigeon: [], pure: true },
  'platform-web': { pigeon: ['platform'], forbid: ['react', 'tauri', 'node'] },
  'platform-desktop': { pigeon: ['platform'], forbid: ['react', 'node'] },
  ui: { pigeon: ['core', 'formats', 'compare', 'platform'], forbid: ['tauri', 'node'] },
};

const forbiddenGroups = {
  react: {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'React belongs in @pigeon/ui only.',
  },
  tauri: {
    group: ['@tauri-apps/*'],
    message: 'Tauri APIs belong in @pigeon/platform-desktop (or apps/desktop) only.',
  },
  node: {
    group: ['node:*', ...builtinModules],
    message:
      'Node built-ins are not available in browsers or the Tauri webview; use a platform adapter.',
  },
};

/**
 * @param {string} name
 * @param {{ pigeon: string[], pure?: boolean, forbid?: string[] }} rule
 * @returns {import('eslint').Linter.Config[]}
 */
function restrictedImportsFor(name, rule) {
  const forbid = rule.pure ? ['react', 'tauri', 'node'] : (rule.forbid ?? []);
  const allowed = rule.pigeon.map((dep) => `!@pigeon/${dep}`);
  const pigeonGroup = {
    group: ['@pigeon/*', ...allowed],
    message: `@pigeon/${name} may only import: ${
      rule.pigeon.length
        ? rule.pigeon.map((d) => `@pigeon/${d}`).join(', ')
        : 'no internal packages'
    } (docs/architecture.md §2).`,
  };
  /** @param {string[]} keys */
  const patterns = (keys) => [
    ...keys.map((key) => forbiddenGroups[/** @type {keyof typeof forbiddenGroups} */ (key)]),
    pigeonGroup,
  ];
  return [
    {
      files: [`packages/${name}/**/*.{ts,tsx,js,mjs}`],
      rules: { 'no-restricted-imports': ['error', { patterns: patterns(forbid) }] },
    },
    {
      // Tests run in Node under Vitest: Node built-ins are fine there, package boundaries still apply.
      files: [`packages/${name}/test/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: patterns(forbid.filter((key) => key !== 'node')) },
        ],
      },
    },
  ];
}

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Ambient declaration files declare globals with `var`, like TypeScript's own lib files.
    files: ['**/*.d.ts'],
    rules: { 'no-var': 'off' },
  },
  ...Object.entries(packages).flatMap(([name, rule]) => restrictedImportsFor(name, rule)),
  prettier,
);
