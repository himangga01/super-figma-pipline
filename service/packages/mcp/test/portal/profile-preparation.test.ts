import { randomUUID } from 'node:crypto';

import { contentHash, PortalRunSchema } from '@sfp/ir';
import { afterEach, expect, it, vi } from 'vitest';

import {
  ProfilePreparations,
  ProfilePreparationRecordSchema,
} from '../../src/portal/profile-preparation.js';
import { profileJobFixture, profileJobActor as actor } from './profile-preparation-fixture.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of cleanups.splice(0)) await c();
});
it('retains a bounded preparation and carries exact JSON issuance through explicit registration', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const jobs = new ProfilePreparations(f.store, f.work),
    deadlineAt = Date.now() + 60000;
  const first = await jobs.begin(
    actor,
    { profile: f.publicProfile, requestId: randomUUID(), deadlineAt },
    { aborted: false },
  );
  expect(first.status).toBe('preparing');
  expect(first.issuerAvailable).toBe(false);
  expect(f.calls()).toBe(1);
  await expect(jobs.result(actor, first.preparationId)).rejects.toMatchObject({
    code: 'PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE',
  });
  f.release();
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, first.preparationId)).issuerAvailable).toBe(true),
  );
  const decoded = JSON.parse(JSON.stringify(await jobs.result(actor, first.preparationId)));
  const row = await jobs.register(actor, { ...decoded, ownerId: actor.actorId }, deadlineAt, {
    aborted: false,
  });
  expect(row.status).toBe('registering');
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, first.preparationId)).status).toBe('registered'),
  );
  expect(f.registers()).toBe(1);
  await expect(
    jobs.register(actor, { ...decoded, ownerId: actor.actorId }, deadlineAt, { aborted: false }),
  ).rejects.toMatchObject({ code: 'PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE' });
});
it('recovers a lost acknowledgement by same-owner request hash without duplicate preparation', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const jobs = new ProfilePreparations(f.store, f.work),
    input = { profile: f.publicProfile, requestId: randomUUID(), deadlineAt: Date.now() + 60000 };
  await jobs.begin(actor, input, { aborted: false });
  const rows = await jobs.list(actor, {
    planId: f.plan.planId,
    requestHash: contentHash('sfp-profile-preparation-request-v1', input),
  });
  expect(rows).toHaveLength(1);
  await expect(jobs.begin(actor, input, { aborted: false })).rejects.toMatchObject({
    code: 'PORTAL_PROFILE_PREPARATION_ALREADY_REQUESTED',
  });
  expect(f.calls()).toBe(1);
  await expect(
    jobs.status({ ...actor, actorId: 'actor1_foreign-fixture' }, rows[0]!.preparationId),
  ).rejects.toMatchObject({ code: 'PORTAL_PROFILE_PREPARATION_NOT_FOUND' });
  expect(
    await jobs.list({ ...actor, actorId: 'actor1_foreign-fixture' }, { planId: f.plan.planId }),
  ).toEqual([]);
  await jobs.cancel(actor, rows[0]!.preparationId);
  f.release();
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, rows[0]!.preparationId)).producerPending).toBe(false),
  );
  expect((await jobs.status(actor, rows[0]!.preparationId)).status).toBe('unknown');
  expect(f.issuers.has(rows[0]!.preparationId)).toBe(false);
});
it('cannot publish a late prepared result when the original deadline expires during physical IO', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const jobs = new ProfilePreparations(f.store, f.work),
    now = Date.now(),
    clock = vi.spyOn(Date, 'now').mockReturnValue(now),
    row = await jobs.begin(
      actor,
      { profile: f.publicProfile, requestId: randomUUID(), deadlineAt: now + 1000 },
      { aborted: false },
    );
  clock.mockReturnValue(now + 1001);
  f.release();
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, row.preparationId)).producerPending).toBe(false),
  );
  expect((await jobs.status(actor, row.preparationId)).status).toBe('unknown');
  await expect(jobs.result(actor, row.preparationId)).rejects.toMatchObject({
    code: 'PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE',
  });
  expect(f.issuers.has(row.preparationId)).toBe(false);
});

