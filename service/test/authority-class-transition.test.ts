import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const updater = resolve(import.meta.dirname, '..', 'scripts', 'update-service-forks.mjs');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const git = (root: string, ...args: string[]) =>
  spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });

describe('class-aware authority refresh', () => {
  it('refreshes service-owned source hashes without inventing service-fork lineage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-authority-class-'));
    roots.push(root);
    const service = join(root, 'service');
    const path = 'packages/mcp/src/existing.ts';
    const base = 'export const value = 1;\n';
    const changed = 'export const value = 2;\n';
    await mkdir(join(service, 'packages/mcp/src'), { recursive: true });
    await mkdir(join(service, 'capabilities/change-manifests'), { recursive: true });
    await writeFile(join(service, path), base);
    await writeFile(
      join(service, 'vendor-rules.json'),
      `${JSON.stringify({ schemaVersion: 1, upstream: 'figwright', commit: 'a'.repeat(40), copy: [], mergeDependencyManifests: [], referenceOnly: [], exclude: [path], serviceOwned: [path] }, null, 2)}\n`,
    );
    const mapText = `${JSON.stringify({ schemaVersion: 1, upstream: 'figwright', originCommit: 'a'.repeat(40), files: [] }, null, 2)}\n`;
    await writeFile(join(service, 'vendor-map.json'), mapText);
    await writeFile(
      join(service, 'upstream-lock.json'),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          vendorMap: {
            path: 'vendor-map.json',
            sha256: sha256(mapText),
            counts: { copy: 0, mergeDependencyManifest: 0, referenceOnly: 0, total: 0 },
          },
          destinationClosure: {
            managedRoots: ['packages/mcp/src'],
            serviceOwnedFiles: [{ path, sha256: sha256(base) }],
          },
          serviceForks: [],
          serviceFiles: [{ path, sha256: sha256(base) }],
          packageAuthorities: [],
          upstreams: [{ id: 'figwright', commit: 'a'.repeat(40) }],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(service, 'capabilities/change-manifests/task-7a.json'), '{}\n');
    git(root, 'init');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'base');
    await writeFile(join(service, path), changed);
    git(root, 'add', `service/${path}`);

    const result = spawnSync(
      process.execPath,
      [updater, '--slice', '7A', '--index', 'service/capabilities/change-manifests/task-7a.json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, SFP_REPOSITORY_ROOT: root } },
    );
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const lock = JSON.parse(await readFile(join(service, 'upstream-lock.json'), 'utf8'));
    expect(lock.serviceForks).toEqual([]);
    expect(lock.serviceFiles).toContainEqual({ path, sha256: sha256(changed) });
    expect(lock.destinationClosure.serviceOwnedFiles).toContainEqual({
      path,
      sha256: sha256(changed),
    });
  });
});
