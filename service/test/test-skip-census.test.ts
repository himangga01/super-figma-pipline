import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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
  it('lists every skipped test and blocks a required suite unless SFP_ALLOW_SKIP names it', () => {
    const blocked = testSkipCensus(sample, { serviceRoot, allowed: new Set() });
    expect(blocked.skipped).toEqual([
      {
        file: 'packages/cli/test/browser-observation.test.ts',
        test: 'observes the editor',
        status: 'skipped',
        suite: 'firefox',
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
    expect(blocked.blockedSuites).toEqual(['firefox']);

    const allowed = testSkipCensus(sample, { serviceRoot, allowed: allowedSkipSuites('firefox') });
    expect(allowed.blockedSuites).toEqual([]);
    expect(allowed.allowedSuites).toEqual(['firefox']);
    expect(allowed.skipped).toHaveLength(3);
  });

  it('can forbid every skip for runs whose tests must all execute', () => {
    const census = testSkipCensus(sample, {
      serviceRoot,
      allowed: new Set(['firefox']),
      forbidSkips: true,
    });
    expect(census.blockedSuites).toEqual(['(any skipped test)']);
  });

  it('parses SFP_ALLOW_SKIP as a comma or space separated list', () => {
    expect([...allowedSkipSuites(' firefox, other  third ')]).toEqual([
      'firefox',
      'other',
      'third',
    ]);
    expect(allowedSkipSuites(undefined).size).toBe(0);
  });

  it('keeps the required-suite registry in step with the tests that launch Firefox', async () => {
    const firefox = REQUIRED_SUITES.find(suite => suite.id === 'firefox');
    expect(firefox).toBeDefined();
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
        /import\s*\{[^}]*\bfirefox\b[^}]*\}\s*from\s*'playwright'/u.test(
          await readFile(path, 'utf8'),
        )
      )
        launchers.push(relative(serviceRoot, path).replaceAll('\\', '/'));
    }
    expect(launchers.toSorted()).toEqual([...firefox!.files].toSorted());
    const guarded = await Promise.all(
      firefox!.files.map(async file => ({
        file,
        guarded: /requireFirefox\(/u.test(await readFile(join(serviceRoot, file), 'utf8')),
      })),
    );
    expect(guarded).toEqual(firefox!.files.map(file => ({ file, guarded: true })));
  });

  it('fails the command line on a blocked required suite and passes when it is allowed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-skip-census-'));
    roots.push(root);
    const path = join(root, 'vitest-report.json');
    await writeFile(path, JSON.stringify(sample));
    const run = (allow: string) =>
      spawnSync(process.execPath, [script, path, '--out', join(root, 'census.json')], {
        cwd: serviceRoot,
        encoding: 'utf8',
        env: { ...process.env, SFP_ALLOW_SKIP: allow },
        windowsHide: true,
      });

    const blocked = run('');
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain('REQUIRED_SUITE_SKIPPED: firefox');
    expect(blocked.stdout).toContain('packages/cli/test/browser-observation.test.ts');

    const allowed = run('firefox');
    expect({ status: allowed.status, stderr: allowed.stderr }).toEqual({ status: 0, stderr: '' });
    const written = JSON.parse(await readFile(join(root, 'census.json'), 'utf8'));
    expect(written).toMatchObject({ allowedSuites: ['firefox'], blockedSuites: [] });
  });
});