it.each(['needs-input', 'blocked', 'waiting-agent'] as const)(
  'admits source purpose without candidate or lease in actual run state %s',
  async state => {
    const f = await profileJobFixture();
    cleanups.push(f.cleanup);
    await f.store.update('runs', f.plan.planId, PortalRunSchema, row => ({ ...row, state }));
    const jobs = new ProfilePreparations(f.store, f.work);
    const row = await jobs.begin(
      actor,
      { profile: f.publicProfile, requestId: randomUUID(), deadlineAt: Date.now() + 60000 },
      { aborted: false },
    );
    expect(row.status).toBe('preparing');
    await jobs.cancel(actor, row.preparationId);
    f.release();
    await vi.waitFor(async () =>
      expect((await jobs.status(actor, row.preparationId)).producerPending).toBe(false),
    );
  },
);
it('lost acknowledgement lookup hashes the requested deadline while the stored budget is clipped to the run', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const deadlineAt = Date.now() + 60000;
  await f.store.update('runs', f.plan.planId, PortalRunSchema, row => ({
    ...row,
    deadlineAt: deadlineAt - 1000,
  }));
  const input = { profile: f.publicProfile, requestId: randomUUID(), deadlineAt },
    jobs = new ProfilePreparations(f.store, f.work),
    row = await jobs.begin(actor, input, { aborted: false });
  expect(row.preparationDeadlineAt).toBe(deadlineAt - 1000);
  expect(
    await jobs.list(actor, {
      planId: f.plan.planId,
      requestHash: contentHash('sfp-profile-preparation-request-v1', input),
    }),
  ).toHaveLength(1);
  await jobs.cancel(actor, row.preparationId);
  f.release();
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, row.preparationId)).producerPending).toBe(false),
  );
});
it('restart metadata does not reconstruct the current process issuance map', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const jobs = new ProfilePreparations(f.store, f.work),
    row = await jobs.begin(
      actor,
      { profile: f.publicProfile, requestId: randomUUID(), deadlineAt: Date.now() + 60000 },
      { aborted: false },
    );
  f.release();
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, row.preparationId)).issuerAvailable).toBe(true),
  );
  const restarted = new ProfilePreparations(f.store, f.work);
  expect((await restarted.status(actor, row.preparationId)).issuerAvailable).toBe(false);
  await expect(restarted.result(actor, row.preparationId)).rejects.toMatchObject({
    code: 'PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE',
  });
});
it('retains an indeterminate registration failure as unknown without a second registration or issued result', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const jobs = new ProfilePreparations(f.store, f.work),
    deadlineAt = Date.now() + 60000,
    row = await jobs.begin(
      actor,
      { profile: f.publicProfile, requestId: randomUUID(), deadlineAt },
      { aborted: false },
    );
  f.release();
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, row.preparationId)).issuerAvailable).toBe(true),
  );
  const raw = await jobs.result(actor, row.preparationId);
  const register = vi
    .spyOn(f.work, 'registerProfile')
    .mockRejectedValue(
      Object.assign(Error('owned synthetic indeterminate persistence'), { code: 'EIO' }),
    );
  await jobs.register(actor, { ...raw, ownerId: actor.actorId }, deadlineAt, { aborted: false });
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, row.preparationId)).producerPending).toBe(false),
  );
  expect((await jobs.status(actor, row.preparationId)).status).toBe('unknown');
  expect(register).toHaveBeenCalledTimes(1);
  await expect(
    jobs.register(actor, { ...raw, ownerId: actor.actorId }, deadlineAt, { aborted: false }),
  ).rejects.toMatchObject({ code: 'PORTAL_PROFILE_PREPARATION_ISSUER_UNAVAILABLE' });
});
it('never evicts sixty-four unknown preparations to admit a new producer', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const jobs = new ProfilePreparations(f.store, f.work),
    deadlineAt = Date.now() + 60000;
  const first = await jobs.begin(
    actor,
    { profile: f.publicProfile, requestId: randomUUID(), deadlineAt },
    { aborted: false },
  );
  await jobs.cancel(actor, first.preparationId);
  f.release();
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, first.preparationId)).producerPending).toBe(false),
  );
  const current = await f.store.get(
    'profile-preparations',
    first.preparationId,
    ProfilePreparationRecordSchema,
  );
  for (let index = 1; index < 64; index++) {
    const id = randomUUID();
    await f.store.create(
      'profile-preparations',
      id,
      { ...current!, preparationId: id, requestHash: contentHash('owned-retained-fixture', index) },
      ProfilePreparationRecordSchema,
    );
  }
  const before = await jobs.list(actor, { planId: f.plan.planId });
  await expect(
    jobs.begin(
      actor,
      { profile: f.publicProfile, requestId: randomUUID(), deadlineAt: deadlineAt + 64 },
      { aborted: false },
    ),
  ).rejects.toMatchObject({ code: 'PORTAL_PROFILE_PREPARATION_CAPACITY' });
  expect(await jobs.list(actor, { planId: f.plan.planId })).toEqual(before);
  expect(before).toHaveLength(64);
  expect(f.calls()).toBe(1);
});

