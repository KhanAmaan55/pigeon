// @ts-check
import { builtinModules } from 'node:module';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Workspace dependency rules — see docs/architecture.md §2 ("Allowed dependencies").
 * Keyed by workspace directory; each entry lists the internal packages it may import and
 * which external platform families are forbidden in its sources.
 */
const workspaces = {
  'packages/platform': { pigeon: [], pure: true },
  'packages/formats': { pigeon: ['platform'], pure: true },
  'packages/compare': { pigeon: [], pure: true },
  'packages/core': { pigeon: ['platform', 'formats', 'compare'], pure: true },
  'packages/fixtures': { pigeon: [], pure: true },
  'packages/platform-web': { pigeon: ['platform'], forbid: ['react', 'tauri', 'node'] },
  'packages/platform-desktop': { pigeon: ['platform'], forbid: ['react', 'node'] },
  'packages/ui': { pigeon: ['core', 'formats', 'compare', 'platform'], forbid: ['tauri', 'node'] },
  'apps/web': { pigeon: ['ui', 'platform', 'platform-web'], forbid: ['tauri', 'node'] },
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
 * @param {string} dir workspace directory, e.g. `packages/core`
 * @param {{ pigeon: string[], pure?: boolean, forbid?: string[] }} rule
 * @returns {import('eslint').Linter.Config[]}
 */
function restrictedImportsFor(dir, rule) {
  const forbid = rule.pure ? ['react', 'tauri', 'node'] : (rule.forbid ?? []);
  const allowed = rule.pigeon.map((dep) => `!@pigeon/${dep}`);
  const pigeonGroup = {
    group: ['@pigeon/*', ...allowed],
    message: `${dir} may only import: ${
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
      files: [`${dir}/src/**/*.{ts,tsx}`, `${dir}/test/**/*.{ts,tsx}`],
      rules: { 'no-restricted-imports': ['error', { patterns: patterns(forbid) }] },
    },
    {
      // Tests run in Node under Vitest: Node built-ins are fine there, package boundaries still apply.
      files: [`${dir}/test/**/*.{ts,tsx}`],
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
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'docs/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
    ],
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
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/web/src/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  ...Object.entries(workspaces).flatMap(([dir, rule]) => restrictedImportsFor(dir, rule)),
  prettier,
);
