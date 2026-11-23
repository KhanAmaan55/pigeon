/**
 * `pigeon validate` (PIGN-054): reads every project file the way the apps do and lists the
 * problems (unreadable JSON, wrong shapes, missing files, stale order entries, orphan examples).
 * Errors fail (exit 1); warnings are listed but pass.
 */

import { resolve } from 'node:path';

import type { ValidateArgs } from './args';
import type { CliIo } from './run';
import { openProject } from './run';

export async function validateCommand(args: ValidateArgs, io: CliIo): Promise<0 | 1> {
  const dir = resolve(io.cwd, args.projectDir);
  const session = await openProject(dir);
  const problems = [...session.problems].sort((a, b) => a.path.localeCompare(b.path));
  const errors = problems.filter((p) => p.severity === 'error').length;
  const model = session.getWorkingModel();
  const counts = {
    collections: model.collections.length,
    environments: model.environments.length,
  };
  if (args.reporter === 'json') {
    io.stdout(
      `${JSON.stringify({ project: model.name, ok: errors === 0, ...counts, problems }, null, 2)}\n`,
    );
  } else {
    const paint = (code: number, text: string) =>
      io.color ? `\u001b[${code}m${text}\u001b[0m` : text;
    for (const problem of problems) {
      const label = problem.severity === 'error' ? paint(31, 'error') : paint(33, 'warning');
      io.stdout(`${label} ${problem.path}: ${problem.message} (${problem.kind})\n`);
    }
    const warnings = problems.length - errors;
    io.stdout(
      problems.length === 0
        ? `${paint(32, '✓')} ${model.name}: every file is valid (${counts.collections} collections, ${counts.environments} environments).\n`
        : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} in ${model.name}.\n`,
    );
  }
  return errors > 0 ? 1 : 0;
}