it('keeps the exact native producer gate until cancelled physical IO settles', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const { PortalNativeWork } = await import('../../src/portal/native-work.js');
  const work = new PortalNativeWork({
    stateRoot: f.stateRoot,
    store: f.store,
    policy: f.policy,
    permissions: f.permissions,
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const task = work.sourceProfileJob(
    f.profile,
    new AbortController().signal,
    Date.now() + 60000,
    async signal => {
      await gate;
      signal.throwIfAborted();
    },
  );
  const observed = task.catch(error => error);
  await vi.waitFor(() => expect(work.hasPendingSourcePreparation(f.run.runId)).toBe(true));
  expect(work.hasPendingSourcePreparation('foreign-run')).toBe(false);
  const cancelling = work.cancel(f.run.runId);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(work.hasPendingSourcePreparation(f.run.runId)).toBe(true);
  release();
  expect(await observed).toMatchObject({ code: 'OPERATION_CANCELLED' });
  await cancelling;
  expect(work.hasPendingSourcePreparation(f.run.runId)).toBe(false);
  await work.close();
  f.release();
});

it('rejects reused client request IDs with changed semantics before dispatching another producer', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const jobs = new ProfilePreparations(f.store, f.work),
    input = { profile: f.publicProfile, requestId: randomUUID(), deadlineAt: Date.now() + 60000 };
  const row = await jobs.begin(actor, input, { aborted: false });
  await expect(
    jobs.begin(actor, { ...input, deadlineAt: input.deadlineAt + 1 }, { aborted: false }),
  ).rejects.toMatchObject({ code: 'PORTAL_PROFILE_PREPARATION_REQUEST_CHANGED' });
  expect(f.calls()).toBe(1);
  expect(
    await jobs.list(actor, {
      planId: f.plan.planId,
      requestId: input.requestId,
      requestHash: row.requestHash,
    }),
  ).toHaveLength(1);
  await jobs.cancel(actor, row.preparationId);
  f.release();
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, row.preparationId)).producerPending).toBe(false),
  );
});

