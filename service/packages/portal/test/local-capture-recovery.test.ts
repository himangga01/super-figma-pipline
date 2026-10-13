import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { ChromeSessionOwner } from '../../cli/src/browser-session.js';
import type { ControlClient } from '../../cli/src/control-client.js';
import { isLocalCapturePreEffectFailure } from '../../cli/src/library.js';
import * as library from '../../cli/src/library.js';
import { localCaptureExecution } from '../../cli/src/local-capture-execution.js';
import { PortalBridge } from '../src/bridge.js';
import { createServiceJobRuntime } from '../src/control.js';
import { createPortalServer } from '../src/server.js';
import { ServiceJobs, type ServiceJobRuntime } from '../src/service-jobs.js';
import { PortalStore } from '../src/store.js';

const roots: string[] = [];
const managers: ServiceJobs[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.idle();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const digest = `sha256:${'1'.repeat(64)}`;
const workspaceId = '00000000-0000-4000-8000-000000000001';
const request = {
  type: 'feature',
  name: 'chrome.export',
  args: { private: 'NEVER_CAPTURE_ARGUMENT' },
  workspaceId,
  targetSelector: { kind: 'none' },
};
function runtime(overrides: Partial<ServiceJobRuntime> = {}): ServiceJobRuntime {
  return {
    catalog: async () => ({ tools: [], features: [] }),
    prepare: async input => ({
      args: input.args,
      descriptor: {
        name: input.name,
        description: 'Fixture capture',
        group: 'chrome',
        kind: 'write',
        inputSchema: {},
        prerequisites: [],
        confirmationRequired: false,
        executionProof: 'composite',
      },
    }),
    execute: async () => {
      throw Error('CHROME_CONNECTION_REQUIRED');
    },
    decide: async () => {},
    inspect: async () => null,
    localCaptureQuiescence: () => 'quiescent',
    recoveryWorkspaceBinding: async () => digest,
    ...overrides,
  };
}
async function fixture(control = runtime()) {
  const root = await mkdtemp(join(tmpdir(), 'sfp-local-recovery-'));
  roots.push(root);
  const store = await PortalStore.open(root);
  const jobs = await ServiceJobs.open(store, control);
  managers.push(jobs);
  return { root, store, jobs, control };
}
async function failed(f: Awaited<ReturnType<typeof fixture>>, input = request) {
  const job = await f.jobs.create(input);
  await f.jobs.idle();
  expect(f.jobs.get(job.id).status).toBe('unknown');
  return f.jobs.get(job.id);
}
function confirmation(job: ReturnType<ServiceJobs['get']>, overrides = {}) {
  const challenge = job.recovery.challenge!;
  return {
    action: 'abandon-local',
    challengeId: challenge.id,
    fingerprint: challenge.fingerprint,
    workspaceBinding: challenge.workspaceBinding,
    confirm: `${job.id}/${challenge.fingerprint}`,
    reasonHash: digest,
    evidenceHash: digest,
    ...overrides,
  };
}

it('records a separate durable owner disposition without changing the original unknown or replaying it', async () => {
  const execute = vi.fn<ServiceJobRuntime['execute']>(runtime().execute);
  const f = await fixture(runtime({ execute }));
  const original = await failed(f);
  const prepared = await f.jobs.action(original.id, { action: 'prepare-recovery' });
  const recovered = await f.jobs.action(original.id, confirmation(prepared));
  const { fenceDisposition, ...stored } = JSON.parse(
    await readFile(join(f.root, 'service-jobs.json'), 'utf8'),
  ).jobs[0];
  const before = JSON.parse(JSON.stringify(original));
  for (const key of Object.keys(stored)) expect(stored[key]).toEqual(before[key]);
  expect(fenceDisposition).toMatchObject({ decision: 'owner-abandoned', quiescence: 'observed' });
  expect(recovered.status).toBe('unknown');
  expect(execute).toHaveBeenCalledTimes(1);
  expect(f.jobs.hasUnknownMutation(workspaceId)).toBe(false);
  const restarted = await ServiceJobs.open(f.store, f.control);
  managers.push(restarted);
  expect(restarted.hasUnknownMutation(workspaceId)).toBe(false);
  expect(restarted.get(original.id).deadlineAt).toBe(original.deadlineAt);
  expect(f.store.listActivities().activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: fenceDisposition.activityId, status: 'succeeded' }),
    ]),
  );
  const persisted = await readFile(join(f.root, 'service-jobs.json'), 'utf8');
  expect(persisted).not.toContain('NEVER_CAPTURE_ARGUMENT');
  await expect(f.jobs.action(original.id, confirmation(prepared))).rejects.toThrow(
    'LOCAL_CAPTURE_RECOVERY_UNAVAILABLE',
  );
});

