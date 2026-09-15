import { runCommand } from './commands.js';

try {
  await runCommand(process.argv.slice(2), value =>
    process.stdout.write(`${JSON.stringify(value === undefined ? { ok: true } : value)}\n`),
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'SFP_COMMAND_FAILED'}\n`);
  process.exitCode =
    typeof error === 'object' && error !== null && 'exitCode' in error && error.exitCode === 2
      ? 2
      : 1;
}
