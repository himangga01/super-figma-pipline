import {
  hashActionRequest,
  type ActorContext,
  type ResolvedWorkspaceRegistration,
} from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import { createWorkspaceEndpoints } from '../../src/control/workspace-endpoints.js';

const principal = Object.freeze({
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
}) satisfies Readonly<ActorContext>;

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
