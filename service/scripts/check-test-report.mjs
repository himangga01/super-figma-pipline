// Check a Vitest JSON report against the known-failure ledger (test/known-failures.json).
//
//   node scripts/check-test-report.mjs <vitest-report.json> [--ledger <path>] [--log <output>]
//     [--allow-partial]
//
// Exits 1 when any failing test or failed suite is not in the ledger, when a ledgered test no
// longer fails (STALE: the fixing task must remove its entry), when a ledgered test fails for a
// different reason than recorded, or when a ledgered test was not run. `--log` names Vitest's
// console output: errors raised outside any test appear only there, so a log reporting unhandled
// errors also fails. `--allow-partial` ignores ledger entries whose test file is absent from the
// report, for focused runs. Exits 2 on unusable input. The ledger tolerates only named known
// defects, never a whole file or a count.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SERVICE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_LEDGER = 'test/known-failures.json';

const ENTRY_KEYS = new Set(['file', 'test', 'finding', 'owner', 'reason', 'failureIncludes']);
const REQUIRED_KEYS = ['file', 'test', 'finding', 'owner', 'reason'];
const SKIPPED = new Set(['skipped', 'pending', 'todo', 'disabled']);
const UNHANDLED_SUMMARY = /Vitest caught (\d+) unhandled errors? during the test run/u;

const toPosix = value => value.replaceAll('\\', '/');
const entryKey = (file, test) => JSON.stringify([file, test]);
/** A report path matches a ledger path exactly or, from another working copy, by suffix. */
const sameFile = (reportFile, ledgerFile) =>
  reportFile === ledgerFile || reportFile.endsWith(`/${ledgerFile}`);

/** Validate the ledger shape and return its entries; throws on any malformed or duplicate row. */
export const parseLedger = ledger => {
  if (ledger === null || typeof ledger !== 'object' || ledger.schemaVersion !== 1) {
    throw new Error('known-failure ledger must be an object with schemaVersion 1');
  }
  if (!Array.isArray(ledger.entries))
    throw new Error('known-failure ledger needs an entries array');
  const seen = new Set();
  for (const [index, entry] of ledger.entries.entries()) {
    const where = `ledger entry ${index}`;
    if (entry === null || typeof entry !== 'object') throw new Error(`${where} is not an object`);
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) throw new Error(`${where} has unknown key ${key}`);
    }
    for (const key of REQUIRED_KEYS) {
      if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
        throw new Error(`${where} needs a non-empty ${key}`);
      }
    }
    if (entry.failureIncludes !== undefined && typeof entry.failureIncludes !== 'string') {
      throw new Error(`${where} has a non-string failureIncludes`);
    }
    if (entry.file.includes('\\') || entry.file.startsWith('/') || entry.file.includes('..')) {
      throw new Error(`${where} file must be a service-relative POSIX path`);
    }
    const key = entryKey(entry.file, entry.test);
    if (seen.has(key)) throw new Error(`${where} duplicates ${entry.file} > ${entry.test}`);
    seen.add(key);
  }
  return ledger.entries;
};

/**
 * Compare one Vitest JSON report with the ledger. Pure: returns every finding and an `ok` verdict;
 * printing and the exit code belong to the CLI.
 */
export const checkReport = (report, ledgerEntries, options = {}) => {
  const root = `${toPosix(resolve(options.root ?? SERVICE_ROOT)).replace(/\/+$/u, '')}/`;
  const relative = name => {
    const path = toPosix(name);
    return path.toLowerCase().startsWith(root.toLowerCase()) ? path.slice(root.length) : path;
  };
  if (report === null || typeof report !== 'object' || !Array.isArray(report.testResults)) {
    throw new Error('not a Vitest JSON report: testResults is missing');
  }

  const counts = { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0, suiteErrors: 0 };
  const results = [];
  const suiteFailures = [];
  for (const file of report.testResults) {
    counts.files += 1;
    const path = relative(String(file.name ?? ''));
    const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    for (const assertion of assertions) {
      counts.tests += 1;
      const status = String(assertion.status);
      if (status === 'passed') counts.passed += 1;
      else if (status === 'failed') counts.failed += 1;
      else if (SKIPPED.has(status)) counts.skipped += 1;
      results.push({
        file: path,
        test: String(assertion.fullName ?? assertion.title ?? ''),
        status,
        message: Array.isArray(assertion.failureMessages)
          ? assertion.failureMessages.join('\n')
          : '',
      });
    }
    // A file can fail without any failed test (import error, hook failure, unhandled error).
    if (file.status === 'failed' && !assertions.some(assertion => assertion.status === 'failed')) {
      counts.suiteErrors += 1;
      suiteFailures.push({ file: path, message: String(file.message ?? '').slice(0, 2_000) });
    }
  }

  const known = [];
  const reasonChanged = [];
  const stale = [];
  const notFailing = [];
  const notRun = [];
  const unknownTests = [];
  const matched = new Set();
  for (const entry of ledgerEntries) {
    const fileResults = results.filter(result => sameFile(result.file, entry.file));
    if (fileResults.length === 0) {
      if (!options.allowPartial) notRun.push(entry);
      continue;
    }
    const testResults = fileResults.filter(result => result.test === entry.test);
    if (testResults.length === 0) {
      unknownTests.push(entry);
      continue;
    }
    for (const result of testResults) matched.add(result);
    const failed = testResults.filter(result => result.status === 'failed');
    if (failed.length === 0) {
      (testResults.some(result => result.status === 'passed') ? stale : notFailing).push(entry);
      continue;
    }
    const different =
      entry.failureIncludes === undefined
        ? undefined
        : failed.find(result => !result.message.includes(entry.failureIncludes));
    if (different !== undefined) {
      reasonChanged.push({ entry, message: different.message.split('\n')[0] ?? '' });
      continue;
    }
    known.push(entry);
  }
  const unexpected = results.filter(result => result.status === 'failed' && !matched.has(result));
  // Errors raised outside any test never reach the JSON report; Vitest only prints them.
  const unhandled = UNHANDLED_SUMMARY.exec(options.log ?? '');
  const unhandledErrors = unhandled === null ? 0 : Number(unhandled[1]);

  const ok =
    unhandledErrors === 0 &&
    unexpected.length === 0 &&
    suiteFailures.length === 0 &&
    stale.length === 0 &&
    notFailing.length === 0 &&
    reasonChanged.length === 0 &&
    notRun.length === 0 &&
    unknownTests.length === 0;
  return {
    ok,
    counts,
    unhandledErrors,
    known,
    unexpected,
    suiteFailures,
    stale,
    notFailing,
    reasonChanged,
    notRun,
    unknownTests,
  };
};

