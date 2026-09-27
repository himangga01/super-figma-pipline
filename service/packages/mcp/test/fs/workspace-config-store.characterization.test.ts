import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { hashActionRequest, type ActorContext } from '@sfp/shared';
import { afterEach, expect, it } from 'vitest';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import { createWorkspaceEndpoints } from '../../src/control/workspace-endpoints.js';
import { createMcpWorkspaceBinding } from '../../src/execution/mcp-workspace-binding.js';
import {
  createWorkspaceConfigStore,
  sweepAvailableWorkspaces,
} from '../../src/fs/workspace-config-store.js';
import { createWorkspacePolicy } from '../../src/fs/workspace-policy.js';
import { fixturePermissions } from '../portal/fixtures.js';

/*
 * LC-2 regression tests (remediation plan section 3.1), flipped by task T08 from the T06a
 * characterization in this file.
 *
 * Before T08, every read of the workspace config revalidated all registered rows and threw
 * WORKSPACE_ROOT_IDENTITY_CHANGED as soon as one row failed. Deleting one registered workspace
 * broke `list`, `getDefault`, `add` and `remove` for every workspace, tools on the untouched
 * workspace failed with WORKSPACE_ROOT_UNAVAILABLE, and the leader's retention sweep, which
 * iterates `workspaceStore.list()`, failed leader startup.
 *
 * After T08, each row is validated on its own. A row that fails is listed as `unavailable` and kept
 * verbatim, the other rows keep working, and the unavailable row can be removed with an action
 * nonce.
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
const principal = Object.freeze({
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
}) satisfies Readonly<ActorContext>;

const scenario = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-lc2-regression-'));
  roots.push(root);
  const stateRoot = join(root, 'state'),
    workspaceA = join(root, 'workspace-a'),
    workspaceB = join(root, 'workspace-b'),
    workspaceC = join(root, 'workspace-c');
  for (const path of [stateRoot, workspaceA, workspaceB, workspaceC]) await mkdir(path);
  await writeFile(join(workspaceB, 'package.json'), '{"name":"workspace-b"}');
  const store = createWorkspaceConfigStore(stateRoot, idleGuard, fixturePermissions(stateRoot));
  const a = await store.add(principal.actorId, workspaceA);
  const b = await store.add(principal.actorId, workspaceB);
  return { stateRoot, workspaceA, workspaceB, workspaceC, store, a, b };
};

it('LC-2 regression (T08): deleting registered workspace A keeps workspace B usable, lists A as unavailable and removes A with a nonce', async () => {
  // Seam: the real workspace config store on a temporary state root, the real workspace policy
  // and MCP workspace binding over it, and the real workspace control endpoints with a real
  // action-nonce store. Boundary inspection is a no-op because it is not on the tested path and
  // would start a PowerShell probe on Windows.
  const { stateRoot, workspaceA, workspaceB, workspaceC, store, a, b } = await scenario();
  await store.setDefault(principal.actorId, b.workspaceId);
  const policy = createWorkspacePolicy(store, {
    boundaryInspector: { assertSafe: async () => undefined },
  });
  expect(await store.list()).toEqual([
    { ...a, availability: 'available' },
    { ...b, availability: 'available' },
  ]);
  await expect(policy.resolveRoot!(b.workspaceId)).resolves.toBe(await realpath(workspaceB));

  await rm(workspaceA, { recursive: true, force: true });

  // A is listed as unavailable with its registration and identity unchanged; B stays available.
  const listed = await store.list();
  expect(listed).toEqual([
    { ...a, availability: 'unavailable', unavailableReason: 'WORKSPACE_ROOT_MISSING' },
    { ...b, availability: 'available' },
  ]);
  expect(listed[0]?.rootIdentityKey).toBe(a.rootIdentityKey);
  await expect(store.getDefault()).resolves.toBe(b.workspaceId);
  // Tools on the untouched workspace B keep working.
  await expect(policy.resolveRoot!(b.workspaceId)).resolves.toBe(await realpath(workspaceB));
  await expect(policy.resolveRead(b.workspaceId, 'package.json')).resolves.toBe(
    join(await realpath(workspaceB), 'package.json'),
  );
  await expect(
    createMcpWorkspaceBinding(store).resolveRequiredForMcpSession('mcp1_AQAAAAAAAAAAAAAAAAAAAA'),
  ).resolves.toBe(b.workspaceId);
  // An operation that targets A fails precisely, and the cause says why.
  await expect(policy.resolveRoot!(a.workspaceId)).rejects.toMatchObject({
    code: 'WORKSPACE_ROOT_UNAVAILABLE',
    cause: { code: 'WORKSPACE_ROOT_MISSING' },
  });
  await expect(policy.resolveRead(a.workspaceId, 'package.json')).rejects.toMatchObject({
    code: 'WORKSPACE_ROOT_UNAVAILABLE',
    cause: { code: 'WORKSPACE_ROOT_MISSING' },
  });
  // Registration still works.
  const c = await store.add(principal.actorId, workspaceC);

  // `workspace remove A` succeeds through the nonce-protected control endpoint.
  const nonceStore = createActionNonceStore({ leaderGeneration: 'generation-1' });
  const endpoints = createWorkspaceEndpoints({ store, nonceStore });
  expect((await endpoints.list()).map(row => [row.workspaceId, row.availability])).toEqual([
    [a.workspaceId, 'unavailable'],
    [b.workspaceId, 'available'],
    [c.workspaceId, 'available'],
  ]);
  const claims = await nonceStore.issue(
    principal,
    'workspace.remove',
    hashActionRequest('workspace.remove', { workspaceId: a.workspaceId }),
  );
  await endpoints.remove(principal, { workspaceId: a.workspaceId, actionNonce: claims.value });
  expect(nonceStore.get(claims.value)).toMatchObject({ state: 'consumed' });
  expect(await endpoints.list()).toEqual([
    { ...b, availability: 'available' },
    { ...c, availability: 'available' },
  ]);

  // The repaired state persists: a restarted store over the same state root works.
  const restarted = createWorkspaceConfigStore(stateRoot, idleGuard, fixturePermissions(stateRoot));
  expect(await restarted.list()).toEqual([
    { ...b, availability: 'available' },
    { ...c, availability: 'available' },
  ]);
  await expect(restarted.getDefault()).resolves.toBe(b.workspaceId);
});

it('LC-2 regression (T08): the leader retention sweep skips an unavailable workspace with a log line instead of throwing', async () => {
  // Seam: leader initialization cannot be run in a unit test, so the sweep's workspace iteration
  // is the exported helper that index.ts calls; the second half pins that call.
  const { workspaceA, store, a, b } = await scenario();
  await rm(workspaceA, { recursive: true, force: true });
  const visited: string[] = [];
  const lines: string[] = [];

  await expect(
    sweepAvailableWorkspaces(
      await store.list(),
      line => lines.push(line),
      async workspace => {
        visited.push(workspace.workspaceId);
      },
    ),
  ).resolves.toBeUndefined();

  expect(visited).toEqual([b.workspaceId]);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(`[retention] workspace ${a.workspaceId} is unavailable`);
  expect(lines[0]).toContain('WORKSPACE_ROOT_MISSING');

  // The leader's startup sweep iterates registrations only through this helper.
  const source = await readFile(resolve(import.meta.dirname, '../../src/index.ts'), 'utf8');
  expect(source).toMatch(
    /await sweepAvailableWorkspaces\(await workspaceStore\.list\(\), log, async workspace => \{/u,
  );
  expect(source).not.toMatch(/for \(const workspace of await workspaceStore\.list\(\)\)/u);
});
