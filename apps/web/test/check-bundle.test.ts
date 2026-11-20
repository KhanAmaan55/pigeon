import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkBundle } from '../scripts/check-bundle';

let dist: string;
afterEach(() => rmSync(dist, { recursive: true, force: true }));

function bundle(files: Record<string, string>): string {
  dist = mkdtempSync(join(tmpdir(), 'pigeon-bundle-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(
    join(dist, 'index.html'),
    '<script type="module" crossorigin src="./assets/index.js"></script>' +
      '<link rel="modulepreload" crossorigin href="./assets/vendor.js">',
  );
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dist, name), text);
  return dist;
}

describe('check-bundle (PIGN-039)', () => {
  it('passes a clean bundle and measures the initial JavaScript', () => {
    const report = checkBundle(
      bundle({ 'assets/index.js': 'console.log(1)', 'assets/vendor.js': 'export const a = 1' }),
    );
    expect(report.errors).toEqual([]);
    expect(report.initialFiles).toEqual(['assets/index.js', 'assets/vendor.js']);
    expect(report.initialJsGzipBytes).toBeGreaterThan(0);
  });

  it('fails on Tauri or Node code in any chunk', () => {
    const report = checkBundle(
      bundle({
        'assets/index.js': 'import { invoke } from "@tauri-apps/api/core";',
        'assets/vendor.js': 'window.__TAURI_INTERNALS__',
        'assets/lazy.js': 'const fs = await import("node:fs/promises")',
      }),
    );
    expect(report.errors).toEqual([
      'assets/index.js: @tauri-apps import ("@tauri-apps/api/core")',
      'assets/lazy.js: node: import (import("node:fs/promises")',
      'assets/vendor.js: Tauri global (__TAURI_INTERNALS__)',
    ]);
  });

  it('fails when the initial JavaScript is over the budget', () => {
    const report = checkBundle(bundle({ 'assets/index.js': 'x', 'assets/vendor.js': 'y' }), 10);
    expect(report.errors).toEqual([expect.stringMatching(/over the 0\.0 KB budget/)]);
  });
});
