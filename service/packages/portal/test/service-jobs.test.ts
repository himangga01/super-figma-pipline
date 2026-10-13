import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { PortalBridge } from '../src/bridge.js';
import { createPortalServer } from '../src/server.js';

const journalProof = (overrides: Record<string, unknown> = {}) => ({
  actorId: `actor1_${'A'.repeat(43)}`,
  originAuthSessionId: `auth1_${'A'.repeat(43)}`,
  origin: { kind: 'entry', entryPath: 'control', authSessionId: `auth1_${'A'.repeat(43)}` },
  operationId: 'original-op',
  issuedAt: 1,
  expiresAt: 2592000001,
  operationKind: 'tool',
  operationName: 'get_pages',
  argsHash: `sha256:${'1'.repeat(64)}`,
  captureIntentHash: `sha256:${'2'.repeat(64)}`,
  operationFingerprintHash: `sha256:${'3'.repeat(64)}`,
  workspaceId: null,
  fileExecutionKey: null,
  fileExecutionKeyHash: null,
  targetBindingHash: null,
  resultHash: `sha256:${'4'.repeat(64)}`,
  operationEvidenceReceiptHash: null,
  finalEgressManifestHash: null,
  settledAt: '2026-10-11T12:00:00.000Z',
  status: 'succeeded',
  ...overrides,
});
import { ServiceJobs, type ServiceJobRuntime } from '../src/service-jobs.js';
import { PortalStore } from '../src/store.js';

