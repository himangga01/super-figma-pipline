import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  hashActionRequest,
  type ActorContext,
  type ResolvedWorkspaceRegistration,
} from '@sfp/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import { createWorkspaceEndpoints } from '../../src/control/workspace-endpoints.js';
import {
  addResolvedWorkspaceAtomically,
  createWorkspaceConfigStore,
  workspaceConfigPath,
} from '../../src/fs/workspace-config-store.js';
import { createWorkspaceRegistrationResolver } from '../../src/fs/workspace-registration-resolver.js';
import type { BoundStatePermissions } from '../../src/security/state-permissions.js';

const roots: string[] = [];
const actor = Object.freeze({
  actorId: `actor1_${'A'.repeat(43)}`,
  authSessionId: `auth1_${'B'.repeat(43)}`,
  entryPath: 'control',
}) satisfies Readonly<ActorContext>;

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const permissionsFor = (stateRoot: string): BoundStatePermissions => ({
  stateRoot: resolve(stateRoot),
  ensureSecure: async () => {},
  verifySecure: async () => {},
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

const persistedRows = async (stateRoot: string): Promise<number> => {
  try {
    const value = JSON.parse(await readFile(workspaceConfigPath(stateRoot), 'utf8')) as {
      workspaces?: unknown[];
    };
    return value.workspaces?.length ?? 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
};

describe('workspace registration atomicity', () => {
  it('leaves the nonce issued and writes no row when identity changes before CAS', async () => {
    const expected: ResolvedWorkspaceRegistration = {
      requestedPath: 'C:\\workspace',
      realPath: 'C:\\workspace',
      identityKey: '1:2:3',
    };
    let consumed = 0;
    let writes = 0;
    await expect(
      addResolvedWorkspaceAtomically({
        expected,
        revalidate: async () => ({ ...expected, identityKey: '1:9:9' }),
        consumeNonceCas: async () => {
          consumed += 1;
        },
        commit: async () => {
          writes += 1;
        },
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_REGISTRATION_CHANGED' });
    expect(consumed).toBe(0);
    expect(writes).toBe(0);
  });

  it.each([
    'before-queue',
    'while-queued',
    'during-revalidation',
    'immediately-before-cas',
  ] as const)(
    'keeps the nonce issued and durable rows empty for a real swap %s',
    async swapPoint => {
      const root = await mkdtemp(join(tmpdir(), 'sfp-workspace-swap-'));
      roots.push(root);
      const stateRoot = join(root, 'state');
      const workspacePath = join(root, 'workspace');
      await Promise.all([mkdir(stateRoot), mkdir(workspacePath)]);
      const baseResolver = createWorkspaceRegistrationResolver();
      const expected = await baseResolver.resolveForNonce(workspacePath);
      let swapped = false;
      const swap = async (): Promise<void> => {
        if (swapped) return;
        swapped = true;
        await rename(workspacePath, join(root, 'workspace-old'));
        await mkdir(workspacePath);
      };
      const resolver = {
        resolveForNonce: baseResolver.resolveForNonce,
        revalidateInsideMutation: async (registration: Readonly<ResolvedWorkspaceRegistration>) => {
          if (swapPoint === 'during-revalidation') await swap();
          return baseResolver.revalidateInsideMutation(registration);
        },
      };
      let releaseQueue!: () => void;
      let queueHeld!: () => void;
      const queueStarted = new Promise<void>(resolvePromise => {
        queueHeld = resolvePromise;
      });
      const queueRelease = new Promise<void>(resolvePromise => {
        releaseQueue = resolvePromise;
      });
      let firstDirectorySync = true;
      const store = createWorkspaceConfigStore(
        stateRoot,
        { hasUnsettled: async () => false },
        permissionsFor(stateRoot),
        {
          syncDirectory: async () => {
            if (swapPoint !== 'while-queued' || !firstDirectorySync) return;
            firstDirectorySync = false;
            queueHeld();
            await queueRelease;
          },
        },
        resolver,
      );
      const nonceStore = createActionNonceStore({ leaderGeneration: 'generation-1' });
      const requestHash = hashActionRequest('workspace.add', { realPath: expected.realPath });
      const claims = await nonceStore.issueWorkspaceAdd(actor, requestHash, expected);
      const controlledNonce = {
        ...nonceStore,
        consumeCas: async (...args: Parameters<typeof nonceStore.consumeCas>) => {
          if (swapPoint === 'immediately-before-cas') await swap();
          return nonceStore.consumeCas(...args);
        },
      };
      const endpoints = createWorkspaceEndpoints({
        store,
        nonceStore: controlledNonce,
        registrationForNonce: (_principal, value) => nonceStore.registrationFor(actor, value),
      });

      let blocker: Promise<void> | undefined;
      if (swapPoint === 'while-queued') {
        blocker = store.setDefault(actor.actorId, null);
        await queueStarted;
      }
      if (swapPoint === 'before-queue' || swapPoint === 'while-queued') await swap();
      const addition = endpoints.add(actor, { path: workspacePath, actionNonce: claims.value });
      releaseQueue?.();
      await blocker;

      await expect(addition).rejects.toMatchObject({ code: 'WORKSPACE_REGISTRATION_CHANGED' });
      expect(nonceStore.get(claims.value)).toMatchObject({ state: 'issued' });
      expect(await persistedRows(stateRoot)).toBe(0);
    },
  );
});
