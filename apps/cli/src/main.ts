/** `pigeon` command dispatch (docs/cli.md). Exit codes: 0 passed, 1 failures, 2 usage error. */

import { PIGEON_VERSION } from '@pigeon/core';

import { HELP, parseCli, RUN_HELP, UsageError, VALIDATE_HELP } from './args';
import type { CliIo } from './run';
import { runCommand } from './run';
import { validateCommand } from './validate';

export type { CliIo } from './run';

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const args = parseCli(argv);
    switch (args.command) {
      case 'help':
        io.stdout(
          `${args.topic === 'run' ? RUN_HELP : args.topic === 'validate' ? VALIDATE_HELP : HELP}\n`,
        );
        return 0;
      case 'version':
        io.stdout(`pigeon ${PIGEON_VERSION}\n`);
        return 0;
      case 'run':
        return (await runCommand(args, io)).exitCode;
      case 'validate':
        return await validateCommand(args, io);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`pigeon: ${error.message}\n`);
      return 2;
    }
    io.stderr(
      `pigeon: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    return 2;
  }
}
