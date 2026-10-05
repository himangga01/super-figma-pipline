import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, expect, it } from 'vitest';

import { hermeticGitEnvironment, spawnHermeticGit } from '../scripts/hermetic-git.mjs';
import { REQUIRED_SUITES } from '../scripts/test-skip-census.mjs';

const serviceRoot = resolve(import.meta.dirname, '..');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it.each(['typecheck', 'artifacts', 'source-change', 'scope-change'])(
  'publishes current failure for %s while preserving the successful attempt and its logs',
  async failure => {
    const repository = await mkdtemp(join(tmpdir(), 'sfp-source-attempt-'));
    roots.push(repository);
    const service = join(repository, 'service');
    await mkdir(join(service, 'test'), { recursive: true });
    await cp(join(serviceRoot, 'scripts'), join(service, 'scripts'), { recursive: true });
    await symlink(
      join(serviceRoot, 'node_modules'),
      join(service, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await writeFile(join(repository, '.gitignore'), 'service/artifacts/\nservice/node_modules/\n');
    await writeFile(
      join(service, 'package.json'),
      JSON.stringify({
        scripts: { test: 'vitest run --exclude "test/artifact-contents.test.ts"' },
      }),
    );
    await writeFile(
      join(service, 'test/known-failures.json'),
      JSON.stringify({ schemaVersion: 1, entries: [] }),
    );
    const fakePnpm = join(repository, 'pnpm.js');
    await writeFile(
      fakePnpm,
      '// The process boundary is substituted; no package commands execute.\n',
    );
    const files = REQUIRED_SUITES.flatMap(suite => suite.files).map(path => join(service, path));
    const preload = join(repository, 'gate-process-fixture.mjs');
    await writeFile(
      preload,
      `
      import child from 'node:child_process';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const actual = child.execFileSync;
      const files = ${JSON.stringify(files)};
      child.execFileSync = (exe, args, options) => {
        if (exe === 'git') return actual(exe, args, options);
        if (args.includes('list')) return JSON.stringify(files.map(file => args.includes('--filesOnly')
          ? { file, projectName: 'mcp' } : { file, projectName: 'mcp', name: 'required case' }));
        if (String(args[0]).includes('collect-test-registrations')) return JSON.stringify(files.map(file => ({ file, projectName: 'mcp', name: 'required case' })));
        const name = args[1] ?? args[0];
        if (process.env.FAIL_GATE && (name === process.env.FAIL_GATE || String(args[0]).includes('verify-artifacts') && process.env.FAIL_GATE === 'artifacts')) {
          const error = new Error('Controlled command exit');
          error.status = 1; error.stdout = 'attempt failed'; error.stderr = '';
          throw error;
        }
        if (name === 'test') fs.writeFileSync(options.env.SFP_VITEST_JSON_REPORT, JSON.stringify({
          testResults: files.map(name => ({ name, status: 'passed', assertionResults: [{ fullName: 'required case', title: 'required case', status: 'passed' }] }))
        }));
        if (process.env.FAIL_GATE === 'source-change' && String(args[0]).includes('smoke-packed')) fs.appendFileSync(${JSON.stringify(join(service, 'package.json'))}, '\\n');
        if (process.env.FAIL_GATE === 'scope-change' && String(args[0]).includes('smoke-packed')) {
          const current = JSON.parse(fs.readFileSync(${JSON.stringify(join(service, 'artifacts/source-checks/current.json'))}));
          fs.appendFileSync(${JSON.stringify(join(service, 'artifacts'))} + '/' + current.folder + '/test-scope.json', '\\n');
        }
        return 'controlled gate succeeded';
      };
      syncBuiltinESMExports();
    `,
    );
    spawnHermeticGit(repository, ['init']);
    spawnHermeticGit(repository, ['config', 'user.email', 'test@example.com']);
    spawnHermeticGit(repository, ['config', 'user.name', 'Test']);
    spawnHermeticGit(repository, ['add', '.']);
    spawnHermeticGit(repository, ['commit', '-m', 'fixture']);
    const run = (gate: string) =>
      spawnSync(
        process.execPath,
        ['--import', pathToFileURL(preload).href, join(service, 'scripts/run-source-checks.mjs')],
        {
          cwd: service,
          encoding: 'utf8',
          windowsHide: true,
          env: hermeticGitEnvironment({ ...process.env, npm_execpath: fakePnpm, FAIL_GATE: gate }),
        },
      );
    const first = run('');
    expect({ status: first.status, stderr: first.stderr }).toEqual({ status: 0, stderr: '' });
    const currentPath = join(service, 'artifacts/source-checks/current.json');
    const succeeded = JSON.parse(await readFile(currentPath, 'utf8').catch(() => 'null'));
    expect(succeeded).toMatchObject({ status: 'succeeded' });
    const historyPath = join(service, 'artifacts', succeeded.report);
    const history = await readFile(historyPath);
    const logPath = join(service, 'artifacts', succeeded.folder, 'typecheck.txt');
    const oldLog = await readFile(logPath);
    const second = run(failure);
    expect(second.status).toBe(1);
    const failed = JSON.parse(await readFile(currentPath, 'utf8'));
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.attemptId).not.toBe(succeeded.attemptId);
    expect(await readFile(historyPath)).toEqual(history);
    expect(await readFile(logPath)).toEqual(oldLog);
    const latest = JSON.parse(await readFile(join(service, 'artifacts', failed.report), 'utf8'));
    expect(latest).toMatchObject({ attemptId: failed.attemptId, status: 'failed' });
    expect(latest.error).toContain(
      failure === 'scope-change'
        ? 'TEST_SCOPE_CHANGED_DURING_VERIFICATION'
        : failure === 'source-change'
          ? 'SOURCE_CHANGED_DURING_VERIFICATION'
          : 'SOURCE_CHECK_FAILED',
    );
  },
);
