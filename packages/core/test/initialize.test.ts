import { MemoryFs } from '@pigeon/platform';
import { describe, expect, it } from 'vitest';

import { initializeProject } from '../src/index';

const decoder = new TextDecoder();

describe('initializeProject (PIGN-060)', () => {
  it('writes INSTRUCTIONS.md for the new project', async () => {
    const fs = new MemoryFs();
    await initializeProject(fs, 'Billing');
    const text = decoder.decode(await fs.readFile('INSTRUCTIONS.md'));
    expect(text.split('\n')[0]).toBe('# Billing — Pigeon project');
  });

  it("keeps the folder's own INSTRUCTIONS.md and .gitattributes", async () => {
    const fs = new MemoryFs();
    await fs.writeFileAtomic('INSTRUCTIONS.md', '# Our team notes\n');
    await fs.writeFileAtomic('.gitattributes', '* text=auto\n');
    await initializeProject(fs, 'Billing');
    expect(decoder.decode(await fs.readFile('INSTRUCTIONS.md'))).toBe('# Our team notes\n');
    expect(decoder.decode(await fs.readFile('.gitattributes'))).toBe('* text=auto\n');
    expect(await fs.exists('pigeon.json')).toBe(true);
  });
});
