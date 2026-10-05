import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolvePnpmEntry } from './package-manager-entry.mjs';
import { sourceFingerprint } from './source-fingerprint.mjs';
import { checkTestScope } from './test-report-scope.mjs';
import { REQUIRED_SUITES } from './test-skip-census.mjs';

/** @param {{ serviceRoot: string; file?: string; runId?: string }} options */
export const declareTestScope = async ({ serviceRoot, file, runId = randomUUID() }) => {
  const mode = file === undefined ? 'full' : 'focused';
  const pnpm = resolvePnpmEntry();
  const packageJson = JSON.parse(await readFile(join(serviceRoot, 'package.json'), 'utf8'));
  if (
    mode === 'full' &&
    packageJson.scripts.test !== 'vitest run --exclude "test/artifact-contents.test.ts"'
  ) {
    throw new Error('TEST_SCOPE_COMMAND_CHANGED: review the full test collection command');
  }
  const filters = file === undefined ? ['--exclude', 'test/artifact-contents.test.ts'] : [file];
  const before = await sourceFingerprint(serviceRoot);
  const collect = extra =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [pnpm, 'exec', 'vitest', 'list', ...filters, '--json', ...extra],
        {
          cwd: serviceRoot,
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 64_000_000,
          env: { ...process.env, SFP_VITEST_JSON_REPORT: '' },
        },
      ),
    );
  const files = collect(['--filesOnly']);
  const registrationCommand = [
    join(serviceRoot, 'scripts/collect-test-registrations.mjs'),
    ...(file === undefined ? ['--full'] : ['--file', file]),
  ];
  const cases = JSON.parse(
    execFileSync(process.execPath, registrationCommand, {
      cwd: serviceRoot,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 64_000_000,
      env: { ...process.env, SFP_VITEST_JSON_REPORT: '' },
    }),
  );
  const scope = {
    schemaVersion: 1,
    mode,
    runId,
    declaredAt: new Date().toISOString(),
    sourceHash: before,
    command: file === undefined ? ['pnpm', 'test'] : ['pnpm', 'exec', 'vitest', 'run', file],
    collectionCommand: [
      'node',
      'scripts/collect-test-registrations.mjs',
      ...registrationCommand.slice(1),
    ],
    toolchain: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      nodeSha256: createHash('sha256')
        .update(await readFile(process.execPath))
        .digest('hex'),
      pnpmSha256: createHash('sha256')
        .update(await readFile(pnpm))
        .digest('hex'),
    },
    files: files
      .map(row => ({
        path: relative(serviceRoot, row.file).replaceAll('\\', '/'),
        tests: cases
          .filter(test => test.file === row.file && test.projectName === row.projectName)
          .map(test => test.name),
      }))
      .toSorted((left, right) => left.path.localeCompare(right.path)),
  };
  const mockReport = {
    testResults: scope.files.map(row => ({
      name: join(serviceRoot, row.path),
      assertionResults: row.tests.map(fullName => ({ fullName })),
    })),
  };
  const problems = checkTestScope(
    mockReport,
    scope,
    serviceRoot,
    REQUIRED_SUITES.flatMap(suite => suite.files),
  );
  if (problems.length > 0) throw new Error(`TEST_SCOPE_DECLARATION_FAILED: ${problems.join('; ')}`);
  if (before !== (await sourceFingerprint(serviceRoot)))
    throw new Error('SOURCE_CHANGED_DURING_SCOPE_DECLARATION');
  return scope;
};

const main = async args => {
  const [mode, ...rest] = args;
  const focused = mode === '--file';
  const file = focused ? rest.shift() : undefined;
  if (
    (!focused && mode !== '--full') ||
    (focused && !file) ||
    rest.shift() !== '--out' ||
    rest.length !== 1
  ) {
    throw new Error('usage: declare-test-scope.mjs (--full | --file <path>) --out <scope.json>');
  }
  const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const scope = await declareTestScope({ serviceRoot, file });
  const out = resolve(rest[0]);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(scope, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(
    `test-scope=declared mode=${scope.mode} files=${scope.files.length} run=${scope.runId}\n`,
  );
};
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main(process.argv.slice(2));
