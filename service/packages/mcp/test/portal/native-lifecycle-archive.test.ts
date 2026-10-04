import { spawn } from 'node:child_process';
import { mkdir, writeFile, lstat, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { contentHash } from '@sfp/ir';
import { hashActionRequest, type ActorContext } from '@sfp/shared';
import { build } from 'tsdown';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createActionNonceStore } from '../../src/control/action-nonce-store.js';
import { AuthenticatedControlRouter } from '../../src/control/router.js';
import { registerPortalArchiveRoutes } from '../../src/portal/control.js';
import { NativeEnvironmentLifecycle } from '../../src/portal/native-lifecycle.js';
import {
  expandNativeEnvironment,
  prepareNativeEnvironment,
} from '../../src/portal/native-resources.js';
import { CorePreparations } from '../../src/portal/recipes/core-preparation.js';
import { portalFixture } from './fixtures.js';

const cleanup: Array<() => Promise<void>> = [];
let worker: string;
beforeAll(async () => {
  if (process.platform !== 'win32') return;
  const folder = resolve('packages/mcp/.cache/lifecycle-archive-worker');
  await mkdir(folder, { recursive: true });
  const entry = join(folder, 'entry.ts');
  await writeFile(
    entry,
    `
    import {readFile} from 'node:fs/promises';
    import {NativeEnvironmentLifecycle} from ${JSON.stringify(resolve('packages/mcp/src/portal/native-lifecycle.ts'))};
    import {PortalStore} from ${JSON.stringify(resolve('packages/mcp/src/portal/store.ts'))};
    import {fixturePermissions} from ${JSON.stringify(resolve('packages/mcp/test/portal/fixtures.ts'))};
    const value = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const permissions = fixturePermissions(value.stateRoot);
    const store = new PortalStore(value.stateRoot, Buffer.from(value.key, 'hex'), permissions);
    const manager = new NativeEnvironmentLifecycle(store, value.stateRoot, permissions, 'archive-child', undefined, {
      withArchiveEligibility: async (_record, work) => work(),
      [value.boundary]: async () => process.exit(84),
    });
    await manager.archive(value.attemptId, 'actor', value.receiptHash, value.archiveHash);
    throw Error('archive boundary not reached');
  `,
  );
  await build({
    config: false,
    entry: [entry],
    outDir: folder,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: false,
    clean: false,
    fixedExtension: true,
    deps: { alwaysBundle: ['@sfp/ir', '@sfp/shared'] },
    logLevel: 'silent',
  });
  worker = join(folder, 'entry.mjs');
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const done of cleanup.splice(0)) await done();
});
const fixture = async (ownerId = 'actor') => {
  const f = await portalFixture();
  cleanup.push(f.cleanup);
  let pinned = false;
  const policy = {
    withArchiveEligibility: async <T>(_record: unknown, work: () => Promise<T>) => {
      if (pinned) throw Error('PORTAL_ENVIRONMENT_ARCHIVE_IN_USE');
      return work();
    },
  };
  const lifecycle = new NativeEnvironmentLifecycle(
    f.store,
    f.stateRoot,
    f.permissions,
    'generation',
    undefined,
    policy,
  );
  const grant = await prepareNativeEnvironment(
    {
      ownerId,
      planId: 'plan',
      native: { id: 'test', sourceHash: contentHash('source', 'test'), environment: {} },
    },
    f.stateRoot,
  );
  const execution = expandNativeEnvironment(grant, {
    operationId: 'archive-test',
    runId: 'archive-test',
    target: 'candidate',
    profileHash: contentHash('profile', 'test'),
    repositoryHash: contentHash('repo', 'test'),
    repositoryKey: 'portal:repo:test',
  });
  await lifecycle.acquire(execution, grant, new AbortController().signal);
  const home = await lifecycle.ownedChild(execution.attemptId, 'home');
  await mkdir(join(home, 'cache'));
  await writeFile(join(home, 'cache', 'result.json'), '{"retained":true}');
  const released = await lifecycle.finish(execution.attemptId);
  return {
    ...f,
    lifecycle,
    policy,
    execution,
    released,
    receiptHash: contentHash('sfp-native-lifecycle-receipt-v1', released),
    pin: (value: boolean) => {
      pinned = value;
    },
  };
};
it.runIf(process.platform === 'win32')(
  'requires exact owner and reviewed receipt, preserves dependent attempts, then verifies receipts after physical reclamation',
  async () => {
    const f = await fixture();
    await expect(f.lifecycle.reviewArchive(f.execution.attemptId, 'other')).rejects.toThrow(
      'PORTAL_ENVIRONMENT_ATTEMPT_NOT_FOUND',
    );
    f.pin(true);
    await expect(f.lifecycle.reviewArchive(f.execution.attemptId, 'actor')).rejects.toThrow(
      'PORTAL_ENVIRONMENT_ARCHIVE_IN_USE',
    );
    f.pin(false);
    const reviewed = await f.lifecycle.reviewArchive(f.execution.attemptId, 'actor');
    expect(reviewed.receiptHash).toBe(f.receiptHash);
    expect(reviewed.bytes).toBeGreaterThan(0);
    await expect(
      f.lifecycle.archive(
        f.execution.attemptId,
        'actor',
        contentHash('wrong', null),
        reviewed.archiveHash,
      ),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_RECEIPT_REQUIRED');
    await f.lifecycle.archive(f.execution.attemptId, 'actor', f.receiptHash, reviewed.archiveHash);
    await expect(lstat(f.execution.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    const restarted = new NativeEnvironmentLifecycle(
      f.store,
      f.stateRoot,
      f.permissions,
      'new-generation',
      undefined,
      f.policy,
    );
    expect(await restarted.verifyReceipt(f.execution.attemptId, 'actor', f.receiptHash)).toEqual(
      f.released,
    );
    await expect(
      restarted.acquire(
        f.execution,
        await prepareNativeEnvironment(
          {
            ownerId: 'actor',
            planId: 'plan',
            native: { id: 'test', sourceHash: contentHash('source', 'test'), environment: {} },
          },
          f.stateRoot,
        ),
        new AbortController().signal,
      ),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_ATTEMPT_REPLAY');
  },
  30_000,
);

it.runIf(process.platform === 'win32').each([false, true])(
  'archives a proved no-effect reservation only while its owned path stays absent (foreign=%s)',
  async foreign => {
    const f = await portalFixture();
    cleanup.push(f.cleanup);
    const grant = await prepareNativeEnvironment(
      {
        ownerId: 'actor',
        planId: 'plan',
        native: { id: 'zero', sourceHash: contentHash('source', 'zero'), environment: {} },
      },
      f.stateRoot,
    );
    const execution = expandNativeEnvironment(grant, {
      operationId: 'zero-effect',
      runId: 'zero-effect',
      target: 'candidate',
      profileHash: contentHash('profile', 'zero'),
      repositoryHash: contentHash('repo', 'zero'),
      repositoryKey: 'portal:repo:zero',
    });
    const policy = {
      withArchiveEligibility: async <T>(_record: unknown, work: () => Promise<T>) => work(),
    };
    const manager = new NativeEnvironmentLifecycle(
        f.store,
        f.stateRoot,
        f.permissions,
        'zero',
        undefined,
        policy,
      ),
      signal = new AbortController(),
      create = f.store.create.bind(f.store);
    vi.spyOn(f.store, 'create').mockImplementation(async (...args) => {
      const value = await create(...args);
      if (args[0] === 'environment-attempts') signal.abort(Error('before effects'));
      return value;
    });
    await expect(manager.acquire(execution, grant, signal.signal)).rejects.toThrow(
      'before effects',
    );
    vi.restoreAllMocks();
    const record = await manager.inspect(execution.attemptId, 'actor');
    expect(record).toMatchObject({
      state: 'released',
      executionClosed: true,
      directoryIdentity: null,
      provisioningStarted: false,
      directoryCreations: [],
      reason: 'no-effects-started',
    });
    const receiptHash = contentHash('sfp-native-lifecycle-receipt-v1', record);
    const review = await manager.reviewArchive(execution.attemptId, 'actor');
    expect(review).toMatchObject({ entries: 0, bytes: 0, receiptHash });
    if (foreign) {
      await mkdir(execution.directory);
      await writeFile(join(execution.directory, 'foreign.txt'), 'owner bytes');
      // eslint-disable-next-line vitest/no-conditional-expect -- collision case must reject rather than reclaim
      await expect(
        manager.archive(execution.attemptId, 'actor', receiptHash, review.archiveHash),
      ).rejects.toThrow('PORTAL_ENVIRONMENT_NO_EFFECT_PATH_PRESENT');
      // eslint-disable-next-line vitest/no-conditional-expect -- rejected collision keeps its active charge
      expect(
        (
          await f.store.get(
            'environment-index',
            'retained',
            z.object({ attempts: z.array(z.string()) }).passthrough(),
          )
        )?.attempts,
      ).toContain(execution.attemptId);
      // eslint-disable-next-line vitest/no-conditional-expect -- preserve bytes at the unowned collision path
      expect(await readFile(join(execution.directory, 'foreign.txt'), 'utf8')).toBe('owner bytes');
      return;
    }
    await manager.archive(execution.attemptId, 'actor', receiptHash, review.archiveHash);
    const restarted = new NativeEnvironmentLifecycle(
      f.store,
      f.stateRoot,
      f.permissions,
      'restart',
      undefined,
      policy,
    );
    expect(await restarted.verifyReceipt(execution.attemptId, 'actor', receiptHash)).toEqual(
      record,
    );
    expect(
      (
        await f.store.get(
          'environment-index',
          'retained',
          z.object({ attempts: z.array(z.string()) }).passthrough(),
        )
      )?.attempts,
    ).not.toContain(execution.attemptId);
    await expect(restarted.acquire(execution, grant, new AbortController().signal)).rejects.toThrow(
      'PORTAL_ENVIRONMENT_ATTEMPT_REPLAY',
    );
  },
  30_000,
);

it.runIf(process.platform === 'win32')(
  'keeps an unknown missing directory charged instead of treating it as no effects',
  async () => {
    const f = await fixture(),
      preserved = f.execution.directory + '-preserved';
    await rename(f.execution.directory, preserved);
    await expect(f.lifecycle.reviewArchive(f.execution.attemptId, 'actor')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await lstat(preserved)).isDirectory()).toBe(true);
    expect(
      (
        await f.store.get(
          'environment-index',
          'retained',
          z.object({ attempts: z.array(z.string()) }).passthrough(),
        )
      )?.attempts,
    ).toContain(f.execution.attemptId);
  },
  30_000,
);

it.runIf(process.platform === 'win32')(
  'routes actual native archival through the exact reviewed owner nonce and rejects altered or replayed approval',
  async () => {
    const actor: ActorContext = {
      actorId: `actor1_${'A'.repeat(43)}`,
      authSessionId: `auth1_${'B'.repeat(43)}`,
      entryPath: 'control',
    };
    const f = await fixture(actor.actorId),
      router = new AuthenticatedControlRouter(),
      nonces = createActionNonceStore({ leaderGeneration: 'archive-control' });
    registerPortalArchiveRoutes(router, f.lifecycle, new CorePreparations(f), nonces);
    router.freeze();
    const call = (path: string, input: unknown, principal = actor) =>
      router.dispatch(
        { method: 'POST', path: `/control/portal/environments/archive${path}`, input },
        principal,
        new AbortController().signal,
      );
    const review = (await call('/review', { attemptId: f.execution.attemptId })) as {
      receiptHash: string;
      archiveHash: string;
    };
    const payload = { attemptId: f.execution.attemptId, ...review };
    const exact = {
      attemptId: payload.attemptId,
      receiptHash: payload.receiptHash,
      archiveHash: payload.archiveHash,
    };
    const nonce = await nonces.issue(
      actor,
      'portal.environment.archive',
      hashActionRequest('portal.environment.archive', exact),
    );
    await expect(
      call('', {
        ...exact,
        archiveHash: contentHash('altered-review', null),
        actionNonce: nonce.value,
      }),
    ).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
    await expect(
      call(
        '',
        { ...exact, actionNonce: nonce.value },
        { ...actor, actorId: `actor1_${'C'.repeat(43)}` },
      ),
    ).rejects.toMatchObject({ code: 'ACTION_NONCE_INVALID' });
    expect(await call('', { ...exact, actionNonce: nonce.value })).toMatchObject({
      completed: true,
    });
    await expect(call('', { ...exact, actionNonce: nonce.value })).rejects.toMatchObject({
      code: 'ACTION_NONCE_INVALID',
    });
    expect(
      await f.lifecycle.verifyReceipt(f.execution.attemptId, actor.actorId, f.receiptHash),
    ).toEqual(f.released);
  },
  30_000,
);

it.runIf(process.platform === 'win32')(
  'rejects exhausted signed archive accounting before deleting any owned bytes',
  async () => {
    const f = await fixture(),
      review = await f.lifecycle.reviewArchive(f.execution.attemptId, 'actor');
    await f.store.create(
      'environment-archive-index',
      'index',
      { version: 1, rows: [{ attemptId: 'orphan-reservation', bytes: 67_108_864 }] },
      z.object({
        version: z.literal(1),
        rows: z.array(z.object({ attemptId: z.string(), bytes: z.number().int() })),
      }),
    );
    await expect(
      f.lifecycle.archive(f.execution.attemptId, 'actor', review.receiptHash, review.archiveHash),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_ARCHIVE_CAPACITY');
    expect((await lstat(f.execution.directory)).isDirectory()).toBe(true);
    expect(await f.lifecycle.verifyReceipt(f.execution.attemptId, 'actor', f.receiptHash)).toEqual(
      f.released,
    );
  },
  30_000,
);

it.runIf(process.platform === 'win32').each(['afterArchiveIntent', 'afterUnlink'])(
  'resumes actual child interruption at %s without dropping the active capacity charge',
  async boundary => {
    const f = await fixture(),
      review = await f.lifecycle.reviewArchive(f.execution.attemptId, 'actor');
    const input = join(f.workspaceRoot, 'archive-worker.json');
    await writeFile(
      input,
      JSON.stringify({
        stateRoot: f.stateRoot,
        key: f.key.toString('hex'),
        attemptId: f.execution.attemptId,
        receiptHash: review.receiptHash,
        archiveHash: review.archiveHash,
        boundary,
      }),
    );
    const child = spawn(process.execPath, [worker, input], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostic = '';
    child.stdout.on('data', bytes => {
      diagnostic += bytes.toString();
    });
    child.stderr.on('data', bytes => {
      diagnostic += bytes.toString();
    });
    const code = await new Promise<number | null>((done, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(Error('archive child timed out'));
      }, 20_000);
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', exit => {
        clearTimeout(timer);
        done(exit);
      });
    });
    expect({ code, diagnostic }).toMatchObject({ code: 84 });
    expect(
      (
        await f.store.get(
          'environment-index',
          'retained',
          z.object({ attempts: z.array(z.string()) }).passthrough(),
        )
      )?.attempts,
    ).toContain(f.execution.attemptId);
    await expect(
      f.lifecycle.verifyReceipt(f.execution.attemptId, 'actor', review.receiptHash),
    ).rejects.toThrow('PORTAL_ENVIRONMENT_ARCHIVE_INCOMPLETE');
    const restarted = new NativeEnvironmentLifecycle(
      f.store,
      f.stateRoot,
      f.permissions,
      'restart',
      undefined,
      f.policy,
    );
    expect(await restarted.reviewArchive(f.execution.attemptId, 'actor')).toMatchObject({
      archiveHash: review.archiveHash,
    });
    await restarted.archive(f.execution.attemptId, 'actor', review.receiptHash, review.archiveHash);
    expect(
      await restarted.verifyReceipt(f.execution.attemptId, 'actor', review.receiptHash),
    ).toEqual(f.released);
    await expect(lstat(f.execution.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  },
  30_000,
);

it.runIf(process.platform === 'win32')(
  'reuses the actual 128-attempt admission capacity after reviewed physical reclamation',
  async () => {
    const f = await portalFixture();
    cleanup.push(f.cleanup);
    const policy = {
      withArchiveEligibility: async <T>(_record: unknown, work: () => Promise<T>) => work(),
    };
    const manager = new NativeEnvironmentLifecycle(
      f.store,
      f.stateRoot,
      f.permissions,
      'capacity',
      undefined,
      policy,
    );
    const grant = await prepareNativeEnvironment(
      {
        ownerId: 'actor',
        planId: 'plan',
        native: { id: 'capacity', sourceHash: contentHash('source', 'test'), environment: {} },
      },
      f.stateRoot,
    );
    const make = (i: number) =>
      expandNativeEnvironment(grant, {
        operationId: `actual-capacity-${i}`,
        runId: `actual-capacity-${i}`,
        target: 'candidate',
        profileHash: contentHash('profile', 'test'),
        repositoryHash: contentHash('repo', 'test'),
        repositoryKey: 'portal:repo:test',
      });
    let first!: Awaited<ReturnType<typeof manager.finish>>;
    for (let i = 0; i < 128; i++) {
      const execution = make(i);
      await manager.acquire(execution, grant, new AbortController().signal);
      await mkdir(join(execution.directory, 'dependencies', 'reviewed-package'), {
        recursive: true,
      });
      await writeFile(
        join(execution.directory, 'dependencies', 'reviewed-package', 'module.js'),
        `export const attempt = ${i};`,
      );
      const released = await manager.finish(execution.attemptId);
      if (!i) first = released;
      if ((i + 1) % 32 === 0) process.stdout.write(`owned reservations completed: ${i + 1}\n`);
    }
    await expect(manager.acquire(make(128), grant, new AbortController().signal)).rejects.toThrow(
      'PORTAL_ENVIRONMENT_RETENTION_CAPACITY',
    );
    const review = await manager.reviewArchive(first.execution.attemptId, 'actor');
    await manager.archive(
      first.execution.attemptId,
      'actor',
      review.receiptHash,
      review.archiveHash,
    );
    await manager.acquire(make(128), grant, new AbortController().signal);
    await manager.finish(make(128).attemptId);
    expect(
      await manager.verifyReceipt(first.execution.attemptId, 'actor', review.receiptHash),
    ).toEqual(first);
    const index = await f.store.get(
      'environment-index',
      'retained',
      z.object({ attempts: z.array(z.string()) }).passthrough(),
    );
    expect(index?.attempts).toHaveLength(128);
    expect(index?.attempts).not.toContain(first.execution.attemptId);
  },
  300_000,
);
