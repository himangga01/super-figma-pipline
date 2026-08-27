import { mkdtemp, mkdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceConfigStore } from '../../src/fs/workspace-config-store.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';
import * as workspacePolicyModule from '../../src/fs/workspace-policy.js';
import type { BoundStatePermissions } from '../../src/security/state-permissions.js';

const temporaryRoots: string[] = [];
const idleGuard = { hasUnsettled: async (): Promise<boolean> => false };

let stateRoot: string;
let workspaceRoot: string;
let workspaceId: string;

const testPermissions = (root: string): BoundStatePermissions => ({
  stateRoot: resolve(root),
  ensureSecure: async () => undefined,
  verifySecure: async () => undefined,
  inspectSecure: async path => {
    const metadata = await stat(path, { bigint: true });
    return {
      canonicalPath: await realpath(path),
      key: `${metadata.dev}:${metadata.ino}:${metadata.birthtimeNs}`,
      directory: metadata.isDirectory(),
      file: metadata.isFile(),
    };
  },
});

const workspaceStore = (root: string = stateRoot) =>
  createWorkspaceConfigStore(root, idleGuard, testPermissions(root));

const temporaryRoot = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

beforeEach(async () => {
  const root = await temporaryRoot('sfp-task4-policy-');
  stateRoot = join(root, 'state');
  workspaceRoot = join(root, 'workspace');
  await mkdir(stateRoot);
  await mkdir(join(workspaceRoot, 'src'), { recursive: true });
  const store = workspaceStore();
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
    await mkdir(emptyState);
    const store = workspaceStore(emptyState);
    const policy = createWorkspacePolicy(store);

    await expect(policy.resolveRead('missing-workspace', 'src')).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_CONFIGURED',
    });
    expect(await store.list()).toEqual([]);
  });

  it('does not retain a workspace after explicit removal', async () => {
    const store = workspaceStore();
    const policy = createWorkspacePolicy(store);
    await store.remove('actor', workspaceId);

    await expect(policy.resolveRead(workspaceId, 'src')).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_CONFIGURED',
    });
  });
});

describe('platform boundary inspection', () => {
  it('rejects replacement of a descendant during platform boundary inspection', async () => {
    const file = join(workspaceRoot, 'src', 'inside.ts');
    const moved = `${file}.original`;
    await writeFile(file, 'original');
    let replaced = false;
    const boundaryInspector = {
      assertSafe: async (): Promise<void> => {
        if (!replaced) {
          replaced = true;
          await rename(file, moved);
          await writeFile(file, 'replacement');
        }
      },
    };
    const policy = createWorkspacePolicy(workspaceStore(), { boundaryInspector });

    await expect(policy.resolveRead(workspaceId, join('src', 'inside.ts'))).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_REPARSE',
    });
  });

  it('fails closed when the injected platform boundary probe fails', async () => {
    const file = join(workspaceRoot, 'src', 'inside.ts');
    await writeFile(file, 'export {};');
    const boundaryInspector = {
      assertSafe: vi.fn<() => Promise<void>>().mockRejectedValue(
        Object.assign(new Error('probe unavailable'), {
          code: 'WORKSPACE_BOUNDARY_UNAVAILABLE',
        }),
      ),
    };
    const policy = createWorkspacePolicy(workspaceStore(), {
      boundaryInspector,
    });

    await expect(policy.resolveRead(workspaceId, join('src', 'inside.ts'))).rejects.toMatchObject({
      code: 'WORKSPACE_BOUNDARY_UNAVAILABLE',
    });
  });

  it('rejects a same-device Linux bind mount nested below the approved root', async () => {
    const createLinuxBoundaryInspector = (
      workspacePolicyModule as unknown as {
        createLinuxBoundaryInspector: (options: { readMountInfo: () => Promise<string> }) => {
          assertSafe: (root: string, paths: readonly string[]) => Promise<void>;
        };
      }
    ).createLinuxBoundaryInspector;
    const inspector = createLinuxBoundaryInspector?.({
      readMountInfo: async () =>
        [
          '36 25 0:32 / /approved rw,relatime - ext4 /dev/root rw',
          '37 36 0:32 /source /approved/nested rw,relatime - ext4 /dev/root rw',
        ].join('\n'),
    });

    await expect(
      inspector?.assertSafe('/approved', ['/approved', '/approved/nested']),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_REPARSE' });
  });

  it('rejects a Windows reparse-point record from the platform probe', async () => {
    const createWindowsBoundaryInspector = (
      workspacePolicyModule as unknown as {
        createWindowsBoundaryInspector: (
          command: (
            file: string,
            args: readonly string[],
            options?: { environment?: Readonly<Record<string, string>> },
          ) => Promise<{ stdout: string; stderr: string }>,
        ) => {
          assertSafe: (root: string, paths: readonly string[]) => Promise<void>;
        };
      }
    ).createWindowsBoundaryInspector;
    const inspector = createWindowsBoundaryInspector?.(async () => ({
      stdout: JSON.stringify([
        { path: 'C:\\approved', attributes: 16 },
        { path: 'C:\\approved\\linked', attributes: 16 | 0x400 },
      ]),
      stderr: '',
    }));

    await expect(
      inspector?.assertSafe('C:\\approved', ['C:\\approved', 'C:\\approved\\linked']),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_REPARSE' });
  });

  it('maps Windows platform command failure to a fail-closed boundary error', async () => {
    const createWindowsBoundaryInspector = (
      workspacePolicyModule as unknown as {
        createWindowsBoundaryInspector: (command: () => Promise<never>) => {
          assertSafe: (root: string, paths: readonly string[]) => Promise<void>;
        };
      }
    ).createWindowsBoundaryInspector;
    const inspector = createWindowsBoundaryInspector(async () => {
      throw new Error('PowerShell unavailable');
    });

    await expect(inspector.assertSafe('C:\\approved', ['C:\\approved'])).rejects.toMatchObject({
      code: 'WORKSPACE_BOUNDARY_UNAVAILABLE',
    });
  });

  it('fails closed when Linux mountinfo cannot be read', async () => {
    const createLinuxBoundaryInspector = (
      workspacePolicyModule as unknown as {
        createLinuxBoundaryInspector: (options: { readMountInfo: () => Promise<string> }) => {
          assertSafe: (root: string, paths: readonly string[]) => Promise<void>;
        };
      }
    ).createLinuxBoundaryInspector;
    const inspector = createLinuxBoundaryInspector({
      readMountInfo: async () => {
        throw new Error('mountinfo unavailable');
      },
    });

    await expect(inspector.assertSafe('/approved', ['/approved'])).rejects.toMatchObject({
      code: 'WORKSPACE_BOUNDARY_UNAVAILABLE',
    });
  });

  it('fails closed on an unsupported platform inspector', async () => {
    const file = join(workspaceRoot, 'src', 'unsupported.ts');
    await writeFile(file, 'export {};');
    const policy = createWorkspacePolicy(workspaceStore(), { platform: 'aix' });

    await expect(policy.resolveRead(workspaceId, file)).rejects.toMatchObject({
      code: 'WORKSPACE_BOUNDARY_UNAVAILABLE',
    });
  });
});