it.each([
  'valid',
  'clone',
  'different-request',
  'profile-change',
  'source-change',
  'root-change',
  'cancelled',
  'closed',
  'consumed',
] as const)('keeps freshly revalidated compiler authority private and one-use %s', async mode => {
  const { portalFixture } = await import('./fixtures.js');
  const f = await portalFixture();
  cleanups.push(f.cleanup);
  const { epicCompilerFixture } = await import('./epic-compiler-fixture.js');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { PortalCoordinator } = await import('../../src/portal/coordinator.js');
  const { PortalNativeWork, PortalNativeProfileSchema } =
    await import('../../src/portal/native-work.js');
  const { PortalPlanSchema, storedChecksum } = await import('@sfp/ir');
  const { nativeExecutableHash } = await import('../../src/portal/native-runner.js');
  const sourceRoot = join(f.workspaceRoot, 'epic');
  const manifest = JSON.parse(epicCompilerFixture['package.json']);
  const names = [
    '@react-router/dev',
    '@react-router/express',
    'react-router',
    'vite',
    '@tailwindcss/vite',
    'express',
    '@epic-web/config',
    '@sentry/react-router',
    'react-router-devtools',
    'vite-env-only',
    'vite-plugin-icons-spritesheet',
    'react-router-auto-routes',
  ];
  const installed: Record<string, unknown> = { '': manifest };
  for (const name of names) {
    const spec = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name],
      version = /^\D*(\d+\.\d+\.\d+)/u.exec(spec)?.[1] ?? '7.0.0';
    installed['node_modules/' + name] = { version, integrity: 'sha512-YWJjZA==' };
    await mkdir(join(sourceRoot, 'node_modules', name), { recursive: true });
    await writeFile(
      join(sourceRoot, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version }),
    );
  }
  const files = {
    ...epicCompilerFixture,
    'server/app.ts': 'export const app=true;',
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: installed }),
    'app/components/ui/icons/sprite.svg': '<svg/>',
    'app/components/ui/icons/types.ts': 'export type IconName="owned";',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(sourceRoot, path)), { recursive: true });
    await writeFile(join(sourceRoot, path), text);
  }
  await writeFile(
    join(f.workspaceRoot, 'design.json'),
    JSON.stringify({
      requestedUrl: 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1',
      requestedNodeId: '0:1',
      nodes: [{ id: '0:1', type: 'FRAME', name: 'Synthetic authority fixture' }],
    }),
  );
  const work = new PortalNativeWork({
      stateRoot: f.stateRoot,
      store: f.store,
      policy: f.policy,
      permissions: f.permissions,
    }),
    coordinator = new PortalCoordinator(f.store, f.policy, work);
  let counter = 0;
  const invoke = async (name: any, args: any) => {
    const operationId = 'fresh-source-' + ++counter,
      authority = await coordinator.prepare(name, args, actor, f.workspaceId, operationId);
    return coordinator.execute(name, args, {
      actor,
      workspaceId: f.workspaceId,
      operationId,
      authority,
      signal: new AbortController().signal,
    });
  };
  const summary: any = await invoke('portal_plan', {
    case: 'legacy',
    targetPath: 'epic',
    design: { artifactPath: 'design.json', freshness: 'allow-pinned' },
  });
  await invoke('portal_start', { planId: summary.planId });
  const plan = (await f.store.get('plans', summary.planId, PortalPlanSchema))!;
  const raw = PortalNativeProfileSchema.parse({
    schemaVersion: 1,
    sourceAuthorityVersion: 2,
    ownerId: actor.actorId,
    planId: plan.planId,
    contextHash: plan.contextHash,
    purpose: 'source-preparation',
    sourcePreparation: {
      sourceId: plan.profiles[0]!.graph.sourceId,
      packageContextRoot: sourceRoot,
    },
    native: {
      schemaVersion: 1,
      sourceAuthorityVersion: 2,
      id: 'epic-fresh-profile',
      executionMode: 'native-working-copy',
      environmentKind: 'disposable-test',
      sourceHash: plan.profiles[0]!.graph.sourceHash,
      closure: [{ path: 'server/app.ts', hash: storedChecksum(files['server/app.ts']) }],
      environment: {},
      commands: [
        {
          id: 'placeholder',
          executable: process.execPath,
          executableHash: await nativeExecutableHash(process.execPath),
          args: ['-e', ''],
          timeoutMs: 1000,
        },
      ],
    },
    assertions: [
      {
        commandId: 'placeholder',
        check: {
          id: 'source-placeholder',
          kind: 'source-scope',
          requirementIds: [],
          required: true,
        },
      },
    ],
  });
  const token = Object.freeze({}),
    controller = new AbortController(),
    fresh = await work.prepareProfile(raw, controller.signal, undefined, token),
    expected = JSON.parse(JSON.stringify(fresh));
  if (mode === 'profile-change') expected.contextHash = 'sha256:' + 'b'.repeat(64);
  if (mode === 'root-change')
    expected.sourcePreparation.packageContextRoot = join(f.workspaceRoot, 'foreign');
  if (mode === 'closed') await work.close();
  if (mode === 'cancelled')
    controller.abort(Object.assign(Error('OPERATION_CANCELLED'), { code: 'OPERATION_CANCELLED' }));
  const take = () =>
    (work as any).takeFreshCompilerProfile(
      mode === 'clone' ? JSON.parse(JSON.stringify(fresh)) : fresh,
      expected,
      mode === 'different-request' ? {} : token,
      mode === 'source-change' ? 'sha256:' + 'c'.repeat(64) : fresh.native.sourceHash,
      Date.now() + 60000,
      controller.signal,
    );
  try {
    let native: typeof fresh.native | undefined,
      errorCode: string | null = null,
      secondError: string | null = null;
    try {
      const paired = take();
      native = paired.native;
      const { reactRouterCompilerProfileMatchesSource } =
        await import('../../src/portal/react-router-compiler-evidence.js');
      if (
        !reactRouterCompilerProfileMatchesSource(paired.native, paired.source) ||
        reactRouterCompilerProfileMatchesSource(paired.native, { ...paired.source })
      )
        throw Error('OWNED_SOURCE_PAIRING_FAILED');
      if (mode === 'consumed') {
        try {
          take();
        } catch (error) {
          secondError = (error as { code: string }).code;
        }
      }
    } catch (error) {
      errorCode = (error as { code: string }).code;
    }
    const { reactRouterCompilerUsesProvisionedModules } =
      await import('../../src/portal/react-router-compiler-evidence.js');
    expect(
      Boolean(native && reactRouterCompilerUsesProvisionedModules(native, 'react-router-compiler')),
    ).toBe(['valid', 'consumed'].includes(mode));
    expect(errorCode).toBe(
      ['valid', 'consumed'].includes(mode)
        ? null
        : mode === 'cancelled'
          ? 'OPERATION_CANCELLED'
          : 'PORTAL_PROFILE_PREPARATION_CHANGED',
    );
    expect(secondError).toBe(mode === 'consumed' ? 'PORTAL_PROFILE_PREPARATION_CHANGED' : null);
  } finally {
    await work.close();
  }
});

