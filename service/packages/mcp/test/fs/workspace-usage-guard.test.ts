import { mkdtemp, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { createWorkspaceConfigStore } from '../../src/fs/workspace-config-store.js';
import type { BoundStatePermissions } from '../../src/security/state-permissions.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp)) {
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    }
    await rm(root, { recursive: true, force: true });
  }
});

it('delegates removal safety to the injected usage guard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-task4-usage-'));
  temporaryRoots.push(root);
  const stateRoot = join(root, 'state');
  const workspacePath = join(root, 'workspace');
  await mkdir(stateRoot);
  await mkdir(workspacePath);
  const permissions: BoundStatePermissions = {
    stateRoot,
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
  };
  const unguardedStore = createWorkspaceConfigStore(
    stateRoot,
    {
      hasUnsettled: async () => false,
    },
    permissions,
  );
  const { workspaceId } = await unguardedStore.add('actor', workspacePath);
  const guard = {
    hasUnsettled: vi.fn<(workspaceId: string) => Promise<boolean>>().mockResolvedValue(true),
  };
  const guardedStore = createWorkspaceConfigStore(stateRoot, guard, permissions);

  await expect(guardedStore.remove('actor', workspaceId)).rejects.toMatchObject({
    code: 'WORKSPACE_IN_USE',
  });
  expect(guard.hasUnsettled).toHaveBeenCalledWith(workspaceId);
  expect(await guardedStore.list()).toHaveLength(1);
});
