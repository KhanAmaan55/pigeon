import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PIGEON_VERSION } from '../src/index';

const root = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('one version everywhere (PIGN-041)', () => {
  const version = (JSON.parse(read('package.json')) as { version: string }).version;

  it('the root package.json version reaches core, the crate and the Tauri config', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    expect(PIGEON_VERSION).toBe(version);
    expect(read('apps/desktop/src-tauri/Cargo.toml')).toMatch(
      new RegExp(`\\[package\\][^[]*\\nversion = "${version.replaceAll('.', '\\.')}"`),
    );
    const tauri = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as { version: string };
    expect(tauri.version).toBe('../../../package.json');
    for (const app of ['apps/web', 'apps/desktop']) {
      expect((JSON.parse(read(`${app}/package.json`)) as { version: string }).version).toBe(
        version,
      );
    }
  });
});
