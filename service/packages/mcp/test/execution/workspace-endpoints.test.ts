import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  hashActionRequest,
  type ActorContext,
  type ResolvedWorkspaceRegistration,
  type WorkspaceUsageGuard,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createActionNonceEndpoint } from '../../src/control/action-nonce-endpoints.js';
import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import { registerTask7ControlRoutes } from '../../src/control/route-registry.js';
import { AuthenticatedControlRouter } from '../../src/control/router.js';
import { createWorkspaceEndpoints } from '../../src/control/workspace-endpoints.js';
import {
  createWorkspaceConfigStore,
  workspaceConfigPath,
} from '../../src/fs/workspace-config-store.js';
import { createWorkspaceRegistrationResolver } from '../../src/fs/workspace-registration-resolver.js';
import { fixturePermissions } from '../portal/fixtures.js';

const principal = Object.freeze({
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
}) satisfies Readonly<ActorContext>;
const otherSession = Object.freeze({
  ...principal,
  authSessionId: `auth1_${'C'.repeat(43)}`,
}) satisfies Readonly<ActorContext>;
const otherWorkspaceId = '123e4567-e89b-42d3-a456-426614174099';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const fromTemp = relative(tmpdir(), root);
    if (fromTemp === '' || fromTemp.startsWith('..') || isAbsolute(fromTemp))
      throw new Error(`refusing to remove a non-temporary test path: ${root}`);
    await rm(root, { recursive: true, force: true });
  }
});

/** A real store with workspace A replaced by a different directory and workspace B untouched. */
const replacedWorkspace = async (
  guard: WorkspaceUsageGuard = { hasUnsettled: async () => false },
) => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-t08-endpoints-'));
  roots.push(root);
  const stateRoot = join(root, 'state'),
    workspaceA = join(root, 'workspace-a'),
    workspaceB = join(root, 'workspace-b');
  for (const path of [stateRoot, workspaceA, workspaceB]) await mkdir(path);
  const registrationResolver = createWorkspaceRegistrationResolver();
  const store = createWorkspaceConfigStore(
    stateRoot,
    guard,
    fixturePermissions(stateRoot),
    {},
    registrationResolver,
  );
  const a = await store.add(principal.actorId, workspaceA);
  const b = await store.add(principal.actorId, workspaceB);
  await rename(workspaceA, `${workspaceA}-original`);
  await mkdir(workspaceA);
  const nonceStore = createActionNonceStore({ leaderGeneration: 'generation-1' });
  return {
    root,
    stateRoot,
    workspaceA: await realpath(workspaceA),
    store,
    a,
    b,
    nonceStore,
    registrationResolver,
    endpoints: createWorkspaceEndpoints({ store, nonceStore }),
    issueNonce: createActionNonceEndpoint({ store: nonceStore, registrationResolver }),
  };
};
const rebindNonceRequest = (
  workspaceId: string,
  realPath: string,
  hashWorkspaceId = workspaceId,
) => ({
  action: 'workspace.rebind',
  requestHash: hashActionRequest('workspace.rebind', { workspaceId: hashWorkspaceId, realPath }),
  registrationPath: realPath,
  workspaceId,
});

describe('workspace control endpoints', () => {
  it.each([
    ['remove', 'workspace.remove', 'WORKSPACE_DEFAULT_IN_USE'],
    ['set-default', 'workspace.set-default', 'WORKSPACE_DEFAULT_INVALID'],
  ] as const)(
    'leaves a %s nonce issued when semantic workspace validation fails',
    async (caseName, action, errorCode) => {
      const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
      const nonceStore = createActionNonceStore({ leaderGeneration: 'generation-1' });
      const requestHash = hashActionRequest(action, { workspaceId });
      const claims = await nonceStore.issue(principal, action, requestHash);
      const invalid = Object.assign(new Error('semantic workspace state is invalid'), {
        code: errorCode,
      });
      const store = {
        addResolved: async () => {
          throw new Error('not used');
        },
        list: async () => [],
        getDefault: async () => null,
        remove: async () => {
          throw invalid;
        },
        setDefault: async () => {
          throw invalid;
        },
        removeAuthorized: async () => {
          throw invalid;
        },
        setDefaultAuthorized: async () => {
          throw invalid;
        },
      };
      const endpoints = createWorkspaceEndpoints({ store: store as never, nonceStore });

      const invocation =
        caseName === 'remove'
          ? endpoints.remove(principal, { workspaceId, actionNonce: claims.value })
          : endpoints.setDefault(principal, { workspaceId, actionNonce: claims.value });
      await expect(invocation).rejects.toMatchObject({ code: errorCode });
      expect(nonceStore.get(claims.value)).toMatchObject({ state: 'issued' });
    },
  );

  it('uses the nonce-bound registration and consumes immediately before addResolved', async () => {
    const registration: ResolvedWorkspaceRegistration = {
      requestedPath: 'C:\\workspace',
      realPath: 'C:\\workspace',
      identityKey: '1:2:3',
    };
    const events: string[] = [];
    const endpoints = createWorkspaceEndpoints({
      store: {
        addResolved: async (_actor, expected, consume) => {
          expect(expected).toEqual(registration);
          events.push('add-start');
          await consume(async () => {});
          events.push('added');
          return {
            workspaceId: '123e4567-e89b-42d3-a456-426614174000',
            path: expected.requestedPath,
            realPath: expected.realPath,
            rootIdentityKey: expected.identityKey,
            addedAt: '2026-08-31T00:00:00.000Z',
          };
        },
        rebindResolved: async () => {
          throw new Error('not used');
        },
        list: async () => [],
        remove: async () => {},
        removeAuthorized: async () => {},
        setDefault: async () => {},
        setDefaultAuthorized: async () => {},
        getDefault: async () => null,
      },
      nonceStore: {
        issue: async () => {
          throw new Error('not used');
        },
        consumeCas: async () => {
          events.push('nonce-consumed');
        },
      },
      registrationForNonce: () => registration,
    });
    await endpoints.add(principal, {
      path: registration.requestedPath,
      actionNonce: `sfp_an1_${'A'.repeat(43)}`,
    });
    expect(events).toEqual(['add-start', 'nonce-consumed', 'added']);
    await expect(
      endpoints.add(principal, {
        path: registration.requestedPath,
        requestHash: hashActionRequest('workspace.add', { realPath: registration.realPath }),
        actionNonce: `sfp_an1_${'A'.repeat(43)}`,
      }),
    ).rejects.toBeDefined();
  });
});

