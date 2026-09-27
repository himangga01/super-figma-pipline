/* eslint-disable no-await-in-loop -- checks and source fingerprints have a fixed evidence order */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { resolvePnpmEntry } from './package-manager-entry.mjs';
import { root, artifactRoot, sha256, publish } from './release-common.mjs';
import { allowedSkipSuites, testSkipCensus } from './test-skip-census.mjs';

const sourceHash = async () => {
  const names = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'service'],
    { cwd: dirname(root), windowsHide: true, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const hash = createHash('sha256');
  for (const name of [...new Set(names)].toSorted()) {
    try {
      hash
        .update(name)
        .update('\0')
        .update(await readFile(join(dirname(root), name)));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    }
  }
  return `sha256:${hash.digest('hex')}`;
};
const pnpm = resolvePnpmEntry();
const before = await sourceHash();
const folder = join(artifactRoot, 'source-checks');
await mkdir(folder, { recursive: true });
// vitest.config.ts adds a JSON reporter when SFP_VITEST_JSON_REPORT is set; the skip census and the
// known-failure ledger check read it.
const vitestReport = join(folder, 'vitest-report.json');
const vitestLog = join(folder, 'test.txt');
await rm(vitestReport, { force: true });
// The `verify` gates run one by one so each reports. The test run may exit non-zero only for
// failures named in test/known-failures.json; the `test-ledger` check decides, and it also fails
// on unledgered, stale or differently failing tests.
/** @type {[name: string, args: string[], environment?: Record<string, string>, allowFailure?: boolean][]} */
const checks = [
  ['typecheck', [pnpm, 'typecheck']],
  ['lint', [pnpm, 'lint']],
  ['format', [pnpm, 'format:check']],
  ['knip', [pnpm, 'knip']],
  ['contracts', [pnpm, 'contracts:update', '--check']],
  ['build', [pnpm, 'build']],
  ['test', [pnpm, 'test'], { SFP_VITEST_JSON_REPORT: vitestReport }, true],
  ['test-ledger', ['scripts/check-test-report.mjs', vitestReport, '--log', vitestLog]],
  ['provenance', ['scripts/verify-upstream-lock.mjs', '--offline']],
  ['graph-memory', ['scripts/verify-graph-memory.mjs']],
  ['sbom', ['scripts/generate-sbom.mjs']],
  ['notices', ['scripts/generate-notices.mjs']],
  ['package', ['scripts/package-artifacts.mjs']],
  ['checksums', ['scripts/generate-checksums.mjs']],
  ['artifacts', ['scripts/verify-artifacts.mjs']],
  ['isolated-runtime', ['scripts/smoke-packed-mcp.mjs']],
];
/** @type {{ name: string; exitCode: number; elapsedMs: number; logSha256: string }[]} */
const results = [];
/** @type {Record<string, unknown> | undefined} */
let testSkips;
// Every skipped test is recorded; a skipped REQUIRED suite fails unless SFP_ALLOW_SKIP names it.
const recordTestSkips = async () => {
  const report = JSON.parse(
    await readFile(vitestReport, 'utf8').catch(error => {
      throw new Error('SOURCE_CHECK_FAILED:vitest-report-missing', { cause: error });
    }),
  );
  const census = testSkipCensus(report, { serviceRoot: root, allowed: allowedSkipSuites() });
  await publish(
    join(folder, 'test-skips.json'),
    Buffer.from(`${JSON.stringify(census, null, 2)}\n`),
  );
  if (census.blockedSuites.length > 0)
    throw new Error(`SOURCE_CHECK_FAILED:required-suite-skipped:${census.blockedSuites.join(',')}`);
  testSkips = {
    report: 'source-checks/vitest-report.json',
    allowedSuites: census.allowedSuites,
    skippedSuites: census.skippedSuites,
    skipped: census.skipped,
  };
};
for (const [name, args, environment = {}, allowFailure = false] of checks) {
  process.stdout.write(`Checking ${name}\n`);
  const started = Date.now();
  try {
    const output = execFileSync(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 64_000_000,
      timeout: 1_800_000,
      env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', ...environment },
    });
    await publish(join(folder, `${name}.txt`), Buffer.from(output));
    results.push({ name, exitCode: 0, elapsedMs: Date.now() - started, logSha256: sha256(output) });
  } catch (error) {
    const failure = /** @type {{ stdout?: string; stderr?: string; status?: number | null }} */ (
      error
    );
    const output = String(failure.stdout ?? '') + String(failure.stderr ?? '');
    await publish(join(folder, `${name}.txt`), Buffer.from(output));
    // Only a completed run with a numeric exit code may defer to the ledger check; a timeout,
    // signal or spawn failure has no trustworthy report.
    if (!allowFailure || typeof failure.status !== 'number')
      throw new Error(`SOURCE_CHECK_FAILED:${name}`, { cause: error });
    results.push({
      name,
      exitCode: failure.status,
      elapsedMs: Date.now() - started,
      logSha256: sha256(output),
    });
  }
  if (name === 'test') await recordTestSkips();
}
const knownDefects = JSON.parse(await readFile(join(root, 'test/known-failures.json'), 'utf8'));
const after = await sourceHash();
if (before !== after) throw new Error('SOURCE_CHANGED_DURING_VERIFICATION');
/** @type {{ owner: string; finding: string }[]} */
const ledgerEntries = knownDefects.entries;
/** @type {Record<string, number>} */
const knownDefectsByOwner = {};
for (const entry of ledgerEntries)
  knownDefectsByOwner[`${entry.owner} (${entry.finding})`] =
    (knownDefectsByOwner[`${entry.owner} (${entry.finding})`] ?? 0) + 1;
const report = {
  schemaVersion: 3,
  // Ledgered failures are known defects with an owning task, never a pass.
  status:
    ledgerEntries.length === 0
      ? 'local-source-verified'
      : 'local-source-verified-with-known-defects',
  sourceHash: after,
  verifiedAt: new Date().toISOString(),
  checks: results,
  knownDefects: {
    ledger: 'test/known-failures.json',
    total: ledgerEntries.length,
    byOwner: knownDefectsByOwner,
  },
  testSkips,
  realFigmaValidated: false,
  targetServiceValidated: false,
  remoteCiValidated: false,
};
await publish(
  join(artifactRoot, 'source-checks-report.json'),
  Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
);
process.stdout.write(
  'Local source, artifacts and isolated runtime verified; live Figma and target-service acceptance are separate.\n',
);
