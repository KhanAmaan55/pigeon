/** Command-line parsing for `pigeon run` and `pigeon validate` (docs/cli.md). */

import type { ParseArgsOptionsConfig } from 'node:util';
import { parseArgs } from 'node:util';

export type Reporter = 'pretty' | 'json' | 'junit';

export interface RunArgs {
  command: 'run';
  projectDir: string;
  collection?: string;
  folder?: string;
  env?: string;
  vars: Array<[string, string]>;
  bail: boolean;
  failOnWarn: boolean;
  scripts: boolean;
  reporter: Reporter;
  out?: string;
  timeoutMs?: number;
}

export interface ValidateArgs {
  command: 'validate';
  projectDir: string;
  reporter: 'pretty' | 'json';
}

export type CliArgs =
  RunArgs | ValidateArgs | { command: 'help'; topic?: 'run' | 'validate' } | { command: 'version' };

/** A usage or configuration error: exit code 2. */
export class UsageError extends Error {}

const REPORTERS: readonly Reporter[] = ['pretty', 'json', 'junit'];

function parsed(argv: string[], options: ParseArgsOptionsConfig) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function projectDir(positionals: string[], command: string): string {
  if (positionals.length === 0) throw new UsageError(`pigeon ${command} needs a project folder.`);
  if (positionals.length > 1) {
    throw new UsageError(`Unexpected argument "${positionals[1]}".`);
  }
  return positionals[0]!;
}

export function parseCli(argv: readonly string[]): CliArgs {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    const topic = rest[0];
    return topic === 'run' || topic === 'validate'
      ? { command: 'help', topic }
      : { command: 'help' };
  }
  if (command === '--version' || command === '-v') return { command: 'version' };
  if (command === 'run') return parseRun(rest);
  if (command === 'validate') return parseValidate(rest);
  throw new UsageError(`Unknown command "${command}". Use "pigeon run" or "pigeon validate".`);
}

function parseRun(argv: string[]): RunArgs | { command: 'help'; topic: 'run' } {
  const { values, positionals } = parsed(argv, {
    collection: { type: 'string', short: 'c' },
    folder: { type: 'string', short: 'f' },
    env: { type: 'string', short: 'e' },
    var: { type: 'string', multiple: true },
    bail: { type: 'boolean' },
    'fail-on-warn': { type: 'boolean' },
    'no-scripts': { type: 'boolean' },
    reporter: { type: 'string', short: 'r' },
    out: { type: 'string', short: 'o' },
    timeout: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  });
  if (values['help']) return { command: 'help', topic: 'run' };
  const reporter = (values['reporter'] as string | undefined) ?? 'pretty';
  if (!(REPORTERS as readonly string[]).includes(reporter)) {
    throw new UsageError(`--reporter must be one of ${REPORTERS.join(', ')}.`);
  }
  const vars: Array<[string, string]> = [];
  for (const pair of (values['var'] as string[] | undefined) ?? []) {
    const at = pair.indexOf('=');
    if (at <= 0) throw new UsageError(`--var needs key=value, got "${pair}".`);
    vars.push([pair.slice(0, at), pair.slice(at + 1)]);
  }
  let timeoutMs: number | undefined;
  if (values['timeout'] !== undefined) {
    timeoutMs = Number(values['timeout']);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new UsageError('--timeout must be a positive number of milliseconds.');
    }
  }
  const optional = (name: string) => {
    const value = values[name] as string | undefined;
    return value === undefined ? {} : { [name]: value };
  };
  return {
    command: 'run',
    projectDir: projectDir(positionals, 'run'),
    ...optional('collection'),
    ...optional('folder'),
    ...optional('env'),
    ...optional('out'),
    vars,
    bail: values['bail'] === true,
    failOnWarn: values['fail-on-warn'] === true,
    scripts: values['no-scripts'] !== true,
    reporter: reporter as Reporter,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function parseValidate(argv: string[]): ValidateArgs | { command: 'help'; topic: 'validate' } {
  const { values, positionals } = parsed(argv, {
    reporter: { type: 'string', short: 'r' },
    help: { type: 'boolean', short: 'h' },
  });
  if (values['help']) return { command: 'help', topic: 'validate' };
  const reporter = (values['reporter'] as string | undefined) ?? 'pretty';
  if (reporter !== 'pretty' && reporter !== 'json') {
    throw new UsageError('--reporter must be pretty or json.');
  }
  return { command: 'validate', projectDir: projectDir(positionals, 'validate'), reporter };
}

export const HELP = `Usage: pigeon <command> [options]

Commands:
  run <projectDir>        Send a collection or folder and compare responses with baselines
  validate <projectDir>   Parse every project file and report problems

Options:
  -h, --help              Show help (pigeon help run, pigeon help validate)
  -v, --version           Show the version

Exit codes: 0 passed, 1 failures (or problems), 2 usage or configuration error.
Docs: docs/cli.md`;

export const RUN_HELP = `Usage: pigeon run <projectDir> [options]

Selection:
  -c, --collection <name|id>  Collection to run (default: every collection)
  -f, --folder <path|id>      Folder to run, e.g. "Admin/Users" (inside --collection if given)
  -e, --env <name|id|file>    Project environment, or an environment file (Pigeon or Postman)

Variables (highest precedence; only these provide secrets — local app state is never read):
      --var <key=value>       Repeatable
  PIGEON_VAR_<key>=<value>    Environment variables; always masked in output

Run:
      --bail                  Stop after the first failure (the rest is skipped)
      --fail-on-warn          Warnings fail the run too
      --no-scripts            Do not run pre-request and test scripts
      --timeout <ms>          Request timeout (default 30000)

Output:
  -r, --reporter <name>       pretty (default), json (RunReports) or junit (XML)
  -o, --out <file>            Write the report to a file (pretty summary on stdout)

Exit codes: 0 passed, 1 a request failed or errored, 2 usage or configuration error.`;

export const VALIDATE_HELP = `Usage: pigeon validate <projectDir> [--reporter pretty|json]

Reads every project file the way the apps do and lists problems. Exit code 1 when any file has
an error (warnings alone pass), 2 for a usage error. Nothing is written.`;
