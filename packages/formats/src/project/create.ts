import { INSTRUCTIONS_FILE, projectInstructions } from './instructions';
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

/**
 * Creates an unsaved, empty format-v1 project and all files written at creation time, including
 * `.gitattributes` and `INSTRUCTIONS.md` (both the user's afterwards).
 */
export function createEmptyProject(name: string): EmptyProject {
  const model: ProjectModel = {
    id: crypto.randomUUID(),
    name,
    formatVersion: 1,
    collections: [],
    orphanExamples: [],
    environments: [],
    extra: {},
  };
  const files = serializeProject(model);
  files.set('.gitattributes', encoder.encode(GIT_ATTRIBUTES));
  files.set(INSTRUCTIONS_FILE, encoder.encode(projectInstructions(name)));
  return { model, files };
}