describe('unavailable workspace control (LC-2, T08)', () => {
  it('rebinds an unavailable workspace only with a valid registration-bound rebind nonce', async () => {
    const { workspaceA, store, a, b, nonceStore, registrationResolver, endpoints, issueNonce } =
      await replacedWorkspace();
    const unavailable = [
      { ...a, availability: 'unavailable', unavailableReason: 'WORKSPACE_ROOT_IDENTITY_CHANGED' },
      { ...b, availability: 'available' },
    ];
    const request = (actionNonce: string) => ({
      workspaceId: a.workspaceId,
      path: workspaceA,
      actionNonce,
    });
    await expect(store.list()).resolves.toEqual(unavailable);

    // A nonce that was never issued.
    await expect(
      endpoints.rebind(principal, request(`sfp_an1_${'Z'.repeat(43)}`)),
    ).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
    // A rebind nonce cannot be issued without a server-resolved registration.
    await expect(
      nonceStore.issue(
        principal,
        'workspace.rebind',
        hashActionRequest('workspace.rebind', { workspaceId: a.workspaceId, realPath: workspaceA }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
    // The request hash must match the workspace and the server-resolved real path.
    await expect(
      issueNonce(principal, rebindNonceRequest(a.workspaceId, workspaceA, otherWorkspaceId)),
    ).rejects.toMatchObject({ code: 'ACTION_NONCE_REQUEST_HASH_MISMATCH' });
    // A nonce issued for another workspace, an add nonce for the same path, and a nonce of
    // another control session are all rejected without consuming them.
    const foreign = await issueNonce(principal, rebindNonceRequest(otherWorkspaceId, workspaceA));
    const addNonce = await issueNonce(principal, {
      action: 'workspace.add',
      requestHash: hashActionRequest('workspace.add', { realPath: workspaceA }),
      registrationPath: workspaceA,
    });
    const otherSessionNonce = await issueNonce(
      otherSession,
      rebindNonceRequest(a.workspaceId, workspaceA),
    );
    for (const claims of [foreign, addNonce, otherSessionNonce]) {
      await expect(endpoints.rebind(principal, request(claims.value))).rejects.toMatchObject({
        code: 'ACTION_NONCE_INVALID',
      });
      expect(nonceStore.get(claims.value)).toMatchObject({ state: 'issued' });
    }
    // A nonce whose bound registration is for a different path than the request.
    const elsewhere = join(resolve(workspaceA, '..'), 'elsewhere');
    await mkdir(elsewhere);
    const mismatched = await issueNonce(
      principal,
      rebindNonceRequest(a.workspaceId, await realpath(elsewhere)),
    );
    await expect(endpoints.rebind(principal, request(mismatched.value))).rejects.toMatchObject({
      code: 'ACTION_NONCE_INVALID',
    });
    await expect(store.list()).resolves.toEqual(unavailable);

    const valid = await issueNonce(principal, rebindNonceRequest(a.workspaceId, workspaceA));
    const replacement = await registrationResolver.resolveForNonce(workspaceA);
    const rebound = await endpoints.rebind(principal, request(valid.value));

    expect(rebound).toEqual({
      ...a,
      path: replacement.requestedPath,
      realPath: replacement.realPath,
      rootIdentityKey: replacement.identityKey,
      availability: 'available',
    });
    expect(nonceStore.get(valid.value)).toMatchObject({ state: 'consumed' });
    await expect(store.list()).resolves.toEqual([rebound, { ...b, availability: 'available' }]);
    // The consumed nonce cannot be replayed.
    await expect(endpoints.rebind(principal, request(valid.value))).rejects.toMatchObject({
      code: 'ACTION_NONCE_INVALID',
    });
  });

  it('refuses to remove or rebind an unavailable workspace with unsettled operations and keeps the nonce issued', async () => {
    let unsettled = true;
    const { workspaceA, store, a, nonceStore, endpoints, issueNonce } = await replacedWorkspace({
      hasUnsettled: async workspaceId => unsettled && workspaceId !== otherWorkspaceId,
    });
    const removal = await nonceStore.issue(
      principal,
      'workspace.remove',
      hashActionRequest('workspace.remove', { workspaceId: a.workspaceId }),
    );
    const rebind = await issueNonce(principal, rebindNonceRequest(a.workspaceId, workspaceA));

    await expect(
      endpoints.remove(principal, { workspaceId: a.workspaceId, actionNonce: removal.value }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_IN_USE' });
    await expect(
      endpoints.rebind(principal, {
        workspaceId: a.workspaceId,
        path: workspaceA,
        actionNonce: rebind.value,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_IN_USE' });
    expect(nonceStore.get(removal.value)).toMatchObject({ state: 'issued' });
    expect(nonceStore.get(rebind.value)).toMatchObject({ state: 'issued' });
    expect((await store.list()).map(row => [row.workspaceId, row.availability])[0]).toEqual([
      a.workspaceId,
      'unavailable',
    ]);

    // Once the operations settle, the same nonce removes the unavailable row.
    unsettled = false;
    await endpoints.remove(principal, { workspaceId: a.workspaceId, actionNonce: removal.value });
    expect((await store.list()).map(row => row.workspaceId)).not.toContain(a.workspaceId);
  });

  it('serves every registration with its availability and a nonce-bound rebind through the control router', async () => {
    const { root, stateRoot, workspaceA, store, a, b, nonceStore, endpoints, issueNonce } =
      await replacedWorkspace();
    // Append a legacy-unbound row by migrating a v1 row into the v3 file through the store.
    const legacyPath = join(root, 'legacy');
    await mkdir(legacyPath);
    const legacy = {
      workspaceId: '123e4567-e89b-42d3-a456-426614174000',
      path: resolve(legacyPath),
      realPath: await realpath(legacyPath),
      addedAt: '2026-08-28T00:00:00.000Z',
    };
    const current = (await store.list()).map(row => ({
      workspaceId: row.workspaceId,
      path: row.path,
      realPath: row.realPath,
      rootIdentityKey: row.rootIdentityKey,
      addedAt: row.addedAt,
      state: 'bound',
    }));
    const payload = {
      version: 3,
      workspaces: [...current, { ...legacy, state: 'legacy-unbound' }],
      defaultWorkspaceId: null,
    };
    await writeFile(
      workspaceConfigPath(stateRoot),
      JSON.stringify({
        ...payload,
        checksum: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      }),
    );
    const router = new AuthenticatedControlRouter();
    registerTask7ControlRoutes(router, {
      status: async () => ({}),
      actionNonce: issueNonce,
      approvals: {} as never,
      toolCall: (async () => null) as never,
      workspaces: endpoints,
      operations: {} as never,
      egress: {} as never,
      adminAudit: (async () => null) as never,
    });
    router.freeze();
    const signal = new AbortController().signal;

    await expect(
      router.dispatch({ method: 'GET', path: '/control/workspaces', input: {} }, principal, signal),
    ).resolves.toEqual([
      { ...a, availability: 'unavailable', unavailableReason: 'WORKSPACE_ROOT_IDENTITY_CHANGED' },
      { ...b, availability: 'available' },
      { ...legacy, availability: 'legacy-unbound' },
    ]);
    const claims = (await router.dispatch(
      {
        method: 'POST',
        path: '/control/action-nonces',
        input: rebindNonceRequest(a.workspaceId, workspaceA),
      },
      principal,
      signal,
    )) as { value: string };
    const rebound = await router.dispatch(
      {
        method: 'POST',
        path: `/control/workspaces/${a.workspaceId}/rebind`,
        input: { path: workspaceA, actionNonce: claims.value },
      },
      principal,
      signal,
    );
    expect(rebound).toMatchObject({ workspaceId: a.workspaceId, availability: 'available' });
    expect(nonceStore.get(claims.value)).toMatchObject({ state: 'consumed' });
    await expect(
      router.dispatch({ method: 'GET', path: '/control/workspaces', input: {} }, principal, signal),
    ).resolves.toEqual([
      rebound,
      { ...b, availability: 'available' },
      { ...legacy, availability: 'legacy-unbound' },
    ]);
  });
});
