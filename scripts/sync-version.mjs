// Copies the root package.json version (the single source, PIGN-041) to every place that
// repeats it: workspace package.json files, the Rust crate and core's `PIGEON_VERSION`
// (User-Agent). Tauri reads the root package.json itself (tauri.conf.json `version`).
//
//   pnpm version:sync            after changing the root version
//   node scripts/sync-version.mjs --check   fails when something is out of date

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const check = process.argv.includes('--check');
const stale = [];

function update(path, replace) {
  const file = join(root, path);
  const before = readFileSync(file, 'utf8');
  const after = replace(before);
  if (after === before) return;
  stale.push(path);
  if (!check) writeFileSync(file, after);
}

for (const dir of ['apps', 'packages']) {
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}/package.json`;
    try {
      update(path, (text) => text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`));
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
}
update('apps/desktop/src-tauri/Cargo.toml', (text) =>
  text.replace(/(\[package\][^[]*?\nversion\s*=\s*")[^"]*(")/, `$1${version}$2`),
);
update('packages/core/src/version.ts', (text) =>
  text.replace(/(PIGEON_VERSION = ')[^']*(')/, `$1${version}$2`),
);

if (check && stale.length > 0) {
  console.error(
    `Version ${version} is not applied to: ${stale.join(', ')}. Run pnpm version:sync.`,
  );
  process.exit(1);
}
console.log(
  check ? `version ${version}: in sync` : `version ${version}: updated ${stale.length} files`,
);