describe('read resolution', () => {
  it('returns the real path of an existing descendant', async () => {
    const file = join(workspaceRoot, 'src', 'inside.ts');
    await writeFile(file, 'export {};');
    const policy = createWorkspacePolicy(workspaceStore());

    await expect(policy.resolveRead(workspaceId, join('src', 'inside.ts'))).resolves.toBe(
      await realpath(file),
    );
  });

  it('rejects a lexical parent traversal even when normalization would return inside', async () => {
    const file = join(workspaceRoot, 'inside.ts');
    await writeFile(file, 'export {};');
    const policy = createWorkspacePolicy(workspaceStore());

    await expect(
      policy.resolveRead(workspaceId, ['src', '..', 'inside.ts'].join(sep)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_ESCAPE' });
  });

  it('rejects an absolute path outside the configured root', async () => {
    const outside = join(dirname(workspaceRoot), 'outside.ts');
    await writeFile(outside, 'outside');
    const policy = createWorkspacePolicy(workspaceStore());

    await expect(policy.resolveRead(workspaceId, outside)).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_ESCAPE',
    });
  });

  it('rejects the alternate platform separator', async () => {
    const policy = createWorkspacePolicy(workspaceStore());
    const input = process.platform === 'win32' ? 'src/inside.ts' : 'src\\inside.ts';

    await expect(policy.resolveRead(workspaceId, input)).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_INVALID',
    });
  });

  it('rejects a missing read target', async () => {
    const policy = createWorkspacePolicy(workspaceStore());

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
    const policy = createWorkspacePolicy(workspaceStore());

    await expect(
      policy.resolveRead(workspaceId, join('escape', 'secret.txt')),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_ESCAPE' });
  });
});

describe('write resolution', () => {
  it.each(['NUL', 'nul.txt', 'COM¹.log', 'LPT²'])(
    'rejects the Windows reserved device basename %s',
    async deviceName => {
      if (process.platform !== 'win32') return;
      const policy = createWorkspacePolicy(workspaceStore(), {
        boundaryInspector: { assertSafe: async () => undefined },
      });

      await expect(policy.resolveWrite(workspaceId, join('src', deviceName))).rejects.toMatchObject(
        { code: 'WORKSPACE_PATH_INVALID' },
      );
    },
  );

  it('rejects an existing directory as a file overwrite target', async () => {
    const directory = join(workspaceRoot, 'src', 'output-dir');
    await mkdir(directory);
    const policy = createWorkspacePolicy(workspaceStore(), {
      boundaryInspector: { assertSafe: async () => undefined },
    });

    await expect(policy.resolveWrite(workspaceId, directory)).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_INVALID',
    });
  });

  it('returns overwrites false for a new path below the nearest existing parent', async () => {
    const policy = createWorkspacePolicy(workspaceStore());
    const input = join('src', 'new', 'deep', 'output.json');

    await expect(policy.resolveWrite(workspaceId, input)).resolves.toEqual({
      path: resolve(workspaceRoot, input),
      overwrites: false,
    });
  });

  it('returns overwrites true for an existing regular file', async () => {
    const file = join(workspaceRoot, 'src', 'output.json');
    await writeFile(file, '{}');
    const policy = createWorkspacePolicy(workspaceStore());

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
    const policy = createWorkspacePolicy(workspaceStore());

    await expect(
      policy.resolveWrite(workspaceId, join('linked', 'new.json')),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_REPARSE',
    });
  });

  it('rejects a write outside the configured root', async () => {
    const policy = createWorkspacePolicy(workspaceStore());

    await expect(
      policy.resolveWrite(workspaceId, join(dirname(workspaceRoot), 'outside.json')),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_ESCAPE' });
  });

  it.runIf(process.platform === 'win32')('rejects a case-folded Windows escape', async () => {
    const policy = createWorkspacePolicy(workspaceStore());
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
      const policy = createWorkspacePolicy(workspaceStore());

      await expect(
        policy.resolveWrite(workspaceId, join('src', 'output.json.')),
      ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_INVALID' });
    },
  );
});