it.each(['wrong-token', 'wrong-fingerprint', 'wrong-binding', 'expired', 'changed-workspace'])(
  'rejects mismatched or stale local recovery confirmation: %s',
  async mode => {
    let binding = digest;
    const f = await fixture(runtime({ recoveryWorkspaceBinding: async () => binding }));
    const original = await failed(f);
    const prepared = await f.jobs.action(original.id, { action: 'prepare-recovery' });
    const input = confirmation(prepared);
    if (mode === 'wrong-token') input.challengeId = randomUUID();
    if (mode === 'wrong-fingerprint') input.fingerprint = `sha256:${'2'.repeat(64)}`;
    if (mode === 'wrong-binding') input.workspaceBinding = `sha256:${'2'.repeat(64)}`;
    if (mode === 'changed-workspace') binding = `sha256:${'2'.repeat(64)}`;
    const clock =
      mode === 'expired' ? vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001) : null;
    try {
      await expect(f.jobs.action(original.id, input)).rejects.toThrow(
        'LOCAL_CAPTURE_RECOVERY_CONFIRMATION_INVALID',
      );
    } finally {
      clock?.mockRestore();
    }
    expect(f.jobs.hasUnknownMutation(workspaceId)).toBe(true);
    expect(f.jobs.get(original.id).deadlineAt).toBe(original.deadlineAt);
  },
);

it.each(['null-workspace', 'journal-backed', 'unsupported'])(
  'does not release unsupported uncertainty: %s',
  async mode => {
    const f = await fixture(
      runtime({
        execute: async (input, context) => {
          if (mode === 'journal-backed')
            await context.beforeInvoke({
              operationId: 'original-daemon-operation',
              name: 'get_pages',
              kind: 'tool',
              workspaceId: input.workspaceId,
            });
          throw Error('CONTROL_AUTH_BUSY');
        },
      }),
    );
    const original = await failed(f, {
      ...request,
      workspaceId: mode === 'null-workspace' ? null : workspaceId,
      name: mode === 'unsupported' ? 'desktop.connect' : request.name,
    } as typeof request);
    await expect(f.jobs.action(original.id, { action: 'prepare-recovery' })).rejects.toThrow(
      'LOCAL_CAPTURE_RECOVERY_UNAVAILABLE',
    );
  },
);

it('requires a named legacy owner assertion and still blocks unconfirmed current cleanup', async () => {
  let quiescent = true;
  const f = await fixture(
    runtime({ localCaptureQuiescence: () => (quiescent ? 'quiescent' : 'unconfirmed') }),
  );
  const original = await failed(f);
  const restarted = await ServiceJobs.open(f.store, f.control);
  managers.push(restarted);
  quiescent = false;
  await expect(restarted.action(original.id, { action: 'prepare-recovery' })).rejects.toThrow(
    'LOCAL_CAPTURE_RECOVERY_UNAVAILABLE',
  );
  quiescent = true;
  const prepared = await restarted.action(original.id, { action: 'prepare-recovery' });
  expect(prepared.recovery.legacyAssertionRequired).toBe(true);
  await expect(restarted.action(original.id, confirmation(prepared))).rejects.toThrow(
    'LOCAL_CAPTURE_RECOVERY_CONFIRMATION_INVALID',
  );
  const result = await restarted.action(
    original.id,
    confirmation(prepared, { priorProducerRetired: true }),
  );
  expect(result.fenceDisposition?.quiescence).toBe('operator-asserted-prior-runtime');
  expect(result.status).toBe('unknown');
});