const roots: string[] = [];
const managers: ServiceJobs[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.idle();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const request = {
  type: 'tool',
  name: 'get_pages',
  args: {},
  workspaceId: null,
  targetSelector: { kind: 'active' },
};
const descriptor = {
  name: 'get_pages',
  description: 'Read pages',
  group: 'figma',
  kind: 'read' as const,
  inputSchema: {},
  prerequisites: [],
  confirmationRequired: false,
  executionProof: 'single-operation' as const,
};
function runtime(overrides: Partial<ServiceJobRuntime> = {}): ServiceJobRuntime {
  return {
    catalog: async () => ({ tools: [descriptor], features: [] }),
    prepare: async input => {
      if (input.name !== 'get_pages') throw Error('unknown');
      return { descriptor, args: input.args };
    },
    execute: async (_input, context) => {
      await context.beforeInvoke({
        operationId: 'original-op',
        name: 'get_pages',
        kind: 'tool',
        workspaceId: null,
      });
      return { ok: true };
    },
    decide: async () => {},
    inspect: async () => null,
    ...overrides,
  };
}
async function fixture(control = runtime()) {
  const root = await mkdtemp(join(tmpdir(), 'sfp-jobs-'));
  roots.push(root);
  const store = await PortalStore.open(root);
  const jobs = await ServiceJobs.open(store, control);
  managers.push(jobs);
  return { root, jobs };
}
async function settle(jobs: ServiceJobs, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = jobs.get(id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return jobs.get(id);
}

it('retains the original operation before dispatch and never persists arguments or result bodies', async () => {
  let root = '';
  const f = await fixture(
    runtime({
      execute: async (input, context) => {
        await context.beforeInvoke({
          operationId: 'original-op',
          name: input.name,
          kind: 'tool',
          workspaceId: null,
        });
        expect(await readFile(join(root, 'service-jobs.json'), 'utf8')).toContain('original-op');
        return { token: 'RESULT_SECRET_SENTINEL', files: ['code-body'] };
      },
    }),
  );
  root = f.root;
  const job = await f.jobs.create({ ...request, args: { sentinel: 'ARG_SECRET_SENTINEL' } });
  const result = await settle(f.jobs, job.id);
  expect(result.status).toBe('succeeded');
  expect(result.outputHash).toMatch(/^sha256:/);
  const disk = await readFile(join(root, 'service-jobs.json'), 'utf8');
  expect(disk).not.toMatch(/SECRET_SENTINEL|code-body/);
  const restarted = await ServiceJobs.open(await PortalStore.open(root), runtime());
  expect(restarted.get(job.id).outputUnavailable).toBe('RESULT_NOT_RETAINED_AFTER_RESTART');
});
it('requires explicit local confirmation and rejects arbitrary names without dispatch', async () => {
  const execute = vi.fn<() => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
  const f = await fixture(
    runtime({
      prepare: async input => {
        if (input.name !== request.name) throw Error('unknown');
        return {
          args: input.args,
          descriptor: {
            ...descriptor,
            kind: 'write',
            confirmationRequired: true,
            executionProof: 'local',
          },
        };
      },
      execute,
    }),
  );
  await expect(f.jobs.create({ ...request, name: 'arbitrary_shell' })).rejects.toThrow('unknown');
  const job = await f.jobs.create(request);
  expect(job.status).toBe('awaiting-confirmation');
  expect(execute).not.toHaveBeenCalled();
  await f.jobs.action(job.id, { action: 'approve', approvalId: job.approvals[0]!.approvalId });
  expect((await settle(f.jobs, job.id)).status).toBe('succeeded');
  expect(execute).toHaveBeenCalledTimes(1);
});
it('preserves dispatched unknown state across restart and does not accept unrelated inspection', async () => {
  const f = await fixture(
    runtime({
      prepare: async input => ({ args: input.args, descriptor: { ...descriptor, kind: 'write' } }),
      execute: async (_input, context) => {
        await context.beforeInvoke({
          operationId: 'original-op',
          name: 'get_pages',
          kind: 'tool',
          workspaceId: null,
        });
        throw Object.assign(Error('private'), { code: 'CONTROL_AUTH_BUSY' });
      },
    }),
  );
  const job = await f.jobs.create(request);
  expect((await settle(f.jobs, job.id)).status).toBe('unknown');
  const restarted = await ServiceJobs.open(await PortalStore.open(f.root), runtime());
  await restarted.action(job.id, { action: 'inspect' });
  expect(restarted.get(job.id).status).toBe('unknown');
});
it('reserves capacity synchronously before asynchronous argument preparation', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const f = await fixture(
    runtime({
      prepare: async input => {
        await held;
        return { descriptor, args: input.args };
      },
      execute: async () => {
        await held;
        return {};
      },
    }),
  );
  const pending = Array.from({ length: 5 }, () => f.jobs.create(request));
  release();
  const result = await Promise.allSettled(pending);
  expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(4);
});

it('blocks new writes after unknown writes while allowing read-only diagnostics', async () => {
  const f = await fixture(
    runtime({
      prepare: async input => ({
        args: input.args,
        descriptor: { ...descriptor, kind: input.args.write ? 'write' : 'read' },
      }),
      execute: async (input, context) => {
        if (input.args.write) {
          await context.beforeInvoke({
            operationId: 'original-op',
            name: input.name,
            kind: 'tool',
            workspaceId: null,
          });
          throw Error('uncertain');
        }
        return { ok: true };
      },
    }),
  );
  const first = await f.jobs.create({ ...request, args: { write: true } });
  expect((await settle(f.jobs, first.id)).status).toBe('unknown');
  await expect(f.jobs.create({ ...request, args: { write: true } })).rejects.toThrow(
    'SERVICE_JOB_OUTCOME_UNKNOWN',
  );
  const diagnostic = await f.jobs.create(request);
  expect((await settle(f.jobs, diagnostic.id)).status).toBe('succeeded');
});

it('fails read-only authentication errors without inventing an uncertain mutation', async () => {
  const f = await fixture(
    runtime({
      prepare: async input => ({
        args: input.args,
        descriptor: { ...descriptor, executionProof: 'composite' },
      }),
      execute: async () => {
        throw Object.assign(Error('private text'), { code: 'AUTH_REQUIRED' });
      },
    }),
  );
  const job = await f.jobs.create(request);
  expect((await settle(f.jobs, job.id)).status).toBe('failed');
});

it('does not dispatch when initial durable retention fails', async () => {
  const execute = vi.fn<() => Promise<Record<string, never>>>(async () => ({}));
  const f = await fixture(runtime({ execute }));
  await mkdir(join(f.root, 'service-jobs.json'));
  await expect(f.jobs.create(request)).rejects.toThrow(/EPERM|EACCES|EISDIR/);
  expect(execute).not.toHaveBeenCalled();
});

it('rejects extra target fields and caller approval bypass fields', async () => {
  const f = await fixture();
  await expect(f.jobs.create({ ...request, approve: true })).rejects.toThrow('supported schema');
  await expect(
    f.jobs.create({ ...request, targetSelector: { kind: 'none', sessionId: 'secret' } }),
  ).rejects.toThrow('supported schema');
});

it('does not replay pre-effect confirmation after restart', async () => {
  const execute = vi.fn<() => Promise<Record<string, never>>>(async () => ({}));
  const control = runtime({
    prepare: async input => ({
      args: input.args,
      descriptor: { ...descriptor, kind: 'write', confirmationRequired: true },
    }),
    execute,
  });
  const f = await fixture(control);
  const job = await f.jobs.create(request);
  const restarted = await ServiceJobs.open(await PortalStore.open(f.root), control);
  expect(restarted.get(job.id).status).toBe('cancelled');
  expect(execute).not.toHaveBeenCalled();
  await f.jobs.action(job.id, { action: 'cancel' });
});

it('only resolves an unknown mutation using the authenticated exact original operation proof', async () => {
  let proof: unknown = journalProof({ operationId: 'unrelated' });
  const f = await fixture(
    runtime({
      prepare: async input => ({ args: input.args, descriptor: { ...descriptor, kind: 'write' } }),
      execute: async (_input, context) => {
        await context.beforeInvoke({
          operationId: 'original-op',
          name: 'get_pages',
          kind: 'tool',
          workspaceId: null,
        });
        throw Error('lost');
      },
      inspect: async () => proof,
    }),
  );
  const job = await f.jobs.create(request);
  await f.jobs.idle();
  expect((await f.jobs.action(job.id, { action: 'inspect' })).status).toBe('unknown');
  proof = journalProof({ workspaceId: '00000000-0000-4000-8000-000000000001' });
  expect((await f.jobs.action(job.id, { action: 'inspect' })).status).toBe('unknown');
  proof = journalProof();
  expect((await f.jobs.action(job.id, { action: 'inspect' })).status).toBe('succeeded');
  expect(f.jobs.get(job.id).operationId).toBe('original-op');
});

it.each(['job', 'guided'] as const)(
  'rechecks the %s unknown fence before approving previously pending writes',
  async fence => {
    let guidedUnknown = false;
    const dispatched: string[] = [];
    const f = await fixture(
      runtime({
        guard: () => {
          if (guidedUnknown) throw Error('RUN_OUTCOME_UNKNOWN');
        },
        prepare: async input => ({
          args: input.args,
          descriptor: {
            ...descriptor,
            kind: 'write',
            confirmationRequired: input.args.pending === true,
          },
        }),
        execute: async (input, context) => {
          await context.beforeInvoke({
            operationId: 'original-op',
            name: 'get_pages',
            kind: 'tool',
            workspaceId: null,
          });
          dispatched.push(input.args.pending ? 'pending' : 'first');
          throw Error('lost');
        },
      }),
    );
    const pending = await f.jobs.create({ ...request, args: { pending: true } });
    if (fence === 'job') {
      await f.jobs.create(request);
      await f.jobs.idle();
    } else guidedUnknown = true;
    await expect(
      f.jobs.action(pending.id, {
        action: 'approve',
        approvalId: pending.approvals[0]!.approvalId,
      }),
    ).rejects.toThrow('OUTCOME_UNKNOWN');
    expect(dispatched).toEqual(fence === 'job' ? ['first'] : []);
    expect(f.jobs.get(pending.id).status).toBe('awaiting-confirmation');
    await f.jobs.action(pending.id, { action: 'cancel' });
  },
);

it('releases a cancelled caller and prevents a held first operation from dispatching a later operation', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  let later = false;
  const f = await fixture(
    runtime({
      prepare: async input => ({ args: input.args, descriptor: { ...descriptor, kind: 'write' } }),
      execute: async (_input, context) => {
        await context.beforeInvoke({
          operationId: 'original-op',
          name: 'get_pages',
          kind: 'tool',
          workspaceId: null,
        });
        await held;
        await context.beforeInvoke({
          operationId: 'later-op',
          name: 'get_pages',
          kind: 'tool',
          workspaceId: null,
        });
        later = true;
        return {};
      },
    }),
  );
  const job = await f.jobs.create(request);
  await expect.poll(() => f.jobs.get(job.id).operations.length).toBe(1);
  await f.jobs.action(job.id, { action: 'cancel' });
  await f.jobs.idle();
  expect(f.jobs.get(job.id).status).toBe('unknown');
  release();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(later).toBe(false);
  expect(f.jobs.get(job.id).operationId).toBe('original-op');
});

