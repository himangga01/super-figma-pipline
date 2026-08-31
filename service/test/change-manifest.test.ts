import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '..', 'scripts', 'verify-staged-change-manifest.mjs');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const git = (root: string, ...args: string[]) =>
  spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });

describe('closed staged change manifest', () => {
  it('writes index-blob rows, verifies the exact union, and rejects an unstaged service edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-change-manifest-'));
    roots.push(root);
    // The first 7A write creates the change-manifests directory; callers do not pre-scaffold it.
    await mkdir(join(root, 'service/capabilities'), { recursive: true });
    await writeFile(
      join(root, 'service/capabilities/task-7a-authority-classes.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slice: '7A',
          allowedPaths: [
            'service/capabilities/change-manifests/task-7a.json',
            'service/example.ts',
            'service/upstream-lock.json',
            'service/vendor-map.json',
            'service/vendor-rules.json',
          ],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(root, 'service/example.ts'), 'export const value = 1;\n');
    await writeFile(join(root, 'service/vendor-rules.json'), '{}\n');
    await writeFile(join(root, 'service/vendor-map.json'), '{}\n');
    await writeFile(join(root, 'service/upstream-lock.json'), '{}\n');
    git(root, 'init');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'base');
    await writeFile(join(root, 'service/example.ts'), 'export const value = 2;\n');
    await writeFile(join(root, 'service/vendor-rules.json'), '{"changed":true}\n');
    await writeFile(join(root, 'service/vendor-map.json'), '{"changed":true}\n');
    await writeFile(join(root, 'service/upstream-lock.json'), '{"changed":true}\n');
    git(
      root,
      'add',
      'service/example.ts',
      'service/vendor-rules.json',
      'service/vendor-map.json',
      'service/upstream-lock.json',
    );
    const env = { ...process.env, SFP_REPOSITORY_ROOT: root };
    const write = spawnSync(process.execPath, [script, '--write', '--slice', '7A'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect({ status: write.status, stderr: write.stderr }).toEqual({ status: 0, stderr: '' });
    git(root, 'add', 'service/capabilities/change-manifests/task-7a.json');

    const verified = spawnSync(process.execPath, [script, '--slice', '7A'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect({ status: verified.status, stderr: verified.stderr }).toEqual({ status: 0, stderr: '' });
    await writeFile(join(root, 'service/example.ts'), 'export const value = 3;\n');
    const dirty = spawnSync(process.execPath, [script, '--slice', '7A'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain('UNSTAGED_SERVICE_CHANGE');
  });

  it('accepts an unchanged vendor-map authority but still rejects a changed unstaged one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-change-manifest-unchanged-authority-'));
    roots.push(root);
    await mkdir(join(root, 'service/capabilities/change-manifests'), { recursive: true });
    await writeFile(
      join(root, 'service/capabilities/task-7a-authority-classes.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slice: '7A',
          allowedPaths: [
            'service/capabilities/change-manifests/task-7a.json',
            'service/example.ts',
            'service/upstream-lock.json',
            'service/vendor-map.json',
            'service/vendor-rules.json',
          ],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(root, 'service/example.ts'), 'export const value = 1;\n');
    await writeFile(join(root, 'service/vendor-rules.json'), '{}\n');
    await writeFile(join(root, 'service/vendor-map.json'), '{}\n');
    await writeFile(join(root, 'service/upstream-lock.json'), '{}\n');
    git(root, 'init');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'base');
    await writeFile(join(root, 'service/example.ts'), 'export const value = 2;\n');
    await writeFile(join(root, 'service/vendor-rules.json'), '{"changed":true}\n');
    await writeFile(join(root, 'service/upstream-lock.json'), '{"changed":true}\n');
    git(
      root,
      'add',
      'service/example.ts',
      'service/vendor-rules.json',
      'service/upstream-lock.json',
    );
    const manifestPath = join(root, 'service/capabilities/change-manifests/task-7a.json');
    await writeFile(
      manifestPath,
      `${JSON.stringify({ schemaVersion: 1, slice: '7A', authorityPaths: [], changes: [] })}\n`,
    );
    const env = { ...process.env, SFP_REPOSITORY_ROOT: root };
    const written = spawnSync(process.execPath, [script, '--write', '--slice', '7A'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect({ status: written.status, stderr: written.stderr }).toEqual({ status: 0, stderr: '' });
    git(root, 'add', 'service/capabilities/change-manifests/task-7a.json');

    const verified = spawnSync(process.execPath, [script, '--slice', '7A'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect({ status: verified.status, stderr: verified.stderr }).toEqual({ status: 0, stderr: '' });

    await writeFile(join(root, 'service/vendor-map.json'), '{"changed-but-unstaged":true}\n');
    const dirty = spawnSync(process.execPath, [script, '--slice', '7A'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain('UNSTAGED_SERVICE_CHANGE');
  });

  it('preserves and verifies explicit UTF-8-sorted D+A move pairs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-change-manifest-move-'));
    roots.push(root);
    const oldPath = 'service/packages/mcp/src/old.ts';
    const newPath = 'service/packages/mcp/src/new.ts';
    const manifestPath = join(root, 'service/capabilities/change-manifests/task-7a.json');
    await mkdir(join(root, 'service/capabilities/change-manifests'), { recursive: true });
    await mkdir(join(root, 'service/packages/mcp/src'), { recursive: true });
    await writeFile(
      join(root, 'service/capabilities/task-7a-authority-classes.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slice: '7A',
          allowedPaths: [
            'service/capabilities/change-manifests/task-7a.json',
            newPath,
            oldPath,
            'service/upstream-lock.json',
            'service/vendor-map.json',
            'service/vendor-rules.json',
          ].toSorted(),
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(root, oldPath), 'export const oldValue = 1;\n');
    await writeFile(join(root, 'service/vendor-rules.json'), '{}\n');
    await writeFile(join(root, 'service/vendor-map.json'), '{}\n');
    await writeFile(join(root, 'service/upstream-lock.json'), '{}\n');
    git(root, 'init');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'base');
    expect(git(root, 'mv', oldPath, newPath).status).toBe(0);
    await writeFile(join(root, newPath), 'export const newValue = 2;\n');
    git(root, 'add', newPath);
    for (const authority of ['vendor-rules.json', 'vendor-map.json', 'upstream-lock.json']) {
      await writeFile(join(root, 'service', authority), '{"changed":true}\n');
      git(root, 'add', `service/${authority}`);
    }
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slice: '7A',
          authorityPaths: [],
          changes: [],
          movePairs: [{ oldPath, newPath }],
        },
        null,
        2,
      )}\n`,
    );
    const env = { ...process.env, SFP_REPOSITORY_ROOT: root };

    const written = spawnSync(process.execPath, [script, '--write', '--slice', '7A'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect({ status: written.status, stderr: written.stderr }).toEqual({ status: 0, stderr: '' });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      movePairs?: Array<{ oldPath: string; newPath: string }>;
    };
    expect(manifest.movePairs).toEqual([{ oldPath, newPath }]);
    git(root, 'add', 'service/capabilities/change-manifests/task-7a.json');
    const verified = spawnSync(process.execPath, [script, '--slice', '7A'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect({ status: verified.status, stderr: verified.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
  });

  it('rejects a declared move pair when cached D+A status is incomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-change-manifest-incomplete-move-'));
    roots.push(root);
    const oldPath = 'service/old.ts';
    const newPath = 'service/new.ts';
    await mkdir(join(root, 'service/capabilities/change-manifests'), { recursive: true });
    await writeFile(
      join(root, 'service/capabilities/task-7a-authority-classes.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slice: '7A',
          allowedPaths: [
            'service/capabilities/change-manifests/task-7a.json',
            oldPath,
            newPath,
            'service/upstream-lock.json',
            'service/vendor-map.json',
            'service/vendor-rules.json',
          ].toSorted(),
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(root, oldPath), 'old\n');
    await writeFile(join(root, 'service/vendor-rules.json'), '{}\n');
    await writeFile(join(root, 'service/vendor-map.json'), '{}\n');
    await writeFile(join(root, 'service/upstream-lock.json'), '{}\n');
    git(root, 'init');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'base');
    expect(git(root, 'rm', oldPath).status).toBe(0);
    await writeFile(
      join(root, 'service/capabilities/change-manifests/task-7a.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slice: '7A',
          authorityPaths: [],
          changes: [],
          movePairs: [{ oldPath, newPath }],
        },
        null,
        2,
      )}\n`,
    );

    const result = spawnSync(process.execPath, [script, '--write', '--slice', '7A'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SFP_REPOSITORY_ROOT: root },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CHANGE_MANIFEST_MOVE_INCOMPLETE');
  });
});
