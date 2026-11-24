import type { Page } from '@playwright/test';

/**
 * Runner speed for the performance budgets (PIGN-042). The budgets in ui-ux.md §7 are for the
 * development MacBook; a slower machine (a shared CI runner) runs a fixed workload first, and the
 * budgets are scaled by how much longer it took. The workload is what opening a project spends
 * its time on, without any Pigeon code: reading many small files through a folder handle
 * (in parallel, as the project reader does) and parsing JSON, timed apart and weighted by their
 * share of the open. A regression in Pigeon still shows, because the workload doesn't change
 * with it. Checked with Chromium CPU throttling ×3: the open went 1.36 → 2.03 s and the factor
 * to 1.76, so the limit (4.2 s) still holds the same margin; file reads aren't throttled there.
 */

/** Median workload times on the development MacBook (Chromium), 2026-11-24. */
export const REFERENCE = { ioMs: 148, cpuMs: 110 };

/**
 * How much of opening the 5,000-request project is waiting on file reads rather than running
 * script (Chromium profile on the development MacBook: about two thirds).
 */
const IO_SHARE = 0.65;

/** A runner more than this much slower than the reference fails rather than scaling further. */
export const MAX_SPEED_FACTOR = 3;

const FILES = 2_000;
const RUNS = 5;

/** Milliseconds for one run of the workload in `page` (same origin as the app). */
async function workload(page: Page, run: number): Promise<{ ioMs: number; cpuMs: number }> {
  return page.evaluate(
    async ({ files, run }) => {
      const root = await navigator.storage.getDirectory();
      const name = `perf-calibration-${run}`;
      await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      const dir = await root.getDirectoryHandle(name, { create: true });
      const body = (i: number) =>
        JSON.stringify({
          info: {
            name: `Request ${i}`,
            id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          },
          request: {
            method: 'GET',
            url: { raw: `{{baseUrl}}/resources/${i}?page=1`, path: ['resources', String(i)] },
            header: Array.from({ length: 4 }, (_, h) => ({ key: `X-Header-${h}`, value: 'v' })),
          },
        });
      // Setup, not timed: the files to read.
      for (let i = 0; i < files; i += 50) {
        await Promise.all(
          Array.from({ length: Math.min(50, files - i) }, async (_, j) => {
            const file = await dir.getFileHandle(`r${i + j}.json`, { create: true });
            const writable = await file.createWritable();
            await writable.write(body(i + j));
            await writable.close();
          }),
        );
      }

      const started = performance.now();
      const names: string[] = [];
      for await (const key of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
        names.push(key);
      }
      const texts = new Array<string>(names.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: 32 }, async () => {
          while (next < names.length) {
            const index = next++;
            texts[index] = await (
              await dir.getFileHandle(names[index]!)
            )
              .getFile()
              .then((f) => f.text());
          }
        }),
      );
      const read = performance.now();
      let checksum = 0;
      for (let round = 0; round < 60; round++) {
        for (const text of texts) {
          const parsed = JSON.parse(text) as { info: { name: string } };
          checksum += JSON.stringify(parsed).length + parsed.info.name.length;
        }
      }
      const parsed = performance.now();
      await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      if (checksum === 0) throw new Error('calibration read nothing');
      return { ioMs: read - started, cpuMs: parsed - read };
    },
    { files: FILES, run },
  );
}

export interface RunnerSpeed {
  /** Median times of the two parts of the workload on this runner. */
  ioMs: number;
  cpuMs: number;
  /** Budgets are multiplied by this: at least 1, at most `MAX_SPEED_FACTOR`. */
  factor: number;
}

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** Times the workload (median of five runs) against the reference. `page` must be on the app. */
export async function measureRunnerSpeed(page: Page): Promise<RunnerSpeed> {
  const runs: Array<{ ioMs: number; cpuMs: number }> = [];
  for (let run = 0; run < RUNS; run++) runs.push(await workload(page, run));
  const ioMs = median(runs.map((r) => r.ioMs));
  const cpuMs = median(runs.map((r) => r.cpuMs));
  const slower = IO_SHARE * (ioMs / REFERENCE.ioMs) + (1 - IO_SHARE) * (cpuMs / REFERENCE.cpuMs);
  return { ioMs, cpuMs, factor: Math.min(MAX_SPEED_FACTOR, Math.max(1, slower)) };
}