it('does not confuse cancellation of the caller with settlement of the real producer', async () => {
  let finish!: () => void;
  const producer = new Promise<void>(resolve => {
    finish = resolve;
  });
  const f = await fixture(runtime({ execute: async () => producer }));
  const job = await f.jobs.create(request);
  while (f.jobs.get(job.id).status === 'queued')
    await new Promise(resolve => setTimeout(resolve, 5));
  await f.jobs.action(job.id, { action: 'cancel' });
  await f.jobs.idle();
  expect(f.jobs.get(job.id).status).toBe('unknown');
  await expect(f.jobs.action(job.id, { action: 'prepare-recovery' })).rejects.toThrow(
    'LOCAL_CAPTURE_RECOVERY_UNAVAILABLE',
  );
  finish();
  await producer;
  await Promise.resolve();
  expect(
    (await f.jobs.action(job.id, { action: 'prepare-recovery' })).recovery.challenge,
  ).not.toBeNull();
});

it('keeps the fence on audit or real store publication failure', async () => {
  const f = await fixture();
  const original = await failed(f);
  const prepared = await f.jobs.action(original.id, { action: 'prepare-recovery' });
  const audit = vi
    .spyOn(f.store, 'recordActivity')
    .mockRejectedValueOnce(Error('owned audit failure'));
  await expect(f.jobs.action(original.id, confirmation(prepared))).rejects.toThrow(
    'owned audit failure',
  );
  audit.mockRestore();
  expect(f.jobs.hasUnknownMutation(workspaceId)).toBe(true);
  const again = await f.jobs.action(original.id, { action: 'prepare-recovery' });
  await rm(join(f.root, 'service-jobs.json'));
  await mkdir(join(f.root, 'service-jobs.json'));
  await expect(f.jobs.action(original.id, confirmation(again))).rejects.toThrow(
    /EPERM|EISDIR|EEXIST/u,
  );
  expect(f.jobs.hasUnknownMutation(workspaceId)).toBe(true);
  expect(f.jobs.get(original.id).fenceDisposition).toBeUndefined();
});

it('rechecks challenge expiry after a delayed durable audit at serialized commit', async () => {
  const f = await fixture();
  const original = await failed(f);
  const prepared = await f.jobs.action(original.id, { action: 'prepare-recovery' });
  const originalAudit = f.store.recordActivity.bind(f.store);
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  const delayed = vi.spyOn(f.store, 'recordActivity').mockImplementation(async input => {
    const row = await originalAudit(input);
    clock = vi.spyOn(Date, 'now').mockReturnValue(prepared.recovery.challenge!.expiresAt + 1);
    return row;
  });
  try {
    await expect(f.jobs.action(original.id, confirmation(prepared))).rejects.toThrow(
      'LOCAL_CAPTURE_RECOVERY_UNAVAILABLE',
    );
  } finally {
    clock?.mockRestore();
    delayed.mockRestore();
  }
  expect(f.jobs.hasUnknownMutation(workspaceId)).toBe(true);
  expect(f.jobs.get(original.id).fenceDisposition).toBeUndefined();
});

it.each([false, true])(
  'only new internally proven pre-effect failures avoid an unknown fence, effect issued=%s',
  async effectIssued => {
    const f = await fixture(
      runtime({
        preEffectFailure: isLocalCapturePreEffectFailure,
        execute: async (_input, context) => {
          const capture = localCaptureExecution(context.executionId, context.progress);
          capture.progress('connecting');
          if (effectIssued) capture.beforeEffect();
          throw capture.failure(Error('CHROME_CONNECTION_REQUIRED'));
        },
      }),
    );
    const job = await f.jobs.create(request);
    await f.jobs.idle();
    expect(f.jobs.get(job.id).status).toBe(effectIssued ? 'unknown' : 'failed');
    expect(f.jobs.get(job.id).preEffectFailure).toBe(effectIssued ? undefined : true);
    expect(f.jobs.hasUnknownMutation(workspaceId)).toBe(effectIssued);
  },
);