describe('generic containment assertion', () => {
  it('runs the platform boundary inspector when the candidate is the workspace root', async () => {
    const boundaryInspector = {
      assertSafe: vi
        .fn<() => Promise<void>>()
        .mockRejectedValue(
          Object.assign(new Error('root boundary'), { code: 'WORKSPACE_PATH_REPARSE' }),
        ),
    };
    const policy = createWorkspacePolicy(workspaceStore(), { boundaryInspector });

    await expect(policy.assertWithinRoot(workspaceId, workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_REPARSE',
    });
  });

  it('rejects the workspace root after it is deleted', async () => {
    const policy = createWorkspacePolicy(workspaceStore(), {
      boundaryInspector: { assertSafe: async () => undefined },
    });
    await rm(workspaceRoot, { recursive: true });

    await expect(policy.assertWithinRoot(workspaceId, workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE_ROOT_UNAVAILABLE',
    });
  });

  it('rejects replacement of a previously validated workspace root', async () => {
    const policy = createWorkspacePolicy(workspaceStore(), {
      boundaryInspector: { assertSafe: async () => undefined },
    });
    await policy.assertWithinRoot(workspaceId, workspaceRoot);
    const moved = `${workspaceRoot}-original`;
    await rename(workspaceRoot, moved);
    await mkdir(workspaceRoot);

    await expect(policy.assertWithinRoot(workspaceId, workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE_ROOT_UNAVAILABLE',
    });
  });

  it('rejects replacement of the workspace root with a junction or symlink', async () => {
    const policy = createWorkspacePolicy(workspaceStore(), {
      boundaryInspector: { assertSafe: async () => undefined },
    });
    await policy.assertWithinRoot(workspaceId, workspaceRoot);
    const moved = `${workspaceRoot}-link-target`;
    await rename(workspaceRoot, moved);
    await symlink(moved, workspaceRoot, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(policy.assertWithinRoot(workspaceId, workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE_ROOT_UNAVAILABLE',
    });
  });

  it('validates a missing root before rejecting the root as a write target', async () => {
    const policy = createWorkspacePolicy(workspaceStore(), {
      boundaryInspector: { assertSafe: async () => undefined },
    });
    await rm(workspaceRoot, { recursive: true });

    await expect(policy.resolveWrite(workspaceId, workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE_ROOT_UNAVAILABLE',
    });
  });

  it('accepts existing and new descendants but rejects an outside path', async () => {
    const existing = join(workspaceRoot, 'src', 'inside.ts');
    await writeFile(existing, 'export {};');
    const policy = createWorkspacePolicy(workspaceStore());

    await expect(policy.assertWithinRoot(workspaceId, existing)).resolves.toBeUndefined();
    await expect(
      policy.assertWithinRoot(workspaceId, join(workspaceRoot, 'src', 'new.ts')),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertWithinRoot(workspaceId, join(dirname(workspaceRoot), 'outside.ts')),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_ESCAPE' });
  });

  it.runIf(process.platform === 'win32')(
    'rejects an existing in-root Windows link as a reparse point',
    async () => {
      const target = join(workspaceRoot, 'src', 'target');
      const linked = join(workspaceRoot, 'linked-inside');
      await mkdir(target);
      await symlink(target, linked, 'junction');
      const policy = createWorkspacePolicy(workspaceStore());

      await expect(policy.assertWithinRoot(workspaceId, linked)).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_REPARSE',
      });
    },
  );

  it.runIf(process.platform !== 'win32')(
    'accepts an existing Unix link whose real path remains inside the workspace',
    async () => {
      const target = join(workspaceRoot, 'src', 'target');
      const linked = join(workspaceRoot, 'linked-inside');
      await mkdir(target);
      await symlink(target, linked, 'dir');
      const policy = createWorkspacePolicy(workspaceStore());

      await expect(policy.assertWithinRoot(workspaceId, linked)).resolves.toBeUndefined();
    },
  );
});
