/**
 * Test script results (PIGN-044): a badge for the status line ("Tests 4/5") and the Tests tab,
 * grouped by where the script lives (collection → folders → request).
 */

import type { TestRun } from '@pigeon/core';
import { testsOutcome } from '@pigeon/core';
import { CircleCheck, CircleX, OctagonAlert } from 'lucide-react';

import { SectionLabel } from '../../components/ui';
import { chipClass } from './StatusLine';

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
      className={chipClass(outcome === 'pass' ? 'pass' : 'fail', true)}
    >
      {outcome === 'pass' ? ICON.pass : ICON.fail}
      Tests {run.counts.pass}/{total(run)}
    </button>
  );
}

export function TestsTab({ run }: { run: TestRun }) {
  const places = [...new Set(run.results.map((r) => r.place ?? ''))];
  return (
    <div data-testid="tests-tab" className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
      <p data-testid="tests-counts" className="mb-3 text-xs text-fg-muted">
        {run.counts.pass} passed · {run.counts.fail} failed · {run.counts.error} errors
      </p>
      {places.map((place) => (
        <section key={place} aria-label={place} className="mb-4 last:mb-0">
          <SectionLabel role="heading" aria-level={2} className="mb-1.5">
            {place}
          </SectionLabel>
          <ul className="flex flex-col gap-1">
            {run.results
              .filter((r) => (r.place ?? '') === place)
              .map((result, index) => (
                <li
                  key={`${result.name}-${index}`}
                  data-testid="test-result"
                  data-outcome={result.outcome}
                  className="flex items-start gap-2 rounded px-1.5 py-0.5 hover:bg-hover/60"
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
