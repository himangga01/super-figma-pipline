import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { createWorkspaceConfigStore } from '../../src/fs/workspace-config-store.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';
import { fixturePermissions } from '../portal/fixtures.js';

/*
 * T06a characterization of finding LC-2 (remediation plan section 3.1). The fix is task T08.
 *
 * LC-2: every read of the workspace config revalidates all registered rows and throws
 * WORKSPACE_ROOT_IDENTITY_CHANGED as soon as one row fails (revalidateRows in
 * mcp/src/fs/workspace-config-store.ts:414-458, reached from readConfig at 488). Deleting one
 * registered workspace therefore breaks `list`, `getDefault`, `add` and `remove` for every
 * workspace, and the workspace policy turns the failure into WORKSPACE_ROOT_UNAVAILABLE for tools
 * on the unaffected workspace. After T08 validates rows individually, the tests on workspace B and
 * on `remove A` must be flipped.
 */
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp))
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    await rm(root, { recursive: true, force: true });
  }
});
const idleGuard = { hasUnsettled: async (): Promise<boolean> => false };

it('LC-2 characterization: deleting registered workspace A makes the store throw WORKSPACE_ROOT_IDENTITY_CHANGED for workspace B too (flip in T08)', async () => {
  // LC-2, fixed by T08. Seam: the real workspace config store on a temporary state root and the
  // real workspace policy over it. Boundary inspection is replaced by a no-op because it is not
  // on the failing path and would start a PowerShell probe on Windows.
  const root = await mkdtemp(join(tmpdir(), 'sfp-lc2-characterization-'));
  roots.push(root);
  const stateRoot = join(root, 'state'),
    workspaceA = join(root, 'workspace-a'),
    workspaceB = join(root, 'workspace-b'),
    workspaceC = join(root, 'workspace-c');
  for (const path of [stateRoot, workspaceA, workspaceB, workspaceC]) await mkdir(path);
  await writeFile(join(workspaceB, 'package.json'), '{"name":"workspace-b"}');
  const store = createWorkspaceConfigStore(stateRoot, idleGuard, fixturePermissions(stateRoot));
  const a = await store.add('actor', workspaceA);
  const b = await store.add('actor', workspaceB);
  await store.setDefault('actor', b.workspaceId);
  const policy = createWorkspacePolicy(store, {
    boundaryInspector: { assertSafe: async () => undefined },
  });
  // Before: both registrations are listed and tools resolve workspace B.
  expect((await store.list()).map(workspace => workspace.workspaceId)).toEqual([
    a.workspaceId,
    b.workspaceId,
  ]);
  await expect(policy.resolveRoot!(b.workspaceId)).resolves.toBe(await realpath(workspaceB));
  await expect(policy.resolveRead(b.workspaceId, 'package.json')).resolves.toBe(
    join(await realpath(workspaceB), 'package.json'),
  );

  await rm(workspaceA, { recursive: true, force: true });

  // Current behavior: one unavailable row fails every configuration read.
  const identityChanged = { code: 'WORKSPACE_ROOT_IDENTITY_CHANGED' };
  await expect(store.list()).rejects.toMatchObject(identityChanged);
  await expect(store.getDefault()).rejects.toMatchObject(identityChanged);
  // Tools on the untouched workspace B fail.
  await expect(policy.resolveRoot!(b.workspaceId)).rejects.toMatchObject({
    code: 'WORKSPACE_ROOT_UNAVAILABLE',
    cause: identityChanged,
  });
  await expect(policy.resolveRead(b.workspaceId, 'package.json')).rejects.toMatchObject({
    code: 'WORKSPACE_ROOT_UNAVAILABLE',
    cause: identityChanged,
  });
  // The recovery path is wedged too: A cannot be removed and no workspace can be added.
  await expect(store.remove('actor', a.workspaceId)).rejects.toMatchObject(identityChanged);
  await expect(store.add('actor', workspaceC)).rejects.toMatchObject(identityChanged);
  // The failure is persistent: a restarted store over the same state root fails the same way.
  const restarted = createWorkspaceConfigStore(stateRoot, idleGuard, fixturePermissions(stateRoot));
  await expect(restarted.list()).rejects.toMatchObject(identityChanged);
});
