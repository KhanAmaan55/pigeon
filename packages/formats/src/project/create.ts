import { serializeProject } from './writer';
import type { EmptyProject, ProjectModel } from './types';

const encoder = new TextEncoder();

const GIT_ATTRIBUTES = [
  'pigeon.json text eol=lf',
  'collections/** text eol=lf',
  'environments/** text eol=lf',
  'examples/** text eol=lf',
  'examples/**/*.body.bin binary',
  '',
].join('\n');

/** Creates an unsaved, empty format-v1 project and all files required at creation time. */
export function createEmptyProject(name: string): EmptyProject {
  const model: ProjectModel = {
    id: crypto.randomUUID(),
    name,
    formatVersion: 1,
    collections: [],
    environments: [],
    extra: {},
  };
  const files = serializeProject(model);
  files.set('.gitattributes', encoder.encode(GIT_ATTRIBUTES));
  return { model, files };
}