it('tracks admitted source preverification before any compiler attempt and fences next until actual cancelled IO settles', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const { PortalNativeWork } = await import('../../src/portal/native-work.js');
  const { PortalCoordinator } = await import('../../src/portal/coordinator.js');
  const work = new PortalNativeWork({
      stateRoot: f.stateRoot,
      store: f.store,
      policy: f.policy,
      permissions: f.permissions,
    }),
    coordinator = new PortalCoordinator(f.store, f.policy, work);
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  let entered = false;
  vi.spyOn(work as any, 'compilerSource').mockImplementation(async (...args: unknown[]) => {
    entered = true;
    await gate;
    (args[2] as AbortSignal).throwIfAborted();
    throw Error('OWNED_STOP_BEFORE_NATIVE_ATTEMPT');
  });
  const input = {
      runId: f.run.runId,
      profileId: f.profile.native.id,
      sourceId: f.profile.sourcePreparation!.sourceId,
      deadlineAt: f.run.deadlineAt,
    },
    operationId = 'held-preverification';
  const authority = await coordinator.prepare(
    'portal_prepare_source',
    input,
    actor,
    f.plan.workspaceId,
    operationId,
  );
  const task = coordinator.execute('portal_prepare_source', input, {
    actor,
    workspaceId: f.plan.workspaceId,
    operationId,
    authority,
    signal: new AbortController().signal,
  });
  const outcome = task.catch(error => error);
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    expect(work.hasPendingSourcePreparation(f.run.runId)).toBe(true);
    await expect(
      coordinator.prepare(
        'portal_next',
        { runId: f.run.runId },
        actor,
        f.plan.workspaceId,
        'conflicting-next',
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_NATIVE_RUN_BUSY' });
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    expect(await readdir(join(f.stateRoot, 'portal/compiler-attempts')).catch(() => [])).toEqual(
      [],
    );
    const cancellation = work.cancel(f.run.runId);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(work.hasPendingSourcePreparation(f.run.runId)).toBe(true);
    release();
    expect(await outcome).toMatchObject({ code: 'OPERATION_CANCELLED' });
    await cancellation;
    expect(work.hasPendingSourcePreparation(f.run.runId)).toBe(false);
  } finally {
    release();
    await outcome;
    await work.close();
    f.release();
  }
});

