import { MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import { createEmptyProject } from '../src/project/create';
import { INSTRUCTIONS_FILE, projectInstructions } from '../src/project/instructions';
import { isProjectFile } from '../src/project/managed';
import { readProject } from '../src/project/reader';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** `File \`path\`:` followed by a json code block, as the guide writes its example files. */
function exampleFiles(markdown: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const match of markdown.matchAll(/File `([^`]+)`:\n\n```json\n([\s\S]*?)\n```/g)) {
    files.set(match[1]!, `${match[2]!}\n`);
  }
  return files;
}

describe('INSTRUCTIONS.md (PIGN-060)', () => {
  it('is written with a new project, titled with its name, and travels with it', () => {
    const { files } = createEmptyProject('Users API');
    const text = decoder.decode(files.get(INSTRUCTIONS_FILE));
    expect(text.startsWith('# Users API — Pigeon project\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(isProjectFile(INSTRUCTIONS_FILE)).toBe(true);
    expect(projectInstructions('  ')).toMatch(/^# Untitled project — Pigeon project/);
  });

  it('shows example files that Pigeon reads without problems', async () => {
    const guide = projectInstructions('Users API');
    const examples = exampleFiles(guide);
    expect([...examples.keys()].sort()).toEqual([
      'collections/example-api/admin/folder.json',
      'collections/example-api/collection.json',
      'collections/example-api/list-users.request.json',
      'environments/local.postman_environment.json',
      'examples/example-api/list-users/200-ok.example.json',
    ]);

    const fs = new MemoryFs();
    for (const [path, bytes] of createEmptyProject('Users API').files) {
      await fs.writeFileAtomic(path, bytes);
    }
    for (const [path, text] of examples) {
      JSON.parse(text);
      await fs.writeFileAtomic(path, encoder.encode(text));
    }
    // The example's body file, as the guide describes it.
    await fs.writeFileAtomic(
      'examples/example-api/list-users/200-ok.body.json',
      encoder.encode('{\n  "users": []\n}\n'),
    );

    const { model, problems } = await readProject(fs);
    expect(problems).toEqual([]);
    const collection = model.collections[0]!;
    expect(collection.name).toBe('Example API');
    expect(collection.children.map((child) => child.name)).toEqual(['List users', 'Admin']);
    const request = collection.children[0]!;
    expect(request.kind).toBe('request');
    if (request.kind !== 'request') return;
    expect(request.url.raw).toBe('{{baseUrl}}/users?limit=20');
    expect(request.examples.map((example) => example.name)).toEqual(['200 OK']);
    expect(model.environments.map((environment) => environment.name)).toEqual(['Local']);
  });
});
