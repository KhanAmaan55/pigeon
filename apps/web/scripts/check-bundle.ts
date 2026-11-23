/**
 * Checks a built web bundle (PIGN-039, apps/web/README.md): no desktop (Tauri) or Node code
 * leaked into it, and the JavaScript the first page load needs stays within the budget.
 *
 *   node scripts/check-bundle.ts [dist]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Initial JavaScript (entry + modulepreloads), gzip. docs/platform.md §6.1. */
export const INITIAL_JS_BUDGET_BYTES = 500 * 1024;

/** Imports and globals that must never reach the web bundle. */
const LEAKS: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /["'`]@tauri-apps\/[^"'`]*["'`]/, what: '@tauri-apps import' },
  { pattern: /__TAURI(?:_INTERNALS)?__/, what: 'Tauri global' },
  {
    pattern: /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']node:[\w/]+["']/,
    what: 'node: import',
  },
];

/** Libraries that must only arrive in lazily loaded chunks (never in the initial JavaScript). */
const LAZY_ONLY: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  // graphql-js's schema assertion message (PIGN-055: the GraphQL editor loads it on first use).
  { pattern: /to be a GraphQL schema/, what: 'the graphql package' },
];

export interface BundleReport {
  errors: string[];
  initialJsGzipBytes: number;
  initialFiles: string[];
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

/** Scripts and modulepreloads `index.html` loads, as paths relative to `dist`. */
function initialScripts(html: string): string[] {
  const refs = [
    ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g),
    ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g),
  ].map((match) => match[1]!);
  return [...new Set(refs)]
    .filter((ref) => !/^[a-z]+:/i.test(ref))
    .map((ref) => ref.replace(/^\.?\//, '').replace(/^.*?(assets\/)/, '$1'));
}

export function checkBundle(dist: string, budget = INITIAL_JS_BUDGET_BYTES): BundleReport {
  const errors: string[] = [];
  for (const file of files(dist).filter((f) => /\.(m?js|html)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    for (const leak of LEAKS) {
      const match = leak.pattern.exec(text);
      if (match) errors.push(`${relative(dist, file)}: ${leak.what} (${match[0]})`);
    }
  }
  const initialFiles = initialScripts(readFileSync(join(dist, 'index.html'), 'utf8'));
  let initialJsGzipBytes = 0;
  for (const file of initialFiles) {
    const bytes = readFileSync(join(dist, file));
    initialJsGzipBytes += gzipSync(bytes).byteLength;
    const text = bytes.toString('utf8');
    for (const lazy of LAZY_ONLY) {
      if (lazy.pattern.test(text)) errors.push(`${file}: ${lazy.what} is in the initial bundle`);
    }
  }
  if (initialJsGzipBytes > budget) {
    errors.push(
      `initial JavaScript is ${kb(initialJsGzipBytes)} gzip, over the ${kb(budget)} budget`,
    );
  }
  return { errors: errors.sort(), initialJsGzipBytes, initialFiles };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const dist = process.argv[2] ?? 'dist';
  const report = checkBundle(dist);
  console.log(
    `check-bundle: initial JS ${kb(report.initialJsGzipBytes)} gzip (budget ${kb(INITIAL_JS_BUDGET_BYTES)}), ${report.initialFiles.length} files`,
  );
  if (report.errors.length > 0) {
    for (const error of report.errors) console.error(`check-bundle: ${error}`);
    process.exit(1);
  }
}