const byOwner = entries => {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.finding} -> ${entry.owner}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, count]) => `    ${key}: ${count}`);
};

/** Human-readable summary of a checkReport result. */
export const formatSummary = (result, ledgerSize) => {
  const { counts } = result;
  const lines = [
    `Vitest report: ${counts.files} files, ${counts.tests} tests: ${counts.passed} passed, ` +
      `${counts.failed} failed, ${counts.skipped} skipped; ${counts.suiteErrors} failed suites ` +
      'without a failed test.',
    `Known failures matched: ${result.known.length} of ${ledgerSize} ledger entries.`,
    ...byOwner(result.known),
  ];
  if (result.unhandledErrors > 0) {
    lines.push(`UNHANDLED errors reported by Vitest outside any test: ${result.unhandledErrors}`);
  }
  const section = (title, rows) => {
    if (rows.length === 0) return;
    lines.push(`${title} (${rows.length}):`, ...rows.map(row => `  - ${row}`));
  };
  section(
    'UNEXPECTED failures, not in the ledger',
    result.unexpected.map(row => `${row.file} > ${row.test}: ${row.message.split('\n')[0]}`),
  );
  section(
    'UNEXPECTED failed suites',
    result.suiteFailures.map(row => `${row.file}: ${row.message.split('\n')[0]}`),
  );
  section(
    'STALE ledger entries that now pass; remove them',
    result.stale.map(entry => `${entry.file} > ${entry.test} (${entry.finding}, ${entry.owner})`),
  );
  section(
    'Ledger entries that ran but did not fail (skipped)',
    result.notFailing.map(entry => `${entry.file} > ${entry.test}`),
  );
  section(
    'Ledger entries failing for a different reason',
    result.reasonChanged.map(
      row =>
        `${row.entry.file} > ${row.entry.test}: expected "${row.entry.failureIncludes}", got ` +
        `"${row.message}"`,
    ),
  );
  section(
    'Ledger entries whose file is not in the report (use --allow-partial for focused runs)',
    result.notRun.map(entry => `${entry.file} > ${entry.test}`),
  );
  section(
    'Ledger entries naming a test the report does not contain',
    result.unknownTests.map(entry => `${entry.file} > ${entry.test}`),
  );
  lines.push(`Result: ${result.ok ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
};

const main = async argv => {
  const args = [...argv];
  let ledgerPath = join(SERVICE_ROOT, DEFAULT_LEDGER);
  let logPath;
  let allowPartial = false;
  const positional = [];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--ledger') ledgerPath = resolve(args.shift() ?? '');
    else if (arg === '--log') logPath = resolve(args.shift() ?? '');
    else if (arg === '--allow-partial') allowPartial = true;
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    process.stderr.write(
      'Usage: node scripts/check-test-report.mjs <vitest-report.json> ' +
        '[--ledger <path>] [--log <output>] [--allow-partial]\n',
    );
    return 2;
  }
  let report;
  let entries;
  let log;
  try {
    report = JSON.parse(await readFile(resolve(positional[0]), 'utf8'));
    entries = parseLedger(JSON.parse(await readFile(ledgerPath, 'utf8')));
    if (logPath !== undefined) log = await readFile(logPath, 'utf8');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  let result;
  try {
    result = checkReport(report, entries, { allowPartial, log });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  process.stdout.write(`${formatSummary(result, entries.length)}\n`);
  return result.ok ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
