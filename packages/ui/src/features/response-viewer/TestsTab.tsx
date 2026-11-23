/**
 * Test script results (PIGN-044): a badge for the status line ("Tests 4/5") and the Tests tab,
 * grouped by where the script lives (collection → folders → request).
 */

import type { TestRun } from '@pigeon/core';
import { testsOutcome } from '@pigeon/core';
import { CircleCheck, CircleX, OctagonAlert } from 'lucide-react';

const ICON = {
  pass: <CircleCheck size={12} className="text-pass" aria-hidden />,
  fail: <CircleX size={12} className="text-fail" aria-hidden />,
  error: <OctagonAlert size={12} className="text-fail" aria-hidden />,
} as const;

function total(run: TestRun): number {
  return run.counts.pass + run.counts.fail + run.counts.error;
}

export function TestsBadge({ run, onOpen }: { run: TestRun; onOpen: () => void }) {
  const outcome = testsOutcome(run.counts);
  return (
    <button
      type="button"
      data-testid="tests-badge"
      data-outcome={outcome}
      title="Test script results: open the Tests tab"
      onClick={onOpen}
      className={`inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-semibold hover:bg-hover ${
        outcome === 'pass' ? 'text-pass' : 'text-fail'
      }`}
    >
      {outcome === 'pass' ? ICON.pass : ICON.fail}
      Tests {run.counts.pass}/{total(run)}
    </button>
  );
}

export function TestsTab({ run }: { run: TestRun }) {
  const places = [...new Set(run.results.map((r) => r.place ?? ''))];
  return (
    <div data-testid="tests-tab" className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
      <p data-testid="tests-counts" className="mb-2 text-xs text-fg-muted">
        {run.counts.pass} passed · {run.counts.fail} failed · {run.counts.error} errors
      </p>
      {places.map((place) => (
        <section key={place} aria-label={place} className="mb-3">
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            {place}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {run.results
              .filter((r) => (r.place ?? '') === place)
              .map((result, index) => (
                <li
                  key={`${result.name}-${index}`}
                  data-testid="test-result"
                  data-outcome={result.outcome}
                  className="flex items-start gap-2"
                >
                  <span className="mt-1">{ICON[result.outcome]}</span>
                  <span className="min-w-0 flex-1">
                    <span>{result.name}</span>
                    {result.message && (
                      <span
                        data-testid="test-result-message"
                        className="block font-mono text-xs break-all text-fg-muted"
                      >
                        {result.message}
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
