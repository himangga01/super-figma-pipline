import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkReport,
  formatSummary,
  parseLedger,
  SERVICE_ROOT,
} from '../scripts/check-test-report.mjs';

type Assertion = { fullName: string; status: string; failureMessages?: string[] };

const file = (name: string, assertionResults: Assertion[], extra: object = {}) => ({
  name: join(SERVICE_ROOT, name).replaceAll('\\', '/'),
  status: assertionResults.some(assertion => assertion.status === 'failed') ? 'failed' : 'passed',
  message: '',
  assertionResults,
  ...extra,
});
const failed = (fullName: string, message = 'Error: KNOWN_CODE'): Assertion => ({
  fullName,
  status: 'failed',
  failureMessages: [`${message}\n    at somewhere`],
});
const passed = (fullName: string): Assertion => ({ fullName, status: 'passed' });

const entry = (test: string, overrides: object = {}) => ({
  file: 'packages/mcp/test/example.test.ts',
  test,
  finding: 'K1',
  owner: 'T14b',
  reason: 'fixture reason',
  ...overrides,
});

describe('known-failure report check', () => {
  it('passes when every failure is ledgered and every ledgered test still fails', () => {
    const report = {
      testResults: [
        file('packages/mcp/test/example.test.ts', [failed('a known failure'), passed('fine')]),
        file('test/other.test.ts', [passed('other'), { fullName: 'skipped', status: 'skipped' }]),
      ],
    };
    const result = checkReport(
      report,
      parseLedger({ schemaVersion: 1, entries: [entry('a known failure')] }),
    );

    expect(result.ok).toBe(true);
    expect(result.counts).toEqual({
      files: 2,
      tests: 4,
      passed: 2,
      failed: 1,
      skipped: 1,
      suiteErrors: 0,
    });
    expect(result.known).toHaveLength(1);
    expect(formatSummary(result, 1)).toContain('Result: PASS');
  });

  it('fails on a failing test that is not in the ledger', () => {
    const report = {
      testResults: [file('packages/mcp/test/example.test.ts', [failed('a new regression')])],
    };
    const result = checkReport(report, []);

    expect(result.ok).toBe(false);
    expect(result.unexpected.map(row => row.test)).toEqual(['a new regression']);
    expect(formatSummary(result, 0)).toContain('UNEXPECTED failures, not in the ledger (1)');
  });

  it('reports a ledgered test that now passes as STALE and fails', () => {
    const report = {
      testResults: [file('packages/mcp/test/example.test.ts', [passed('fixed by its task')])],
    };
    const result = checkReport(report, [entry('fixed by its task')]);

    expect(result.ok).toBe(false);
    expect(result.stale.map(row => row.test)).toEqual(['fixed by its task']);
    expect(formatSummary(result, 1)).toMatch(/STALE ledger entries that now pass; remove them/u);
  });

  it('fails when a ledgered test fails for a different reason than recorded', () => {
    const report = {
      testResults: [
        file('packages/mcp/test/example.test.ts', [failed('known', 'Error: SOMETHING_ELSE')]),
      ],
    };
    const result = checkReport(report, [entry('known', { failureIncludes: 'KNOWN_CODE' })]);

    expect(result.ok).toBe(false);
    expect(result.reasonChanged).toHaveLength(1);
    expect(result.reasonChanged[0]?.message).toBe('Error: SOMETHING_ELSE');
  });

  it('fails on a failed suite even when no test inside it failed', () => {
    const report = {
      testResults: [
        file('packages/mcp/test/broken.test.ts', [], {
          status: 'failed',
          message: 'SyntaxError: import failed',
        }),
      ],
    };
    const result = checkReport(report, []);

    expect(result.ok).toBe(false);
    expect(result.suiteFailures).toEqual([
      { file: 'packages/mcp/test/broken.test.ts', message: 'SyntaxError: import failed' },
    ]);
  });

  it('fails when the Vitest log reports errors raised outside any test', () => {
    const report = {
      testResults: [file('packages/mcp/test/example.test.ts', [passed('fine')])],
    };
    const log =
      ' Test Files  1 passed (1)\nVitest caught 2 unhandled errors during the test run.\n';

    expect(checkReport(report, [], { log })).toMatchObject({ ok: false, unhandledErrors: 2 });
    expect(checkReport(report, [], { log: ' Test Files  1 passed (1)\n' }).ok).toBe(true);
  });

  it('requires ledgered files and tests to be present unless the run is partial', () => {
    const report = {
      testResults: [file('packages/mcp/test/example.test.ts', [passed('something else')])],
    };
    const missingFile = entry('absent', { file: 'packages/mcp/test/not-run.test.ts' });
    const renamed = entry('renamed test');

    expect(checkReport(report, [missingFile]).notRun).toEqual([missingFile]);
    expect(checkReport(report, [missingFile], { allowPartial: true }).ok).toBe(true);
    expect(checkReport(report, [renamed], { allowPartial: true })).toMatchObject({
      ok: false,
      unknownTests: [renamed],
    });
  });

  it('matches ledger paths inside a report produced by another working copy', () => {
    const report = {
      testResults: [
        {
          name: 'D:/elsewhere/checkout/service/packages/mcp/test/example.test.ts',
          status: 'failed',
          assertionResults: [failed('a known failure')],
        },
      ],
    };

    expect(checkReport(report, [entry('a known failure')]).ok).toBe(true);
  });

  it('rejects malformed or duplicate ledger rows', () => {
    expect(() => parseLedger({ schemaVersion: 2, entries: [] })).toThrow('schemaVersion 1');
    expect(() => parseLedger({ schemaVersion: 1, entries: [entry('x', { owner: '' })] })).toThrow(
      'non-empty owner',
    );
    expect(() => parseLedger({ schemaVersion: 1, entries: [entry('x', { extra: true })] })).toThrow(
      'unknown key extra',
    );
    expect(() => parseLedger({ schemaVersion: 1, entries: [entry('x'), entry('x')] })).toThrow(
      'duplicates',
    );
    expect(() =>
      parseLedger({ schemaVersion: 1, entries: [entry('x', { file: '../outside.test.ts' })] }),
    ).toThrow('service-relative POSIX path');
  });

  it('keeps the committed ledger valid, named and owned by fix-plan tasks', () => {
    const entries = parseLedger(
      JSON.parse(readFileSync(join(SERVICE_ROOT, 'test/known-failures.json'), 'utf8')),
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const row of entries) {
      expect({ test: row.test, finding: row.finding, owner: row.owner }).toEqual({
        test: row.test,
        finding: expect.stringMatching(/^[A-Z][A-Z0-9]*-?\d+$/u),
        owner: expect.stringMatching(/^T\d{2}[a-z]?$/u),
      });
    }
  });
});
