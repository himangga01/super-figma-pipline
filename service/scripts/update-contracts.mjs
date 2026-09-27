// Regenerate (default) or verify (`--check`) every artifact derived from the tool registry:
// capabilities/union-manifest.json, packages/mcp/test/plugin-contract.json and the README
// tool-count blocks. Run through `pnpm contracts:update [--check]`, which supplies
// --experimental-transform-types for the TypeScript sources. `--check` writes nothing and exits 1
// when any artifact is stale, so CI can run it before `git diff --exit-code`.
import './register-source.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--check');
if (unknown.length > 0) {
  process.stderr.write(
    `Unknown argument(s): ${unknown.join(' ')}\nUsage: pnpm contracts:update [--check]\n`,
  );
  process.exit(2);
}
const check = args.includes('--check');

let lib;
try {
  lib = await import('./contracts-lib.mjs');
} catch (error) {
  if (error?.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
    process.stderr.write(
      'The TypeScript sources need --experimental-transform-types. Run `pnpm contracts:update`.\n',
    );
    process.exit(2);
  }
  throw error;
}

try {
  const artifacts = await lib.generateContracts();
  const stale = artifacts.filter(artifact => artifact.stale);
  const missing = artifacts.filter(artifact => artifact.current === null);
  if (missing.length > 0 && !check) {
    // A regenerated baseline proves nothing: a deleted or unmerged recorded contract would turn
    // every later argument change invisible. Restore it first, then regenerate.
    process.stderr.write(
      `${missing.map(artifact => artifact.path).join(', ')} is missing. It is committed, so ` +
        'restore it from git before regenerating.\n',
    );
    process.exit(1);
  }
  if (check) {
    if (stale.length > 0) {
      process.stderr.write(`${lib.driftReport(artifacts)}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `All ${artifacts.length} generated tool-contract artifacts are current.\n`,
      );
    }
  } else {
    await Promise.all(
      stale.map(artifact => writeFile(join(lib.SERVICE_ROOT, artifact.path), artifact.next)),
    );
    for (const artifact of stale) {
      process.stdout.write(`Updated ${artifact.path}\n`);
      for (const detail of artifact.describe()) process.stdout.write(`  - ${detail}\n`);
    }
    process.stdout.write(
      stale.length > 0
        ? `Regenerated ${stale.length} of ${artifacts.length} artifacts. Review the diff before committing.\n`
        : `All ${artifacts.length} generated tool-contract artifacts are current.\n`,
    );
  }
} catch (error) {
  if (!(error instanceof lib.ContractsError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
