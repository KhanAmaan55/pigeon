/**
 * `pigeon run` reporters (docs/cli.md): pretty (TTY colours), JSON (the `RunReport`s) and JUnit
 * XML (one test case per request, findings in the failure message). Secrets are already masked
 * in everything passed here.
 */

import type { RunEntry, RunOutcome, RunReport } from '@pigeon/core';
import { PIGEON_VERSION } from '@pigeon/core';

/** What a reporter shows beyond the stored entry. */
export interface EntryDetail {
  /** `Collection/Folder/…` (JUnit class name). */
  className?: string;
  findings?: Array<{ severity: 'fail' | 'warn'; text: string }>;
}

const MAX_FINDINGS_SHOWN = 10;

const ANSI = { red: 31, green: 32, yellow: 33, gray: 90, bold: 1 } as const;

const SYMBOLS: Record<RunOutcome, string> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
  error: '✗',
  'no-baseline': '–',
  skipped: '·',
};

const COLORS: Record<RunOutcome, keyof typeof ANSI> = {
  pass: 'green',
  warn: 'yellow',
  fail: 'red',
  error: 'red',
  'no-baseline': 'gray',
  skipped: 'gray',
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function summary(entry: RunEntry): string {
  switch (entry.outcome) {
    case 'error':
      return `error: ${entry.message ?? 'no response'}`;
    case 'skipped':
      return 'skipped';
    case 'no-baseline':
      return entry.message ?? 'not compared';
    default: {
      const parts: string[] = [];
      if (entry.counts?.fail) parts.push(plural(entry.counts.fail, 'difference'));
      if (entry.counts?.warn) parts.push(plural(entry.counts.warn, 'warning'));
      if (entry.tests) {
        const failed = entry.tests.fail + entry.tests.error;
        const total = failed + entry.tests.pass;
        parts.push(
          failed > 0 ? `${failed}/${total} tests failed` : `${plural(total, 'test')} passed`,
        );
      }
      if (entry.exampleName) parts.push(`vs “${entry.exampleName}”`);
      return parts.join(', ');
    }
  }
}

export function totalsLine(report: RunReport): string {
  const order: RunOutcome[] = ['pass', 'warn', 'fail', 'error', 'no-baseline', 'skipped'];
  const labels: Record<RunOutcome, string> = {
    pass: 'passed',
    warn: 'with warnings',
    fail: 'failed',
    error: 'errored',
    'no-baseline': 'not compared',
    skipped: 'skipped',
  };
  const parts = order
    .filter((o) => report.totals[o] > 0)
    .map((o) => `${report.totals[o]} ${labels[o]}`);
  const seconds = (report.durationMs / 1000).toFixed(1);
  return `${parts.join(', ') || 'nothing run'} in ${seconds} s${report.stoppedOnFail ? ' (stopped after the first failure)' : ''}`;
}

export function createPrettyReporter(opts: { write: (text: string) => void; color: boolean }) {
  const paint = (color: keyof typeof ANSI, text: string) =>
    opts.color ? `\u001b[${ANSI[color]}m${text}\u001b[0m` : text;
  return {
    scope(scope: RunReport['scope'], environment: RunReport['environment'], total: number) {
      const env = environment ? ` · environment ${environment.name}` : '';
      opts.write(
        `${paint('bold', `${scope.name}`)} (${scope.kind}${env}) · ${plural(total, 'request')}\n`,
      );
    },
    entry(entry: RunEntry, detail: EntryDetail) {
      const name = [...entry.folders, entry.name].join(' / ');
      const status = entry.status === undefined ? '' : ` ${entry.status}`;
      const time = entry.timeMs === undefined ? '' : paint('gray', ` ${entry.timeMs} ms`);
      const note = summary(entry);
      opts.write(
        `  ${paint(COLORS[entry.outcome], SYMBOLS[entry.outcome])} ${entry.method.padEnd(6)} ${name}${status}${time}${note ? paint('gray', `  ${note}`) : ''}\n`,
      );
      if (entry.outcome === 'fail' || entry.outcome === 'warn') {
        const findings = detail.findings ?? [];
        for (const finding of findings.slice(0, MAX_FINDINGS_SHOWN)) {
          opts.write(
            `      ${paint(finding.severity === 'fail' ? 'red' : 'yellow', finding.text)}\n`,
          );
        }
        if (findings.length > MAX_FINDINGS_SHOWN) {
          opts.write(paint('gray', `      … ${findings.length - MAX_FINDINGS_SHOWN} more\n`));
        }
        for (const failure of entry.tests?.failures ?? []) {
          opts.write(
            `      ${paint('red', `test “${failure.name}”${failure.message ? `: ${failure.message}` : ''}`)}\n`,
          );
        }
      }
    },
    totals(report: RunReport) {
      const failed = report.totals.fail + report.totals.error > 0;
      opts.write(`  ${paint(failed ? 'red' : 'green', totalsLine(report))}\n\n`);
    },
  };
}

/** `--reporter json`: every scope's `RunReport` (data-model.md §7.3), unchanged. */
export function renderJson(
  projectName: string,
  reports: readonly RunReport[],
  exitCode: number,
): string {
  return `${JSON.stringify(
    { pigeonCliReport: 1, version: PIGEON_VERSION, project: projectName, exitCode, reports },
    null,
    2,
  )}\n`;
}

function xml(text: string): string {
  return (
    text
      // XML 1.0 has no place for most control characters, even escaped.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

const seconds = (ms: number | undefined) => ((ms ?? 0) / 1000).toFixed(3);

/**
 * `--reporter junit`: one `<testsuite>` per collection or folder run, one `<testcase>` per
 * request (`classname` = collection/folders, `name` = method and request name). Fails and test
 * failures are `<failure>`, transport errors `<error>`, requests without a baseline or skipped
 * after `--bail` are `<skipped>`; warnings are failures only with `--fail-on-warn`.
 */
export function renderJunit(
  reports: readonly RunReport[],
  details: ReadonlyMap<string, EntryDetail>,
  opts: { failOnWarn: boolean },
): string {
  let tests = 0;
  let failures = 0;
  let errors = 0;
  let skipped = 0;
  let time = 0;
  const suites: string[] = [];
  for (const report of reports) {
    let suiteFailures = 0;
    let suiteErrors = 0;
    let suiteSkipped = 0;
    const cases: string[] = [];
    for (const entry of report.entries) {
      const detail = details.get(`${report.scope.id}/${entry.requestId}`) ?? {};
      const className = detail.className ?? [report.scope.name, ...entry.folders].join('/');
      const lines = [
        ...(detail.findings ?? []).map(
          (f) => `${f.severity === 'fail' ? 'FAIL' : 'WARN'} ${f.text}`,
        ),
        ...(entry.tests?.failures ?? []).map(
          (f) => `TEST ${f.name}${f.message ? `: ${f.message}` : ''}`,
        ),
      ];
      const url = entry.url
        ? `${entry.method} ${entry.url}${entry.status === undefined ? '' : ` → ${entry.status}`}`
        : '';
      const body = xml([url, ...lines].filter((l) => l !== '').join('\n'));
      let inner = '';
      const failing = entry.outcome === 'fail' || (opts.failOnWarn && entry.outcome === 'warn');
      if (failing) {
        suiteFailures++;
        inner = `\n      <failure message="${xml(summary(entry) || entry.outcome)}" type="${entry.outcome}">${body}</failure>\n    `;
      } else if (entry.outcome === 'error') {
        suiteErrors++;
        inner = `\n      <error message="${xml(entry.message ?? 'No response')}" type="error">${body}</error>\n    `;
      } else if (entry.outcome === 'skipped' || entry.outcome === 'no-baseline') {
        suiteSkipped++;
        inner = `\n      <skipped message="${xml(entry.outcome === 'skipped' ? 'Skipped (stopped after the first failure)' : (entry.message ?? 'Not compared'))}"/>\n    `;
      } else if (lines.length > 0) {
        inner = `\n      <system-out>${body}</system-out>\n    `;
      }
      cases.push(
        `    <testcase classname="${xml(className)}" name="${xml(`${entry.method} ${entry.name}`)}" time="${seconds(entry.timeMs)}">${inner}</testcase>`,
      );
    }
    tests += report.entries.length;
    failures += suiteFailures;
    errors += suiteErrors;
    skipped += suiteSkipped;
    time += report.durationMs;
    const env = report.environment
      ? `\n      <property name="environment" value="${xml(report.environment.name)}"/>`
      : '';
    suites.push(
      `  <testsuite name="${xml(report.scope.name)}" tests="${report.entries.length}" failures="${suiteFailures}" errors="${suiteErrors}" skipped="${suiteSkipped}" time="${seconds(report.durationMs)}" timestamp="${report.startedAt.replace(/Z$/, '')}">\n` +
        `    <properties>\n      <property name="scope" value="${report.scope.kind}"/>${env}\n    </properties>\n` +
        `${cases.join('\n')}\n  </testsuite>`,
    );
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="pigeon" tests="${tests}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${seconds(time)}">\n` +
    `${suites.join('\n')}\n</testsuites>\n`
  );
}