it.each(['approve', 'reject'] as const)(
  'fences late %s responses after an uncertain mutation',
  async action => {
    let rejectEffect!: (error: unknown) => void, releaseDecision!: () => void;
    const held = new Promise<unknown>((_resolve, reject) => {
      rejectEffect = reject;
    });
    const decision = new Promise<void>(resolve => {
      releaseDecision = resolve;
    });
    const prompt = {
      version: 1,
      type: 'approval.prompt',
      approvalId: `sfp_ap1_${'a'.repeat(22)}`,
      operationId: 'original-op',
      operationKind: 'tool',
      operationName: 'get_pages',
      channel: 'owner-control-session',
      promptHash: `sha256:${'a'.repeat(64)}`,
      effectSummary: ['document-write'],
      target: { fileIdentityHash: null, label: 'Owned fixture', targetCount: 1 },
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    const f = await fixture(
      runtime({
        prepare: async input => ({
          args: input.args,
          descriptor: { ...descriptor, kind: 'write' },
        }),
        decide: async () => decision,
        execute: async (_input, context) => {
          await context.beforeInvoke({
            operationId: 'original-op',
            name: 'get_pages',
            kind: 'tool',
            workspaceId: null,
          });
          context.emit({ status: 'approval-required', prompt });
          return held;
        },
      }),
    );
    const job = await f.jobs.create(request);
    expect((await settle(f.jobs, job.id)).status).toBe('awaiting-approval');
    const deciding = f.jobs.action(job.id, { action, approvalId: prompt.approvalId });
    rejectEffect(Object.assign(Error('private'), { code: 'CONTROL_AUTH_BUSY' }));
    await f.jobs.idle();
    expect(f.jobs.get(job.id).status).toBe('unknown');
    releaseDecision();
    expect((await deciding).status).toBe('unknown');
  },
);

it('uses closed same-origin HTTP catalog/jobs/settings routes and records safe activity metadata', async () => {
  const f = await fixture();
  const store = await PortalStore.open(f.root);
  const control = {
    health: async () => true,
    workspaces: async () => [],
    invoke: async () => null,
    decide: async () => {},
    serviceJobs: runtime(),
    figmaMcpStatus: async () => ({
      schemaVersion: 1,
      provider: 'daemon-generation-provider',
      providerInstanceId: '00000000-0000-4000-8000-000000000001',
      configurationRecognized: true,
      oauthTokenEnv: null,
      credentialAvailable: false,
      oauthLoginImplemented: false,
      clientRegistration: 'unverified',
    }),
  };
  const bridge = new PortalBridge(store, control);
  const server = createPortalServer({ store, bridge, webRoot: f.root });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const { csrfToken } = (await fetch(base + '/api/bootstrap').then(response =>
      response.json(),
    )) as { csrfToken: string };
    expect(
      (
        (await fetch(base + '/api/service/catalog').then(response => response.json())) as {
          tools: unknown[];
        }
      ).tools,
    ).toHaveLength(1);
    expect(
      (
        await fetch(base + '/api/service/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        })
      ).status,
    ).toBe(403);
    const response = await fetch(base + '/api/service/jobs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sfp-csrf': csrfToken,
        origin: base,
        authorization: 'Bearer TEST_ONLY_NOT_A_CREDENTIAL',
      },
      body: JSON.stringify({ ...request, args: { private: 'NEVER_ACTIVITY_ARG' } }),
    });
    expect(response.status).toBe(202);
    await (await bridge.jobs()).idle();
    const activities = await fetch(base + '/api/activities?limit=100').then(value => value.text());
    expect(activities).toContain('service.job');
    expect(activities).not.toMatch(/NEVER_ACTIVITY_ARG|TEST_ONLY_NOT_A_CREDENTIAL|authorization/);
    expect((await fetch(base + '/api/figma-settings')).status).toBe(200);
    const bad = await fetch(base + '/api/figma-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-sfp-csrf': csrfToken },
      body: JSON.stringify({
        revision: 1,
        endpoint: 'https://evil.invalid/mcp',
        oauthTokenEnv: null,
      }),
    });
    expect(bad.status).toBe(400);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
