import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolvePnpmEntry } from '../scripts/package-manager-entry.mjs';
import { sourceFingerprint } from '../scripts/source-fingerprint.mjs';
import {
  REQUIRED_SUITES,
  allowedSkipSuites,
  testSkipCensus,
} from '../scripts/test-skip-census.mjs';

const serviceRoot = resolve(import.meta.dirname, '..');
const script = join(serviceRoot, 'scripts', 'test-skip-census.mjs');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const report = (files: Record<string, Array<[string, string]>>) => ({
  numTotalTests: Object.values(files).flat().length,
  testResults: Object.entries(files).map(([file, tests]) => ({
    name: `${serviceRoot.replaceAll('\\', '/')}/${file}`,
    status: 'passed',
    assertionResults: tests.map(([fullName, status]) => ({ fullName, status, title: fullName })),
  })),
});

const sample = report({
  'packages/cli/test/browser-observation.test.ts': [
    ['observes the editor', 'skipped'],
    ['reads layers', 'passed'],
  ],
  'packages/mcp/test/fs/workspace-policy.test.ts': [
    ['rejects NUL on Windows', 'skipped'],
    ['resolves a write', 'passed'],
  ],
  'packages/mcp/test/portal/native-artifacts.test.ts': [['opt-in Vite build', 'todo']],
});

describe('test skip census', () => {
  const fullScope = {
    schemaVersion: 1,
    mode: 'full',
    runId: 'full-attempt',
    sourceHash: `sha256:${'a'.repeat(64)}`,
    command: ['pnpm', 'test'],
    toolchain: { node: process.version },
    files: REQUIRED_SUITES.flatMap(suite =>
      suite.files.map(path => ({ path, tests: ['required case'] })),
    ),
  };
  it.each(REQUIRED_SUITES.flatMap(suite => suite.files))(
    'blocks a full report omitting required file %s',
    missing => {
      const files = Object.fromEntries(
        fullScope.files
          .filter(file => file.path !== missing)
          .map(file => [file.path, [['required case', 'passed']] as Array<[string, string]>]),
      );
      const result = testSkipCensus(report(files), { serviceRoot, scope: fullScope });
      expect(result.scopeProblems).toContain(`missing file: ${missing}`);
      expect(result.blockedSuites).toContain('(test scope incomplete)');
    },
  );
  it('lists every skipped test and blocks a required suite unless SFP_ALLOW_SKIP names it', () => {
    const blocked = testSkipCensus(sample, { serviceRoot, allowed: new Set() });
    expect(blocked.skipped).toEqual([
      {
        file: 'packages/cli/test/browser-observation.test.ts',
        test: 'observes the editor',
        status: 'skipped',
        suite: 'chrome',
      },
      {
        file: 'packages/mcp/test/fs/workspace-policy.test.ts',
        test: 'rejects NUL on Windows',
        status: 'skipped',
        suite: null,
      },
      {
        file: 'packages/mcp/test/portal/native-artifacts.test.ts',
        test: 'opt-in Vite build',
        status: 'todo',
        suite: null,
      },
    ]);
    expect(blocked.blockedSuites).toEqual(['chrome']);

    const allowed = testSkipCensus(sample, { serviceRoot, allowed: allowedSkipSuites('chrome') });
    expect(allowed.blockedSuites).toEqual([]);
    expect(allowed.allowedSuites).toEqual(['chrome']);
    expect(allowed.skipped).toHaveLength(3);
  });

  it('can forbid every skip for runs whose tests must all execute', () => {
    const census = testSkipCensus(sample, {
      serviceRoot,
      allowed: new Set(['chrome']),
      forbidSkips: true,
    });
    expect(census.blockedSuites).toEqual(['(any skipped test)']);
  });

  it('parses SFP_ALLOW_SKIP as a comma or space separated list', () => {
    expect([...allowedSkipSuites(' chrome, other  third ')]).toEqual(['chrome', 'other', 'third']);
    expect(allowedSkipSuites(undefined).size).toBe(0);
  });

  it('keeps the required-suite registry in step with the tests that launch Chrome', async () => {
    const chrome = REQUIRED_SUITES.find(suite => suite.id === 'chrome');
    expect(chrome).toBeDefined();
    const testFiles = await readdir(join(serviceRoot, 'packages'), {
      recursive: true,
      withFileTypes: true,
    });
    const launchers: string[] = [];
    for (const entry of testFiles) {
      const path = join(entry.parentPath, entry.name);
      if (!entry.isFile() || !entry.name.endsWith('.test.ts') || /node_modules/u.test(path))
        continue;
      if (
        /\bchromium\.launch(?:PersistentContext)?\s*\(|\bassertNativePortalPreview\s*\(|chromeExecutable:\s*googleChromeExecutable\s*\(/u.test(
          await readFile(path, 'utf8'),
        )
      )
        launchers.push(relative(serviceRoot, path).replaceAll('\\', '/'));
    }
    expect(launchers.toSorted()).toEqual([...chrome!.files].toSorted());
    const guarded = await Promise.all(
      chrome!.files.map(async file => ({
        file,
        guarded: /requireChrome\(/u.test(await readFile(join(serviceRoot, file), 'utf8')),
      })),
    );
    expect(guarded).toEqual(chrome!.files.map(file => ({ file, guarded: true })));
  });

  it('fails the command line on a blocked required suite and passes when it is allowed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-skip-census-'));
    roots.push(root);
    const path = join(root, 'vitest-report.json');
    await writeFile(
      path,
      JSON.stringify(
        report({
          'packages/cli/test/browser-observation.test.ts': [
            ['observes the editor', 'skipped'],
            ['reads layers', 'passed'],
          ],
        }),
      ),
    );
    const scopePath = join(root, 'scope.json');
    await writeFile(
      scopePath,
      JSON.stringify({
        ...fullScope,
        mode: 'focused',
        sourceHash: await sourceFingerprint(serviceRoot),
        command: ['pnpm', 'exec', 'vitest', 'run', 'packages/cli/test/browser-observation.test.ts'],
        toolchain: {
          node: process.version,
          nodeSha256: createHash('sha256')
            .update(await readFile(process.execPath))
            .digest('hex'),
          pnpmSha256: createHash('sha256')
            .update(await readFile(resolvePnpmEntry()))
            .digest('hex'),
        },
        files: [
          {
            path: 'packages/cli/test/browser-observation.test.ts',
            tests: ['observes the editor', 'reads layers'],
          },
        ],
      }),
    );
    const run = (allow: string) =>
      spawnSync(
        process.execPath,
        [script, path, '--scope', scopePath, '--out', join(root, 'census.json')],
        {
          cwd: serviceRoot,
          encoding: 'utf8',
          env: { ...process.env, SFP_ALLOW_SKIP: allow },
          windowsHide: true,
        },
      );

    const blocked = run('');
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain('REQUIRED_SUITE_SKIPPED: chrome');
    expect(blocked.stdout).toContain('packages/cli/test/browser-observation.test.ts');

    const allowed = run('chrome');
    expect({ status: allowed.status, stderr: allowed.stderr }).toEqual({ status: 0, stderr: '' });
    const written = JSON.parse(await readFile(join(root, 'census.json'), 'utf8'));
    expect(written).toMatchObject({ allowedSuites: ['chrome'], blockedSuites: [] });
  });
});
