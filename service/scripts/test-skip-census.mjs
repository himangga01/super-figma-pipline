// Skip census for a Vitest JSON report (VER-1). It lists every test that did not run, and it fails
// when a test in a REQUIRED suite was skipped, unless SFP_ALLOW_SKIP names that suite.
//
//   node scripts/test-skip-census.mjs <vitest-report.json> [--out <census.json>] [--forbid-skips]
//
// `--forbid-skips` makes any skipped test blocking; the nightly acceptance run uses it.
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Suites that must run wherever `verify:source` or CI runs them. The files' tests call the
 * prerequisite helper in test/support/required-suite.ts, which fails them at run time with an
 * install hint; this registry catches any other way of skipping them.
 */
export const REQUIRED_SUITES = Object.freeze([
  Object.freeze({
    id: 'firefox',
    prerequisite: 'Playwright Firefox installed into PLAYWRIGHT_BROWSERS_PATH (decision D4)',
    files: Object.freeze([
      'packages/cli/test/browser-observation.test.ts',
      'packages/mcp/test/portal/preview-consumption.test.ts',
      'packages/mcp/test/portal/preview-native.test.ts',
      'packages/mcp/test/portal/preview.test.ts',
    ]),
  }),
]);

/**
 * @param {string | undefined} [value]
 * @returns {Set<string>}
 */
export const allowedSkipSuites = (value = process.env.SFP_ALLOW_SKIP) =>
  new Set((value ?? '').split(/[\s,]+/u).filter(Boolean));

/**
 * @typedef {{ file: string; test: string; status: string; suite: string | null }} SkippedTest
 *
 * @typedef {{
 *   testResults?: Array<{
 *     name: string;
 *     assertionResults?: Array<{ fullName: string; status: string }>;
 *   }>;
 * }} VitestJsonReport
 */

/**
 * @param {VitestJsonReport} report
 * @param {{ serviceRoot: string; allowed?: ReadonlySet<string>; forbidSkips?: boolean }} options
 */
export const testSkipCensus = (
  report,
  { serviceRoot, allowed = allowedSkipSuites(), forbidSkips = false },
) => {
  /** @type {Map<string, string>} */
  const suiteByFile = new Map(
    REQUIRED_SUITES.flatMap(suite =>
      suite.files.map(file => /** @type {const} */ ([file, suite.id])),
    ),
  );
  /** @type {SkippedTest[]} */
  const skipped = [];
  for (const file of report.testResults ?? []) {
    const path = relative(serviceRoot, file.name).replaceAll('\\', '/');
    for (const test of file.assertionResults ?? []) {
      if (test.status === 'passed' || test.status === 'failed') continue;
      skipped.push({
        file: path,
        test: test.fullName,
        status: test.status,
        suite: suiteByFile.get(path) ?? null,
      });
    }
  }
  const skippedSuites = [
    ...new Set(skipped.flatMap(row => (row.suite === null ? [] : [row.suite]))),
  ].toSorted();
  const blockedSuites = skippedSuites.filter(suite => !allowed.has(suite));
  if (forbidSkips && skipped.length > 0) blockedSuites.push('(any skipped test)');
  const known = /** @type {Set<string>} */ (new Set(REQUIRED_SUITES.map(suite => suite.id)));
  return {
    allowedSuites: [...allowed].toSorted(),
    unknownAllowedSuites: [...allowed].filter(suite => !known.has(suite)).toSorted(),
    skippedSuites,
    blockedSuites,
    skipped,
  };
};

/** @param {string[]} args */
const main = async args => {
  const [reportPath, ...rest] = args;
  let out;
  let forbidSkips = false;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--out') out = rest[++index];
    else if (rest[index] === '--forbid-skips') forbidSkips = true;
    else
      throw new Error(
        `usage: test-skip-census.mjs <vitest-report.json> [--out <file>] [--forbid-skips]`,
      );
  }
  if (!reportPath || (out !== undefined && !out))
    throw new Error(
      'usage: test-skip-census.mjs <vitest-report.json> [--out <file>] [--forbid-skips]',
    );
  const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const census = testSkipCensus(report, { serviceRoot, forbidSkips });
  if (out) {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(out, `${JSON.stringify(census, null, 2)}\n`);
  }
  process.stdout.write(
    `test-skip-census: ${census.skipped.length} skipped; required suites skipped: ${
      census.skippedSuites.join(', ') || 'none'
    }; allowed: ${census.allowedSuites.join(', ') || 'none'}\n`,
  );
  for (const row of census.skipped)
    process.stdout.write(
      `  ${row.status} ${row.file} :: ${row.test}${row.suite ? ` [required: ${row.suite}]` : ''}\n`,
    );
  for (const suite of census.unknownAllowedSuites)
    process.stdout.write(`  warning: SFP_ALLOW_SKIP names unknown suite ${suite}\n`);
  if (census.blockedSuites.length > 0) {
    process.stderr.write(
      `REQUIRED_SUITE_SKIPPED: ${census.blockedSuites.join(', ')}. Install the prerequisite, or set SFP_ALLOW_SKIP=<suite> to accept the skip visibly.\n`,
    );
    process.exitCode = 1;
  }
};

const invokedDirectly = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      realpathSync.native(resolve(entry)) === realpathSync.native(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
};

if (invokedDirectly()) await main(process.argv.slice(2));
