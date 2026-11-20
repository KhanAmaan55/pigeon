/**
 * Project zip export/import (PIGN-015; docs/platform.md §6.3): how browser-workspace projects move
 * in and out of the browser. Only project files travel (managed paths and `.gitattributes`);
 * entries are validated so a zip can't write outside the project or into user files.
 */

import { isProjectFile } from '@pigeon/formats';
import type { ProjectFileSystem, ProjectPath } from '@pigeon/platform';
import { isProjectPath } from '@pigeon/platform';

/** Fixed entry time, so equal projects give equal zips. */
const ZIP_MTIME = new Date('1980-01-01T00:00:00Z');
const decoder = new TextDecoder();

/** Every project file of `fs`, sorted by path. */
export async function collectProjectFiles(
  fs: ProjectFileSystem,
): Promise<Map<ProjectPath, Uint8Array>> {
  const files = new Map<ProjectPath, Uint8Array>();
  for (const entry of await fs.list('', { recursive: true })) {
    if (entry.kind === 'file' && isProjectFile(entry.path))
      files.set(entry.path, await fs.readFile(entry.path));
  }
  return files;
}

export async function exportProjectZip(fs: ProjectFileSystem): Promise<Uint8Array> {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const [path, bytes] of await collectProjectFiles(fs))
    entries[path] = [bytes, { mtime: ZIP_MTIME }];
  // Loaded on first use: the web app's initial bundle doesn't need the zip library.
  const { zipSync } = await import('fflate');
  return zipSync(entries, { level: 6 });
}

export interface ProjectZipContents {
  files: Map<ProjectPath, Uint8Array>;
  /** Entries left out: not project files, or unsafe paths. */
  skipped: string[];
  /** `pigeon.json` `name`, when readable. */
  projectName: string | undefined;
}

/**
 * Reads a project zip. A single top-level folder holding `pigeon.json` (how most tools zip a
 * folder) is unwrapped. Throws when there is no `pigeon.json`.
 */
export async function readProjectZip(bytes: Uint8Array): Promise<ProjectZipContents> {
  const { unzipSync } = await import('fflate');
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes);
  } catch (error) {
    throw new Error('The file is not a valid zip archive.', { cause: error });
  }
  const names = Object.keys(raw).filter((name) => !name.endsWith('/'));
  const prefix = names.includes('pigeon.json')
    ? ''
    : (names.find((name) => /^[^/]+\/pigeon\.json$/.test(name))?.replace(/pigeon\.json$/, '') ??
      '');

  const files = new Map<ProjectPath, Uint8Array>();
  const skipped: string[] = [];
  for (const name of names) {
    const path = name.startsWith(prefix) ? name.slice(prefix.length) : name;
    if (!name.startsWith(prefix) || !isProjectPath(path) || path === '' || !isProjectFile(path)) {
      skipped.push(name);
      continue;
    }
    files.set(path, raw[name]!);
  }
  const manifest = files.get('pigeon.json');
  if (!manifest) throw new Error('The zip contains no pigeon.json, so it is not a Pigeon project.');
  let projectName: string | undefined;
  try {
    const parsed = JSON.parse(decoder.decode(manifest)) as { name?: unknown };
    projectName = typeof parsed.name === 'string' ? parsed.name : undefined;
  } catch {
    projectName = undefined;
  }
  return { files, skipped: skipped.sort(), projectName };
}

/** Writes the zip's project files into `fs` (an empty project). */
export async function importProjectZip(
  bytes: Uint8Array,
  fs: ProjectFileSystem,
): Promise<ProjectZipContents> {
  const contents = await readProjectZip(bytes);
  for (const [path, data] of contents.files) await fs.writeFileAtomic(path, data);
  return contents;
}
