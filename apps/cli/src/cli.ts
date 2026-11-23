#!/usr/bin/env node
/**
 * `pigeon` (PIGN-054): `node dist/cli.js run <projectDir> …` or, inside this repository,
 * `pnpm --filter @pigeon/cli start -- run <projectDir> …`. See docs/cli.md.
 */

import { writeFile } from 'node:fs/promises';

import { main } from './main';

const color =
  process.env['NO_COLOR'] === undefined &&
  (process.env['FORCE_COLOR'] !== undefined || process.stdout.isTTY === true);

const code = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  cwd: process.cwd(),
  color,
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
});
process.exitCode = code;
