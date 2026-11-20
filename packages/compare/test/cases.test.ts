import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CompareOptions, Finding } from '../src/index';
import { compareJson, inferSchema } from '../src/index';

interface Case {
  name: string;
  baseline: unknown;
  actual: unknown;
  options?: CompareOptions;
  /** Each expected finding lists the fields to check (in order). */
  expected: Array<Partial<Finding>>;
}

const directory = join(import.meta.dirname, 'cases');

for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
  const cases = JSON.parse(readFileSync(join(directory, file), 'utf8')) as Case[];
  describe(`cases/${file}`, () => {
    it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
      const findings = compareJson(inferSchema(c.baseline, c.options), c.actual, c.options);
      expect(findings).toHaveLength(c.expected.length);
      c.expected.forEach((expected, index) => expect(findings[index]).toMatchObject(expected));
    });
  });
}
