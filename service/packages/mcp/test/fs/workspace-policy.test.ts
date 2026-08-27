import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWorkspaceConfigStore } from '../../src/fs/workspace-config-store.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';

const temporaryRoots: string[] = [];
const idleGuard = { hasUnsettled: async (): Promise<boolean> => false };

let stateRoot: string;
let workspaceRoot: string;
let workspaceId: string;

const temporaryRoot = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

beforeEach(async () => {
  const root = await temporaryRoot('sfp-task4-policy-');
  stateRoot = join(root, 'state');
  workspaceRoot = join(root, 'workspace');
  await mkdir(join(workspaceRoot, 'src'), { recursive: true });
  const store = createWorkspaceConfigStore(stateRoot, idleGuard);
  workspaceId = (await store.add('actor', workspaceRoot)).workspaceId;
});

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp)) {
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe('configured workspace authority', () => {
  it('does not treat a tool rootDir as workspace registration', async () => {
    const emptyState = join(await temporaryRoot('sfp-task4-empty-policy-'), 'state');
    const store = createWorkspaceConfigStore(emptyState, idleGuard);
    const policy = createWorkspacePolicy(store);

    await expect(policy.resolveRead('missing-workspace', 'src')).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_CONFIGURED',
    });
    expect(await store.list()).toEqual([]);
  });

  it('does not retain a workspace after explicit removal', async () => {
    const store = createWorkspaceConfigStore(stateRoot, idleGuard);
    const policy = createWorkspacePolicy(store);
    await store.remove('actor', workspaceId);

    await expect(policy.resolveRead(workspaceId, 'src')).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_CONFIGURED',
    });
  });
});

describe('read resolution', () => {
  it('returns the real path of an existing descendant', async () => {
    const file = join(workspaceRoot, 'src', 'inside.ts');
    await writeFile(file, 'export {};');
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(policy.resolveRead(workspaceId, join('src', 'inside.ts'))).resolves.toBe(
      await realpath(file),
    );
  });

  it('rejects a lexical parent traversal even when normalization would return inside', async () => {
    const file = join(workspaceRoot, 'inside.ts');
    await writeFile(file, 'export {};');
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(
      policy.resolveRead(workspaceId, ['src', '..', 'inside.ts'].join(sep)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_ESCAPE' });
  });

  it('rejects an absolute path outside the configured root', async () => {
    const outside = join(dirname(workspaceRoot), 'outside.ts');
    await writeFile(outside, 'outside');
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(policy.resolveRead(workspaceId, outside)).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_ESCAPE',
    });
  });

  it('rejects the alternate platform separator', async () => {
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));
    const input = process.platform === 'win32' ? 'src/inside.ts' : 'src\\inside.ts';

    await expect(policy.resolveRead(workspaceId, input)).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_INVALID',
    });
  });

  it('rejects a missing read target', async () => {
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(policy.resolveRead(workspaceId, join('src', 'missing.ts'))).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_NOT_FOUND',
    });
  });

  it('rejects an existing junction or symlink escape', async () => {
    const outside = join(dirname(workspaceRoot), 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(
      outside,
      join(workspaceRoot, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(
      policy.resolveRead(workspaceId, join('escape', 'secret.txt')),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_ESCAPE' });
  });
});

describe('write resolution', () => {
  it('returns overwrites false for a new path below the nearest existing parent', async () => {
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));
    const input = join('src', 'new', 'deep', 'output.json');

    await expect(policy.resolveWrite(workspaceId, input)).resolves.toEqual({
      path: resolve(workspaceRoot, input),
      overwrites: false,
    });
  });

  it('returns overwrites true for an existing regular file', async () => {
    const file = join(workspaceRoot, 'src', 'output.json');
    await writeFile(file, '{}');
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(policy.resolveWrite(workspaceId, join('src', 'output.json'))).resolves.toEqual({
      path: await realpath(file),
      overwrites: true,
    });
  });

  it('rejects a new output reached through a junction or symbolic link', async () => {
    const target = join(workspaceRoot, 'src', 'target');
    await mkdir(target);
    await symlink(
      target,
      join(workspaceRoot, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(
      policy.resolveWrite(workspaceId, join('linked', 'new.json')),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_REPARSE',
    });
  });

  it('rejects a write outside the configured root', async () => {
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(
      policy.resolveWrite(workspaceId, join(dirname(workspaceRoot), 'outside.json')),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_ESCAPE' });
  });

  it.runIf(process.platform === 'win32')('rejects a case-folded Windows escape', async () => {
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));
    const sibling = join(
      dirname(workspaceRoot),
      `${basename(workspaceRoot)}-outside`,
      'output.json',
    ).toUpperCase();

    await expect(policy.resolveWrite(workspaceId, sibling)).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_ESCAPE',
    });
  });

  it.runIf(process.platform === 'win32')(
    'rejects a trailing-dot alias before it can hide an overwrite',
    async () => {
      await writeFile(join(workspaceRoot, 'src', 'output.json'), '{}');
      const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

      await expect(
        policy.resolveWrite(workspaceId, join('src', 'output.json.')),
      ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_INVALID' });
    },
  );
});

describe('generic containment assertion', () => {
  it('accepts existing and new descendants but rejects an outside path', async () => {
    const existing = join(workspaceRoot, 'src', 'inside.ts');
    await writeFile(existing, 'export {};');
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(policy.assertWithinRoot(workspaceId, existing)).resolves.toBeUndefined();
    await expect(
      policy.assertWithinRoot(workspaceId, join(workspaceRoot, 'src', 'new.ts')),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertWithinRoot(workspaceId, join(dirname(workspaceRoot), 'outside.ts')),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_ESCAPE' });
  });

  it('accepts an existing link only when its real path remains inside the workspace', async () => {
    const target = join(workspaceRoot, 'src', 'target');
    const linked = join(workspaceRoot, 'linked-inside');
    await mkdir(target);
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const policy = createWorkspacePolicy(createWorkspaceConfigStore(stateRoot, idleGuard));

    await expect(policy.assertWithinRoot(workspaceId, linked)).resolves.toBeUndefined();
  });
});
