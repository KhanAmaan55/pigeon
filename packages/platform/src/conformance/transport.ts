import { describe, it } from 'vitest';

import type { Capabilities } from '../capabilities';
import type { Transport } from '../transport';
import { transportConformanceCases } from './transport-cases';

export interface TransportConformanceOptions {
  /** `@pigeon/test-server` base URL; a function when the server starts in `beforeAll`. */
  baseUrl: string | (() => string);
  /** Case id → story that will make it pass. These run as expected failures (`it.fails`). */
  expectedFailures?: Readonly<Record<string, string>>;
}

/**
 * Registers the shared transport cases (./transport-cases.ts) as Vitest tests:
 * `transportConformance('MockTransport', () => transport, caps, { baseUrl })`.
 */
export function transportConformance(
  name: string,
  createTransport: () => Transport,
  caps: Readonly<Capabilities>,
  opts: TransportConformanceOptions,
): void {
  const baseUrl = () => (typeof opts.baseUrl === 'function' ? opts.baseUrl() : opts.baseUrl);

  describe(`Transport conformance: ${name}`, () => {
    for (const testCase of transportConformanceCases(caps)) {
      const run = () => testCase.run({ transport: createTransport(), baseUrl: baseUrl() });
      const story = opts.expectedFailures?.[testCase.id];
      if (testCase.skip !== undefined) {
        it.skip(`${testCase.title} (${testCase.skip})`, run);
      } else if (story !== undefined) {
        it.fails(`${testCase.title} (until ${story})`, run);
      } else {
        it(testCase.title, run, 10_000);
      }
    }
  });
}