it('reserves retained profile producer ownership before its first signed store read', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const { PortalNativeWork } = await import('../../src/portal/native-work.js');
  const { PortalCoordinator } = await import('../../src/portal/coordinator.js');
  const work = new PortalNativeWork({
      stateRoot: f.stateRoot,
      store: f.store,
      policy: f.policy,
      permissions: f.permissions,
    }),
    coordinator = new PortalCoordinator(f.store, f.policy, work);
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  let holdFirst = true,
    entered = false;
  const original = f.store.get.bind(f.store);
  vi.spyOn(f.store, 'get').mockImplementation(async (...args: Parameters<typeof f.store.get>) => {
    if (holdFirst && args[0] === 'plans' && args[1] === f.plan.planId) {
      holdFirst = false;
      entered = true;
      await gate;
    }
    return original(...args);
  });
  const action = vi.fn<() => Promise<void>>(async () => {}),
    task = work.sourceProfileJob(
      f.profile,
      new AbortController().signal,
      Date.now() + 60000,
      action,
    ),
    outcome = task.catch(error => error);
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    expect(work.hasPendingSourcePreparation(f.run.runId)).toBe(true);
    await expect(
      coordinator.prepare(
        'portal_next',
        { runId: f.run.runId },
        actor,
        f.plan.workspaceId,
        'held-first-read-next',
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_NATIVE_RUN_BUSY' });
    await expect(
      coordinator.prepare(
        'portal_submit',
        {
          runId: f.run.runId,
          leaseId: '123e4567-e89b-42d3-a456-426614174000',
          leaseEpoch: 1,
          blueprintHash: 'sha256:' + 'a'.repeat(64),
          contextHash: f.plan.contextHash,
          files: [
            {
              path: 'owned-fixture.ts',
              action: 'create',
              baseHash: null,
              content: 'export {};',
              contentHash: 'sha256:' + 'c'.repeat(64),
            },
          ],
        },
        actor,
        f.plan.workspaceId,
        'held-first-read-submit',
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_NATIVE_RUN_BUSY' });
    const cancellation = work.cancel(f.run.runId);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(work.hasPendingSourcePreparation(f.run.runId)).toBe(true);
    release();
    expect(await outcome).toMatchObject({ code: 'OPERATION_CANCELLED' });
    await cancellation;
    expect(action).not.toHaveBeenCalled();
    expect(work.hasPendingSourcePreparation(f.run.runId)).toBe(false);
  } finally {
    release();
    await outcome;
    await work.close();
    f.release();
  }
});

it('completed preparation cancellation is an explicit no-op and later registration remains a separate confirmed action', async () => {
  const f = await profileJobFixture();
  cleanups.push(f.cleanup);
  const jobs = new ProfilePreparations(f.store, f.work),
    deadlineAt = Date.now() + 60000,
    row = await jobs.begin(
      actor,
      { profile: f.publicProfile, requestId: randomUUID(), deadlineAt },
      { aborted: false },
    );
  f.release();
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, row.preparationId)).issuerAvailable).toBe(true),
  );
  const before = await jobs.status(actor, row.preparationId),
    result = await jobs.result(actor, row.preparationId);
  expect(await jobs.cancel(actor, row.preparationId)).toEqual(before);
  expect(f.registers()).toBe(0);
  expect(await jobs.result(actor, row.preparationId)).toEqual(result);
  await jobs.register(actor, { ...result, ownerId: actor.actorId }, deadlineAt, { aborted: false });
  await vi.waitFor(async () =>
    expect((await jobs.status(actor, row.preparationId)).status).toBe('registered'),
  );
  const completed = await jobs.status(actor, row.preparationId);
  expect(await jobs.cancel(actor, row.preparationId)).toEqual(completed);
  expect(f.registers()).toBe(1);
});

it.each(['PORTAL_COMPILER_LOCK_IMPORTER_REQUIRED', 'private-secret-shaped-code'] as const)(
  'retains only closed useful prerequisite errors in source profile status %s',
  async errorCode => {
    const f = await profileJobFixture();
    cleanups.push(f.cleanup);
    vi.spyOn(f.work, 'prepareProfile').mockRejectedValue(
      Object.assign(Error('untrusted private-message canary'), { code: errorCode }),
    );
    const jobs = new ProfilePreparations(f.store, f.work),
      row = await jobs.begin(
        actor,
        { profile: f.publicProfile, requestId: randomUUID(), deadlineAt: Date.now() + 60000 },
        { aborted: false },
      );
    await vi.waitFor(async () =>
      expect((await jobs.status(actor, row.preparationId)).producerPending).toBe(false),
    );
    const status = await jobs.status(actor, row.preparationId);
    expect(status.errorCode).toBe(
      errorCode === 'PORTAL_COMPILER_LOCK_IMPORTER_REQUIRED'
        ? errorCode
        : 'PORTAL_PROFILE_PREPARATION_FAILED',
    );
    expect(JSON.stringify(status)).not.toContain('private-message');
    expect(JSON.stringify(status)).not.toContain('private-secret');
    f.release();
  },
);