it('does not report capture success when a suppressed physical cleanup failed', async () => {
  const owner = new ChromeSessionOwner();
  const failedCleanup = Promise.reject(Error('owned suppressed cleanup failure'));
  owner.trackCaptureWork(failedCleanup, true);
  await failedCleanup.catch(() => undefined);
  const control = createServiceJobRuntime(
    {} as ControlClient,
    { ...library, executeServiceFeature: async () => ({ status: 'document-exported' }) },
    async () => [],
    owner,
  );
  const f = await fixture(
    runtime({
      execute: (input, context) => control.execute(input, context),
      localCaptureQuiescence: () => owner.captureQuiescence(),
    }),
  );
  const job = await failed(f);
  expect(job.errorCode).toBe('CHROME_SOURCE_CLEANUP_UNCONFIRMED');
  expect(job.recovery.available).toBe(false);
  expect(job.outputHash).toBeNull();
  await owner.close();
});

it('uses real same-origin HTTP recovery, keeps a second fence and excludes private progress values', async () => {
  const f = await fixture(
    runtime({
      execute: async (_input, context) => {
        context.progress?.('connecting');
        context.progress?.('PRIVATE_TOKEN_SHAPED_PHASE' as never);
        context.emit({
          status: 'connecting',
          endpoint: 'ws://PRIVATE_ENDPOINT',
          token: 'PRIVATE_PROGRESS_TOKEN',
        });
        throw Error('CHROME_CONNECTION_REQUIRED');
      },
    }),
  );
  const bridge = new PortalBridge(f.store, {
    health: async () => true,
    workspaces: async () => [],
    invoke: async () => null,
    decide: async () => {},
    serviceJobs: f.control,
  });
  const server = createPortalServer({ store: f.store, bridge, webRoot: f.root });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const bootstrap = (await fetch(base + '/api/bootstrap').then(response => response.json())) as {
      csrfToken: string;
    };
    const post = (path: string, body: unknown, csrf = true) =>
      fetch(base + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: base,
          ...(csrf ? { 'x-sfp-csrf': bootstrap.csrfToken } : {}),
        },
        body: JSON.stringify(body),
      });
    const manager = await bridge.jobs();
    const [first, second] = await Promise.all([manager.create(request), manager.create(request)]);
    await manager.idle();
    const endpoint = `/api/service/jobs/${first.id}/actions`;
    expect((await post(endpoint, { action: 'prepare-recovery' }, false)).status).toBe(403);
    const preparedResponse = await post(endpoint, { action: 'prepare-recovery' });
    expect(preparedResponse.status).toBe(202);
    const prepared = ((await preparedResponse.json()) as { job: ReturnType<ServiceJobs['get']> })
      .job;
    expect((await post(endpoint, confirmation(prepared))).status).toBe(202);
    expect(manager.get(first.id).status).toBe('unknown');
    expect(manager.get(second.id).status).toBe('unknown');
    expect(manager.hasUnknownMutation(null)).toBe(true);
    expect(manager.hasUnknownMutation(workspaceId)).toBe(true);
    const publicRows = await fetch(base + '/api/service/jobs').then(response => response.text());
    const activities = await fetch(base + '/api/activities').then(response => response.text());
    expect(
      publicRows + activities + (await readFile(join(f.root, 'service-jobs.json'), 'utf8')),
    ).not.toMatch(
      /PRIVATE_TOKEN_SHAPED_PHASE|PRIVATE_ENDPOINT|PRIVATE_PROGRESS_TOKEN|NEVER_CAPTURE_ARGUMENT/,
    );
    expect(manager.get(first.id).progress).toEqual([
      expect.objectContaining({ phase: 'connecting' }),
    ]);
    await manager.idle();
  } finally {
    await bridge.close();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
