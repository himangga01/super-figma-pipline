import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, it } from 'vitest';

it('independently declares skipped, todo and runnable registrations without executing test bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-scope-collection-'));
  const service = join(root, 'service');
  const source = resolve(import.meta.dirname, '..');
  try {
    await cp(join(source, 'scripts'), join(service, 'scripts'), { recursive: true });
    await symlink(
      join(source, 'node_modules'),
      join(service, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await writeFile(join(service, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(
      join(service, 'vitest.config.js'),
      'export default { test: { include: ["fixture.test.ts"] } };',
    );
    await writeFile(
      join(service, 'fixture.test.ts'),
      `
      import { describe, it } from 'vitest';
      const effect = () => { throw new Error('TEST_BODY_EXECUTED_DURING_COLLECTION'); };
      it('runnable', effect);
      it.skip('explicit skip', effect);
      it.todo('todo');
      describe.skip('skipped parent', () => it('child', effect));
      it('dynamic skip', ctx => { ctx.skip(); effect(); });
    `,
    );
    await writeFile(join(root, '.gitignore'), 'service/node_modules/\n');
    execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
    const output = join(root, 'scope.json');
    execFileSync(
      process.execPath,
      [
        join(service, 'scripts/declare-test-scope.mjs'),
        '--file',
        'fixture.test.ts',
        '--out',
        output,
      ],
      {
        cwd: service,
        windowsHide: true,
        env: { ...process.env, SFP_VITEST_JSON_REPORT: '' },
      },
    );
    const scope = JSON.parse(await readFile(output, 'utf8'));
    expect(scope.files).toEqual([
      {
        path: 'fixture.test.ts',
        tests: ['runnable', 'explicit skip', 'todo', 'skipped parent > child', 'dynamic skip'],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
