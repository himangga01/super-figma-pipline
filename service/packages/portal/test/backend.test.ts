import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OperationRecordSchema, OperationTombstoneSchema } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PortalBridge, type ControlPort } from '../src/bridge.js';
import { defaultWorkflow, validateWorkflow, type ActivityDraft } from '../src/contract.js';
import { createPortalServer } from '../src/server.js';
import { ACTIVITY_CAPACITY, PortalStore } from '../src/store.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
  vi.restoreAllMocks();
});
const workspaceId = '00000000-0000-4000-8000-000000000001';
async function store() {
  const path = await mkdtemp(join(tmpdir(), 'sfp-web-test-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return PortalStore.open(path);
}
function input() {
  return { ...defaultWorkflow(), workspaceId };
}
function control(overrides: Partial<ControlPort> = {}): ControlPort {
  return {
    health: async () => true,
    workspaces: async () => [{ workspaceId, realPath: 'C:/fixture', availability: 'available' }],
    invoke: async () => {
      throw Object.assign(new Error('fixture-unavailable'), { code: 'CONTROL_NOT_READY' });
    },
    decide: async () => {},
    ...overrides,
  };
}
const planId = 'sfp_portal1_11111111111111111111111111111111';
const serviceResult = (state: string) => ({
  runId: planId,
  planId,
  state,
  version: 1,
  files: [],
  candidateHash: null,
  appliedHash: null,
  issues: [],
  validation: null,
});
const operationRecord = (overrides: Record<string, unknown> = {}) => ({
  actorId: `actor1_${'A'.repeat(43)}`,
  originAuthSessionId: `auth1_${'A'.repeat(43)}`,
  origin: { kind: 'entry', entryPath: 'control', authSessionId: `auth1_${'A'.repeat(43)}` },
  operationId: 'unresolved-apply',
  issuedAt: 1,
  operationKind: 'tool',
  operationName: 'portal_apply',
  argsHash: `sha256:${'1'.repeat(64)}`,
  captureIntentHash: `sha256:${'2'.repeat(64)}`,
  operationFingerprintHash: `sha256:${'3'.repeat(64)}`,
  resultHash: `sha256:${'4'.repeat(64)}`,
  resultBytes: 100,
  workspaceId,
  fileExecutionKey: null,
  fileExecutionKeyHash: null,
  targetBindingHash: null,
  pluginGeneration: null,
  policyId: 'portal',
  effectSummary: [],
  approvalId: null,
  preExecutionConsentManifestHash: null,
  finalEgressManifestHash: null,
  operationEvidenceReceiptHash: null,
  sequence: 3,
  previousStatus: 'dispatched',
  status: 'succeeded',
  createdAt: '2026-10-11T08:00:00.000Z',
  settledAt: '2026-10-11T08:01:00.000Z',
  errorCode: null,
  ...overrides,
});
async function waitRun(bridge: PortalBridge, id: string) {
  for (let i = 0; i < 50; i++) {
    const run = bridge.getRun(id);
    if (
      run.status === 'awaiting-approval' ||
      (!['queued', 'active'].includes(run.status) &&
        !run.actions.some(a => a.reason.startsWith('Another operation')))
    )
      return run;
    await new Promise(r => setTimeout(r, 10));
  }
  return bridge.getRun(id);
}
describe('no-Core original plan inspection', () => {
  async function unknownPlan(proof: () => Promise<unknown>) {
    const s = await store(),
      w = await s.createWorkflow(input());
    const calls: string[] = [];
    const bridge = new PortalBridge(
      s,
      control({
        inspectOriginalOperation: proof,
        invoke: async call => {
          calls.push(call.name);
          call.emit({ status: 'accepted-locally', operationId: 'unknown-plan' });
          throw Object.assign(new Error('response lost'), { code: 'CONTROL_AUTH_BUSY' });
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    return { s, w, bridge, run, calls };
  }
  const rejectedPlan = (extra: Record<string, unknown> = {}) =>
    operationRecord({
      operationId: 'unknown-plan',
      operationName: 'portal_plan',
      status: 'pre-egress-rejected',
      previousStatus: 'pending-approval',
      resultHash: null,
      resultBytes: null,
      errorCode: 'APPROVAL_EXPIRED',
      ...extra,
    });
  const retainedRejectedPlan = (extra: Record<string, unknown> = {}) => {
    const issuedAt = Date.now();
    const full = rejectedPlan({
      issuedAt,
      createdAt: new Date(issuedAt).toISOString(),
      settledAt: new Date(issuedAt).toISOString(),
    });
    const omitted = new Set([
      'resultBytes',
      'pluginGeneration',
      'policyId',
      'effectSummary',
      'approvalId',
      'preExecutionConsentManifestHash',
      'sequence',
      'previousStatus',
      'createdAt',
    ]);
    return {
      ...Object.fromEntries(Object.entries(full).filter(([key]) => !omitted.has(key))),
      expiresAt: issuedAt + 2_592_000_000,
      ...extra,
    };
  };
  it('accepts canonical retained pre-egress tombstone proof without replay or record defaults', async () => {
    const proof = retainedRejectedPlan();
    expect(OperationRecordSchema.safeParse(proof).success).toBe(false);
    expect(OperationTombstoneSchema.safeParse(proof).success).toBe(true);
    const { s, bridge, run, calls } = await unknownPlan(async () => proof);
    const before = s.getRun(run.id);
    await bridge.action(run.id, { action: 'refresh' });
    expect((await waitRun(bridge, run.id)).status).toBe('failed');
    const after = s.getRun(run.id);
    expect(after.serviceRunId).toBeNull();
    expect(after.operationId).toBe('unknown-plan');
    expect(after.error?.code).toBe('PORTAL_PLAN_PRE_DISPATCH_REJECTED');
    expect(after.unresolvedOperation).toBeUndefined();
    expect(after.events.slice(0, before.events.length)).toEqual(before.events);
    expect(after.events.at(-1)?.type).toBe('original-operation-pre-dispatch-rejected');
    expect(calls).toEqual(['portal_plan']);
    expect((await PortalStore.open(s.directory)).getRun(run.id)).toEqual(after);
  });
  it('keeps canonical retained pre-egress tombstone proof foreign, generic, sparse or expired fenced', async () => {
    const issuedAt = Date.now() - 2_592_000_001;
    const proofs = [
      retainedRejectedPlan({ operationId: 'foreign' }),
      retainedRejectedPlan({ workspaceId: '00000000-0000-4000-8000-000000000002' }),
      retainedRejectedPlan({ operationName: 'portal_status' }),
      ...['failed', 'rejected', 'outcome-unknown', 'succeeded'].map(status =>
        retainedRejectedPlan({ status }),
      ),
      retainedRejectedPlan({ settledAt: undefined }),
      retainedRejectedPlan({ resultHash: `sha256:${'4'.repeat(64)}` }),
      retainedRejectedPlan({ operationEvidenceReceiptHash: `sha256:${'5'.repeat(64)}` }),
      retainedRejectedPlan({ issuedAt, expiresAt: issuedAt + 2_592_000_000 }),
      {
        operationId: 'unknown-plan',
        workspaceId,
        operationKind: 'tool',
        operationName: 'portal_plan',
        status: 'pre-egress-rejected',
        settledAt: new Date().toISOString(),
      },
    ];
    for (const proof of proofs) {
      const { s, w, bridge, run, calls } = await unknownPlan(async () => proof);
      const before = s.getRun(run.id);
      await bridge.action(run.id, { action: 'refresh' });
      expect((await waitRun(bridge, run.id)).status).toBe('unknown');
      expect(s.getRun(run.id).unresolvedOperation).toEqual(before.unresolvedOperation);
      expect(s.getRun(run.id).events).toEqual(before.events);
      await expect(bridge.start(w.id, 1)).rejects.toMatchObject({ code: 'RUN_OUTCOME_UNKNOWN' });
      expect(calls).toEqual(['portal_plan']);
    }
  });
  it('refreshes a no-Core pre-dispatch rejection without replay and permits only a fresh run', async () => {
    const fixture = await unknownPlan(async () => rejectedPlan());
    const { s, w, bridge, run, calls } = fixture;
    const before = s.getRun(run.id);
    expect(before.status).toBe('unknown');
    expect(bridge.getRun(run.id).actions.find(a => a.action === 'refresh')?.enabled).toBe(true);
    await expect(bridge.start(w.id, 1)).rejects.toMatchObject({ code: 'RUN_OUTCOME_UNKNOWN' });
    await bridge.action(run.id, { action: 'refresh' });
    const result = await waitRun(bridge, run.id);
    expect(result.status).toBe('failed');
    expect(result.serviceRunId).toBeNull();
    expect(result.operationId).toBe('unknown-plan');
    expect(result.error?.code).toBe('PORTAL_PLAN_PRE_DISPATCH_REJECTED');
    expect(s.getRun(run.id).unresolvedOperation).toBeUndefined();
    expect(s.getRun(run.id).events.slice(0, before.events.length)).toEqual(before.events);
    expect(s.getRun(run.id).events.at(-1)?.data).toMatchObject({ previousRunStatus: 'unknown' });
    expect(calls).toEqual(['portal_plan']);
    const fresh = await bridge.start(w.id, 1);
    expect(fresh.id).not.toBe(run.id);
    await waitRun(bridge, fresh.id);
    expect(calls).toEqual(['portal_plan', 'portal_plan']);
  });
  it('keeps no-Core generic, foreign, missing and incomplete evidence fenced', async () => {
    for (const proof of [
      null,
      {},
      rejectedPlan({ operationId: 'foreign' }),
      rejectedPlan({ workspaceId: '00000000-0000-4000-8000-000000000002' }),
      rejectedPlan({ operationName: 'portal_status' }),
      ...['rejected', 'failed', 'succeeded', 'outcome-unknown', 'dispatched'].map(status =>
        rejectedPlan({
          status,
          settledAt: status === 'dispatched' ? null : '2026-10-11T08:01:00.000Z',
        }),
      ),
      rejectedPlan({ settledAt: null }),
    ]) {
      const { w, bridge, run, calls } = await unknownPlan(async () => proof);
      await bridge.action(run.id, { action: 'refresh' });
      expect((await waitRun(bridge, run.id)).status).toBe('unknown');
      await expect(bridge.start(w.id, 1)).rejects.toMatchObject({ code: 'RUN_OUTCOME_UNKNOWN' });
      expect(calls).toEqual(['portal_plan']);
    }
  });
  it('keeps no-Core inspection exclusive and rejects late proof after cancellation or close', async () => {
    for (const stop of ['cancel', 'close'] as const) {
      const gate = deferred<unknown>();
      const { w, bridge, run } = await unknownPlan(() => gate.promise);
      await bridge.action(run.id, { action: 'refresh' });
      await expect(bridge.action(run.id, { action: 'refresh' })).rejects.toMatchObject({
        code: 'ACTION_UNAVAILABLE',
      });
      await expect(bridge.start(w.id, 1)).rejects.toMatchObject({ code: 'RUN_OUTCOME_UNKNOWN' });
      if (stop === 'cancel') await bridge.action(run.id, { action: 'cancel' });
      else await bridge.close();
      gate.resolve(rejectedPlan());
      expect((await waitRun(bridge, run.id)).status).toBe('unknown');
      await expect(bridge.start(w.id, 1)).rejects.toMatchObject({ code: 'RUN_OUTCOME_UNKNOWN' });
    }
  });
  it('retains the no-Core unknown fence and history when atomic disposition persistence fails', async () => {
    const gate = deferred<unknown>();
    const { s, w, bridge, run } = await unknownPlan(() => gate.promise);
    const before = s.getRun(run.id);
    await bridge.action(run.id, { action: 'refresh' });
    const current = join(s.directory, 'portal.json'),
      backup = join(s.directory, 'before-inspection.json');
    await rename(current, backup);
    await mkdir(current);
    gate.resolve(rejectedPlan());
    await waitRun(bridge, run.id);
    expect(s.getRun(run.id)).toEqual(before);
    expect(
      JSON.parse(await readFile(backup, 'utf8')).runs.find((r: { id: string }) => r.id === run.id)
        .status,
    ).toBe('unknown');
    await expect(bridge.start(w.id, 1)).rejects.toMatchObject({ code: 'RUN_OUTCOME_UNKNOWN' });
    await rm(current, { recursive: true });
    await rename(backup, current);
    await bridge.action(run.id, { action: 'refresh' });
    expect((await waitRun(bridge, run.id)).status).toBe('failed');
    expect(s.getRun(run.id).events.at(-1)?.type).toBe('original-operation-pre-dispatch-rejected');
    const reopened = await PortalStore.open(s.directory);
    expect(reopened.getRun(run.id)).toEqual(s.getRun(run.id));
  });
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('waits for the portal-owned Chrome cleanup before invoking the HTTP close callback', async () => {
  const s = await store(),
    gate = deferred<void>();
  const release = vi.fn<() => Promise<void>>(() => gate.promise);
  const bridge = new PortalBridge(s, control({ close: release }));
  const server = createPortalServer({ store: s, bridge, webRoot: s.directory });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  let completed = false;
  const closing = new Promise<Error | undefined>(done =>
    server.close(error => {
      completed = true;
      done(error);
    }),
  );
  try {
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    gate.resolve(undefined);
    expect(await closing).toBeUndefined();
    expect(completed).toBe(true);
    await bridge.close();
    expect(release).toHaveBeenCalledOnce();
  } finally {
    gate.resolve(undefined);
    await closing;
  }
});

it('reports an owned Chrome cleanup failure instead of a clean HTTP server shutdown', async () => {
  const s = await store();
  const failure = Object.assign(Error('owned transport cleanup failed'), {
    code: 'CHROME_CONNECTION_CLOSED',
  });
  const release = vi.fn<() => Promise<void>>(async () => {
    throw failure;
  });
  const server = createPortalServer({
    store: s,
    bridge: new PortalBridge(s, control({ close: release })),
    webRoot: s.directory,
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const observed = await new Promise<Error | undefined>(done => server.close(done));
  expect(observed).toBe(failure);
  expect(release).toHaveBeenCalledOnce();
});
async function waitIdle(bridge: PortalBridge, id: string) {
  await expect
    .poll(() =>
      bridge.getRun(id).actions.some(action => action.reason.startsWith('Another operation')),
    )
    .toBe(false);
}

describe('workflow persistence and executable topology', () => {
  it('migrates version-one data without losing workflows and keeps activity changes cursor-visible', async () => {
    const s = await store();
    const workflow = await s.createWorkflow(input());
    const path = join(s.directory, 'portal.json');
    const original = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(
      path,
      JSON.stringify({ version: 1, workflows: original.workflows, runs: original.runs }),
    );
    const migrated = await PortalStore.open(s.directory);
    expect(migrated.getWorkflow(workflow.id)).toEqual(workflow);
    expect(migrated.listActivities().activities).toEqual([]);
    const draft: ActivityDraft = {
      type: 'workflow.validate',
      source: 'server',
      status: 'started',
      actor: 'local-owner',
      sessionId: migrated.activitySessionId,
      requestId: randomUUID(),
      workflowId: workflow.id,
      metadata: {},
    };
    const started = await migrated.recordActivity(draft);
    const settled = await migrated.settleActivity(started.id, 'succeeded', {
      metadata: { issueCount: 0 },
    });
    expect(settled.id).toBe(started.id);
    expect(settled.sequence).toBeGreaterThan(started.sequence);
    expect(migrated.listActivities({ after: started.sequence }).activities).toEqual([settled]);
    const restored = await PortalStore.open(s.directory);
    expect(
      restored.listActivities({
        type: 'workflow.validate',
        workflowId: workflow.id,
        source: 'server',
        status: 'succeeded',
        from: '2020-01-01T00:00:00Z',
        to: '2100-01-01T00:00:00Z',
      }).activities,
    ).toEqual([settled]);
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(2);
  });
  it('retains every activity at capacity, rejects new records, and permits pending record settlement', async () => {
    const s = await store();
    await s.createWorkflow(input());
    const path = join(s.directory, 'portal.json');
    const data = JSON.parse(await readFile(path, 'utf8'));
    const at = new Date().toISOString();
    const records = Array.from({ length: ACTIVITY_CAPACITY }, (_, index) => ({
      id: randomUUID(),
      sequence: index + 1,
      at,
      updatedAt: at,
      type: index === 0 ? 'run.start' : 'guide.open',
      source: index === 0 ? 'server' : 'client',
      status: index === 0 ? 'started' : 'intent',
      actor: 'local-owner',
      sessionId: s.activitySessionId,
      requestId: randomUUID(),
      metadata: {},
    }));
    await writeFile(
      path,
      JSON.stringify({ ...data, activities: records, nextActivitySequence: ACTIVITY_CAPACITY + 1 }),
    );
    const full = await PortalStore.open(s.directory);
    await expect(
      full.recordActivity({
        type: 'guide.open',
        source: 'client',
        status: 'intent',
        actor: 'local-owner',
        sessionId: full.activitySessionId,
        requestId: randomUUID(),
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: 'ACTIVITY_CAPACITY' });
    await full.settleActivity(records[0]!.id, 'succeeded');
    const all = [];
    let after = 0;
    for (;;) {
      const page = full.listActivities({ after, limit: 100 });
      all.push(...page.activities);
      after = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(new Set(all.map(row => row.id))).toEqual(new Set(records.map(row => row.id)));
    expect(full.listActivities().retention).toMatchObject({
      full: true,
      count: ACTIVITY_CAPACITY,
      remaining: 0,
    });
    expect(full.activityHealth()).toMatchObject({
      available: false,
      complete: false,
      errorCode: 'ACTIVITY_CAPACITY',
      unrecordedCount: 1,
    });
    expect((await PortalStore.open(s.directory)).activityHealth().unrecordedCount).toBe(1);
  });
  it('recovers pending server audit outcomes as unknown without replay', async () => {
    const s = await store();
    const recorded = await s.recordActivity({
      type: 'run.action',
      source: 'server',
      status: 'started',
      actor: 'local-owner',
      sessionId: s.activitySessionId,
      requestId: randomUUID(),
      metadata: { actionName: 'apply' },
    });
    const restored = await PortalStore.open(s.directory);
    await restored.recoverInterrupted();
    expect(restored.listActivities({ after: recorded.sequence }).activities[0]).toMatchObject({
      id: recorded.id,
      status: 'unknown',
      metadata: { errorCode: 'PORTAL_SERVER_RESTARTED' },
    });
  });
  it('coalesces repeated unverified rejection metadata without retaining request contents', async () => {
    const s = await store();
    const draft: ActivityDraft = {
      type: 'request.rejected',
      source: 'server',
      status: 'failed',
      actor: 'unverified-request',
      sessionId: s.activitySessionId,
      requestId: randomUUID(),
      metadata: { route: 'unknown', method: 'POST', errorCode: 'ORIGIN_REJECTED' },
    };
    const first = await s.recordActivity(draft);
    await s.recordActivity({ ...draft, requestId: randomUUID() });
    expect(s.listActivities({ after: first.sequence }).activities).toEqual([
      expect.objectContaining({
        id: first.id,
        metadata: expect.objectContaining({ rejectionCount: 2 }),
      }),
    ]);
    expect(s.listActivities().retention.count).toBe(1);
  });
  it('preserves edits across reopen and rejects stale revisions', async () => {
    const s = await store();
    const created = await s.createWorkflow(input());
    const updated = await s.updateWorkflow(created.id, 1, { ...input(), name: 'Edited flow' });
    expect(updated.revision).toBe(2);
    await expect(s.updateWorkflow(created.id, 1, input())).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    expect((await PortalStore.open(s.directory)).getWorkflow(created.id).name).toBe('Edited flow');
  });
  it('rejects cycles, duplicate node IDs, missing required stages, and unsupported edges', () => {
    const value = input();
    expect(validateWorkflow(value).valid).toBe(true);
    value.graph.edges.push({ id: 'cycle', source: 'output', target: 'source' });
    expect(validateWorkflow(value).issues.some(i => i.message.includes('cycle'))).toBe(true);
    value.graph.nodes.push(value.graph.nodes[0]!);
    expect(validateWorkflow(value).valid).toBe(false);
    const missing = input();
    missing.graph.nodes.pop();
    expect(validateWorkflow(missing).valid).toBe(false);
  });
  it('rejects unsafe target paths and forged official endpoints before saving', async () => {
    const s = await store();
    await expect(
      s.createWorkflow({ ...input(), plan: { ...input().plan, targetPath: '../escape' } }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      s.createWorkflow({
        ...input(),
        plan: {
          ...input().plan,
          design: {
            ...input().plan.design,
            source: 'official-mcp',
            officialEndpoint: 'https://evil.test/mcp',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('public service bridge', () => {
  it('records changed service state observed on refresh and coalesces unchanged connection polls', async () => {
    const s = await store(),
      workflow = await s.createWorkflow(input());
    let state = 'waiting-agent';
    const bridge = new PortalBridge(
      s,
      control({
        status: async () => ({ browserConnection: 'connected' }),
        invoke: async call =>
          call.name === 'portal_plan'
            ? { planId, design: { complete: true, liveVerified: true } }
            : {
                ...serviceResult(state),
                files:
                  state === 'candidate-ready'
                    ? [{ path: 'private-file.ts', content: 'SFP_PRIVATE_CODE' }]
                    : [],
              },
      }),
    );
    await bridge.bootstrap();
    await bridge.bootstrap();
    expect(s.listActivities({ type: 'service.connection' }).activities).toHaveLength(1);
    const run = await bridge.start(workflow.id, 1);
    await waitIdle(bridge, run.id);
    state = 'candidate-ready';
    await bridge.action(run.id, { action: 'refresh' });
    await waitIdle(bridge, run.id);
    const records = s.listActivities({ type: 'service.run-state', runId: run.id }).activities;
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'service',
          status: 'observed',
          metadata: expect.objectContaining({
            fromState: 'waiting-agent',
            toState: 'candidate-ready',
            fileCount: 1,
          }),
        }),
      ]),
    );
    expect(JSON.stringify(records)).not.toMatch(/SFP_PRIVATE_CODE|private-file/u);
    await bridge.action(run.id, { action: 'refresh' });
    await waitIdle(bridge, run.id);
    expect(s.listActivities({ type: 'service.run-state', runId: run.id }).activities).toHaveLength(
      records.length,
    );
  });
  it.each([
    'not-requested',
    'awaiting-browser',
    'initializing',
    'connected',
    'unavailable',
  ] as const)(
    'reports %s Chrome readiness separately from healthy service without exposing status authority',
    async browserConnection => {
      const s = await store();
      const bridge = new PortalBridge(
        s,
        control({
          status: async () => ({
            browserConnection,
            leaderGeneration: 'private-generation',
            authorization: 'private-token',
          }),
          registerWorkspace: async folder => ({ workspaceId, realPath: folder }),
        }),
      );
      const bootstrap = await bridge.bootstrap();
      expect(bootstrap.service).toMatchObject({
        available: true,
        readiness: {
          statusAvailable: true,
          browserConnection,
          workspaceRegistrationAvailable: true,
        },
      });
      expect(bootstrap.service.readiness.browserMessage).toMatch(/[가-힣]/u);
      expect(JSON.stringify(bootstrap)).not.toMatch(/private-generation|private-token/u);
    },
  );
  it('does not infer Chrome readiness from health when the public status read fails', async () => {
    const s = await store();
    const bridge = new PortalBridge(
      s,
      control({
        status: async () => {
          throw Error('private credential detail');
        },
      }),
    );
    const bootstrap = await bridge.bootstrap();
    expect(bootstrap.service).toMatchObject({
      available: true,
      readiness: { statusAvailable: false, browserConnection: 'unknown' },
    });
    expect(JSON.stringify(bootstrap)).not.toContain('private credential detail');
  });
  it('keeps disconnected bootstrap and unsupported workspace registration explicit', async () => {
    const s = await store();
    const status = vi.fn<NonNullable<ControlPort['status']>>(async () => ({
      browserConnection: 'connected',
    }));
    const bridge = new PortalBridge(s, control({ health: async () => false, status }));
    const bootstrap = await bridge.bootstrap();
    expect(bootstrap.service).toMatchObject({
      available: false,
      readiness: {
        statusAvailable: false,
        browserConnection: 'unknown',
        workspaceRegistrationAvailable: false,
      },
    });
    expect(status).not.toHaveBeenCalled();
    await expect(
      bridge.registerWorkspace({
        folder: process.platform === 'win32' ? 'C:/fixture' : '/fixture',
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_REGISTRATION_UNAVAILABLE' });
  });
  it('does not present a changed registered folder as a successful available registration', async () => {
    const s = await store();
    const bridge = new PortalBridge(
      s,
      control({
        registerWorkspace: async folder => ({
          workspaceId,
          realPath: folder,
          availability: 'identity-mismatch',
        }),
      }),
    );
    await expect(
      bridge.registerWorkspace({
        folder: process.platform === 'win32' ? 'C:/fixture' : '/fixture',
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ROOT_UNAVAILABLE' });
  });
  it.each(['approve', 'reject'] as const)(
    'keeps an unknown mutation fenced after a late %s decision',
    async action => {
      const s = await store(),
        w = await s.createWorkflow(input());
      const apply = deferred<unknown>(),
        decision = deferred<void>(),
        deciding = deferred<void>();
      const calls: string[] = [];
      const bridge = new PortalBridge(
        s,
        control({
          invoke: async call => {
            calls.push(call.name);
            if (call.name === 'portal_plan') return { planId };
            if (call.name === 'portal_start') return serviceResult('ready-to-apply');
            if (call.name === 'portal_apply') {
              call.emit({ status: 'accepted-locally', operationId: 'original-apply' });
              call.emit({
                status: 'approval-required',
                prompt: {
                  approvalId: 'original-approval',
                  operationId: 'original-apply',
                  expiresAt: Date.now() + 60000,
                },
              });
              return apply.promise;
            }
            return serviceResult('outcome-unknown');
          },
          decide: async () => {
            deciding.resolve();
            await decision.promise;
          },
        }),
      );
      const run = await bridge.start(w.id, 1);
      await waitIdle(bridge, run.id);
      await bridge.action(run.id, { action: 'apply' });
      await expect.poll(() => bridge.getRun(run.id).status).toBe('awaiting-approval');
      const pendingDecision = bridge.action(run.id, {
        action,
        args: { approvalId: 'original-approval' },
      });
      try {
        await deciding.promise;
        apply.reject(Object.assign(Error('monitoring uncertain'), { code: 'CONTROL_AUTH_BUSY' }));
        await waitIdle(bridge, run.id);
        expect(bridge.getRun(run.id).status).toBe('unknown');
        decision.resolve();
        await pendingDecision;
        expect(bridge.getRun(run.id).status).toBe('unknown');
        expect(s.getRun(run.id).unresolvedOperation).toEqual({
          id: 'original-apply',
          name: 'portal_apply',
        });
        expect(bridge.getRun(run.id).operationId).toBe('original-apply');
        // The durable unresolved-operation fence also wins over a stale public status value.
        await s.updateRun(run.id, value => {
          value.status = 'active';
        });
        await expect(
          bridge.action(run.id, { action: 'resume', args: { reconcile: 'continue' } }),
        ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
        expect(calls).not.toContain('portal_resume');
      } finally {
        decision.resolve();
        apply.resolve(serviceResult('outcome-unknown'));
        await pendingDecision;
        await waitIdle(bridge, run.id);
      }
    },
  );
  it.each(['approve', 'reject'] as const)(
    'preserves completed state after a late %s decision',
    async action => {
      const s = await store(),
        w = await s.createWorkflow(input());
      const apply = deferred<unknown>(),
        decision = deferred<void>(),
        deciding = deferred<void>();
      const bridge = new PortalBridge(
        s,
        control({
          invoke: async call => {
            if (call.name === 'portal_plan') return { planId };
            if (call.name === 'portal_start') return serviceResult('ready-to-apply');
            call.emit({ status: 'accepted-locally', operationId: 'completed-apply' });
            call.emit({
              status: 'approval-required',
              prompt: {
                approvalId: 'original-approval',
                operationId: 'completed-apply',
                expiresAt: Date.now() + 60000,
              },
            });
            return apply.promise;
          },
          decide: async () => {
            deciding.resolve();
            await decision.promise;
          },
        }),
      );
      const run = await bridge.start(w.id, 1);
      await waitIdle(bridge, run.id);
      await bridge.action(run.id, { action: 'apply' });
      await expect.poll(() => bridge.getRun(run.id).status).toBe('awaiting-approval');
      const pendingDecision = bridge.action(run.id, {
        action,
        args: { approvalId: 'original-approval' },
      });
      try {
        await deciding.promise;
        apply.resolve(serviceResult('completed'));
        await waitIdle(bridge, run.id);
        decision.resolve();
        await pendingDecision;
        expect(bridge.getRun(run.id)).toMatchObject({
          status: 'completed',
          result: { state: 'completed' },
        });
      } finally {
        decision.resolve();
        apply.resolve(serviceResult('completed'));
        await pendingDecision;
        await waitIdle(bridge, run.id);
      }
    },
  );
  it('reserves the four-operation capacity before concurrent workspace lookups', async () => {
    const s = await store(),
      lookup = deferred<Awaited<ReturnType<ControlPort['workspaces']>>>(),
      plan = deferred<unknown>();
    let calls = 0;
    const bridge = new PortalBridge(
      s,
      control({
        workspaces: () => lookup.promise,
        invoke: async call => {
          if (call.name === 'portal_plan') {
            calls++;
            return plan.promise;
          }
          return serviceResult('waiting-agent');
        },
      }),
    );
    const workflows = await Promise.all(Array.from({ length: 5 }, () => s.createWorkflow(input())));
    const pending = workflows.map(w => bridge.start(w.id, 1));
    const settled = Promise.allSettled(pending);
    lookup.resolve([{ workspaceId, realPath: 'C:/fixture', availability: 'available' }]);
    const outcomes = await settled;
    try {
      const accepted = outcomes.filter(outcome => outcome.status === 'fulfilled');
      await expect.poll(() => calls).toBe(accepted.length);
      expect(accepted).toHaveLength(4);
      expect(
        outcomes
          .filter(outcome => outcome.status === 'rejected')
          .map(outcome => outcome.reason.code),
      ).toEqual(['RUN_LIMIT']);
    } finally {
      plan.resolve({ planId });
      for (const outcome of outcomes.filter(value => value.status === 'fulfilled'))
        await waitIdle(bridge, outcome.value.id);
    }
  });
  it('does not let a late decision overwrite a newer operation awaiting its own approval', async () => {
    const s = await store(),
      w = await s.createWorkflow(input());
    const first = deferred<unknown>(),
      second = deferred<unknown>(),
      decision = deferred<void>(),
      deciding = deferred<void>();
    let applies = 0;
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          if (call.name === 'portal_plan') return { planId };
          if (call.name === 'portal_start') return serviceResult('ready-to-apply');
          const operationId = ++applies === 1 ? 'first-operation' : 'second-operation';
          call.emit({ status: 'accepted-locally', operationId });
          call.emit({
            status: 'approval-required',
            prompt: {
              approvalId: operationId + '-approval',
              operationId,
              expiresAt: Date.now() + 60000,
            },
          });
          return applies === 1 ? first.promise : second.promise;
        },
        decide: async () => {
          deciding.resolve();
          await decision.promise;
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitIdle(bridge, run.id);
    await bridge.action(run.id, { action: 'apply' });
    await expect.poll(() => bridge.getRun(run.id).status).toBe('awaiting-approval');
    const pendingDecision = bridge.action(run.id, {
      action: 'approve',
      args: { approvalId: 'first-operation-approval' },
    });
    try {
      await deciding.promise;
      first.resolve(serviceResult('ready-to-apply'));
      await waitIdle(bridge, run.id);
      await bridge.action(run.id, { action: 'apply' });
      await expect.poll(() => bridge.getRun(run.id).status).toBe('awaiting-approval');
      decision.resolve();
      await pendingDecision;
      expect(bridge.getRun(run.id)).toMatchObject({
        status: 'awaiting-approval',
        operationId: 'second-operation',
        approvals: [{ approvalId: 'second-operation-approval', operationId: 'second-operation' }],
      });
    } finally {
      decision.resolve();
      first.resolve(serviceResult('completed'));
      second.resolve(serviceResult('completed'));
      await pendingDecision;
      await waitIdle(bridge, run.id);
    }
  });
  it.each(['workspace', 'persistence', 'launch'] as const)(
    'releases reserved capacity after a %s failure',
    async phase => {
      const s = await store(),
        plan = deferred<unknown>();
      let holding = false,
        plans = 0;
      const port = control({
        invoke: async call => {
          if (call.name === 'portal_plan') {
            if (holding) {
              plans++;
              return plan.promise;
            }
            return { planId };
          }
          return serviceResult('ready-to-apply');
        },
      });
      const bridge = new PortalBridge(s, port);
      const w = await s.createWorkflow(input());
      let fail: () => Promise<unknown> = () => bridge.start(w.id, 1);
      if (phase === 'workspace')
        vi.spyOn(port, 'workspaces').mockRejectedValueOnce(Error('injected setup failure'));
      else if (phase === 'persistence')
        vi.spyOn(s, 'createRun').mockRejectedValueOnce(Error('injected setup failure'));
      else {
        const run = await bridge.start(w.id, 1);
        await waitIdle(bridge, run.id);
        vi.spyOn(s, 'updateRun').mockRejectedValueOnce(Error('injected setup failure'));
        fail = () => bridge.action(run.id, { action: 'apply' });
      }
      await expect(fail()).rejects.toThrow('injected setup failure');
      holding = true;
      const workflows = await Promise.all(
        Array.from({ length: 5 }, () => s.createWorkflow(input())),
      );
      const runs = await Promise.all(
        workflows.slice(0, 4).map(workflow => bridge.start(workflow.id, 1)),
      );
      try {
        await expect.poll(() => plans).toBe(4);
        await expect(bridge.start(workflows[4]!.id, 1)).rejects.toMatchObject({
          code: 'RUN_LIMIT',
        });
      } finally {
        plan.resolve({ planId });
        for (const run of runs) await waitIdle(bridge, run.id);
      }
    },
  );
  it('enforces the four-operation capacity for actions on separate ready runs', async () => {
    const s = await store(),
      action = deferred<unknown>();
    let calls = 0;
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          if (call.name === 'portal_plan') return { planId };
          if (call.name === 'portal_start') return serviceResult('ready-to-apply');
          calls++;
          return action.promise;
        },
      }),
    );
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const w = await s.createWorkflow(input());
      const run = await bridge.start(w.id, 1);
      await waitIdle(bridge, run.id);
      runs.push(run);
    }
    const outcomes = await Promise.allSettled(
      runs.map(run => bridge.action(run.id, { action: 'apply' })),
    );
    try {
      const accepted = outcomes.filter(outcome => outcome.status === 'fulfilled');
      await expect.poll(() => calls).toBe(accepted.length);
      expect(accepted).toHaveLength(4);
      expect(
        outcomes
          .filter(outcome => outcome.status === 'rejected')
          .map(outcome => outcome.reason.code),
      ).toEqual(['RUN_LIMIT']);
    } finally {
      action.resolve(serviceResult('completed'));
      for (const run of runs) await waitIdle(bridge, run.id);
    }
  });
  it('shows a failed Figma capture instead of completed source for the live needs-input case', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const issues = [
      'FIGMA_TAB_NOT_FOUND',
      'DESIGN_CAPTURE_REQUIRED',
      'LIVE_DESIGN_VERIFICATION_REQUIRED',
      'WORKFLOW_ANALYSIS:DESIGN_MISSING:',
    ];
    const design = {
      complete: false,
      liveVerified: false,
      captureFailure: {
        code: 'FIGMA_TAB_NOT_FOUND',
        stage: 'connection',
        type: 'error',
        elapsedMs: 0,
      },
    };
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call =>
          call.name === 'portal_plan'
            ? { planId, design, issues }
            : { ...serviceResult('needs-input'), issues },
      }),
    );
    const run = await bridge.start(w.id, 1);
    const result = await waitRun(bridge, run.id);
    expect(result.status).toBe('awaiting-input');
    expect(result.nodes.find(n => n.type === 'source')).toMatchObject({
      status: 'failed',
      message: 'FIGMA_TAB_NOT_FOUND',
    });
    expect(result.nodes.find(n => n.type === 'requirements')?.status).toBe('waiting');
    expect(result.nodes.find(n => n.type === 'generation')?.status).toBe('pending');
  });
  it.each([
    [
      'complete live capture with unresolved business workflow',
      'require-live',
      true,
      true,
      'completed',
    ],
    ['complete but unverified live capture', 'require-live', true, false, 'waiting'],
    ['explicitly allowed complete pinned capture', 'allow-pinned', true, false, 'completed'],
    ['incomplete live-verified data', 'require-live', false, true, 'waiting'],
  ] as const)(
    'derives source state from %s',
    async (_label, freshness, complete, liveVerified, expected) => {
      const s = await store();
      const draft = input();
      draft.plan.design.freshness = freshness;
      const w = await s.createWorkflow(draft);
      const plan = {
        planId,
        design: { complete, liveVerified },
        issues: ['WORKFLOW_REQUIREMENTS_UNRESOLVED'],
        workflowCoverage: { complete: false },
      };
      const bridge = new PortalBridge(
        s,
        control({
          invoke: async call => (call.name === 'portal_plan' ? plan : serviceResult('needs-input')),
        }),
      );
      const run = await bridge.start(w.id, 1);
      const result = await waitRun(bridge, run.id);
      expect(result.nodes.find(n => n.type === 'source')?.status).toBe(expected);
      expect(result.nodes.find(n => n.type === 'requirements')?.status).toBe('waiting');
    },
  );
  it('reads retained portal_next blueprint design evidence without treating missing metadata as a capture', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          if (call.name === 'portal_plan')
            return { planId, design: { complete: true, liveVerified: true } };
          if (call.name === 'portal_next')
            return {
              ...serviceResult('needs-input'),
              blueprint: {
                planId,
                design: { complete: false, liveVerified: false },
                issues: ['WORKFLOW_ANALYSIS:DESIGN_MISSING:'],
              },
            };
          return serviceResult('needs-input');
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    await bridge.action(run.id, { action: 'next' });
    const result = await waitRun(bridge, run.id);
    expect(result.nodes.find(n => n.type === 'source')?.status).toBe('waiting');
    expect(result.nodes.find(n => n.type === 'requirements')?.status).toBe('waiting');
  });
  it('accepts completed status only after the original operation is proven terminal', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const order: string[] = [];
    const bridge = new PortalBridge(
      s,
      control({
        inspectOriginalOperation: async id => {
          order.push(`inspect:${id}`);
          return operationRecord();
        },
        invoke: async call => {
          order.push(call.name);
          if (call.name === 'portal_plan') return { planId };
          if (call.name === 'portal_start') return serviceResult('ready-to-apply');
          if (call.name === 'portal_status') return serviceResult('completed');
          call.emit({ status: 'accepted-locally', operationId: 'unresolved-apply' });
          throw Object.assign(new Error('lost'), { code: 'CONTROL_AUTH_BUSY' });
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    await bridge.action(run.id, { action: 'apply' });
    await waitRun(bridge, run.id);
    order.length = 0;
    await bridge.action(run.id, { action: 'refresh' });
    const result = await waitRun(bridge, run.id);
    expect(order).toEqual(['inspect:unresolved-apply', 'portal_status']);
    expect(result.status).toBe('completed');
    expect(s.getRun(run.id).unresolvedOperation).toBeUndefined();
  });
  it('persists the unresolved mutation across inspection and server restart', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          if (call.name === 'portal_plan') return { planId };
          if (call.name === 'portal_start') return serviceResult('ready-to-apply');
          if (call.name === 'portal_resume') {
            call.emit({ status: 'accepted-locally', operationId: 'resume-inspection' });
            return serviceResult('completed');
          }
          call.emit({ status: 'accepted-locally', operationId: 'unresolved-apply' });
          throw Object.assign(new Error('lost'), { code: 'CONTROL_AUTH_BUSY' });
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    await bridge.action(run.id, { action: 'apply' });
    await waitRun(bridge, run.id);
    await bridge.action(run.id, { action: 'resume', args: { reconcile: 'inspect' } });
    const result = await waitRun(bridge, run.id);
    expect(result.status).toBe('unknown');
    expect(result.operationId).toBe('unresolved-apply');
    await s.updateRun(run.id, r => {
      r.status = 'active';
      r.operationId = 'interrupted-status-read';
    });
    const reopened = await PortalStore.open(s.directory);
    await reopened.recoverInterrupted();
    expect(reopened.getRun(run.id).operationId).toBe('unresolved-apply');
    expect(new PortalBridge(reopened, control()).getRun(run.id)).not.toHaveProperty(
      'unresolvedOperation',
    );
  });
  it('keeps a missing original operation ID fenced across refresh and inspection', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call =>
          call.name === 'portal_plan'
            ? { planId }
            : serviceResult(call.name === 'portal_start' ? 'outcome-unknown' : 'completed'),
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    await bridge.action(run.id, { action: 'refresh' });
    let result = await waitRun(bridge, run.id);
    expect(result.status).toBe('unknown');
    await bridge.action(run.id, { action: 'resume', args: { reconcile: 'inspect' } });
    result = await waitRun(bridge, run.id);
    expect(result.status).toBe('unknown');
    expect(result.operationId).toBeNull();
  });
  it.each(['ready-to-apply', 'completed'])(
    'keeps unknown mutation fenced when successful refresh reports %s without original disposition',
    async state => {
      const s = await store();
      const w = await s.createWorkflow(input());
      const bridge = new PortalBridge(
        s,
        control({
          invoke: async call => {
            if (call.name === 'portal_plan') return { planId };
            if (call.name === 'portal_start') return serviceResult('ready-to-apply');
            if (call.name === 'portal_status') {
              call.emit({ status: 'accepted-locally', operationId: 'status-read' });
              return serviceResult(state);
            }
            call.emit({ status: 'accepted-locally', operationId: 'unresolved-apply' });
            throw Object.assign(new Error('monitoring failed'), { code: 'CONTROL_AUTH_BUSY' });
          },
        }),
      );
      const run = await bridge.start(w.id, 1);
      await waitRun(bridge, run.id);
      await bridge.action(run.id, { action: 'apply' });
      await waitRun(bridge, run.id);
      await bridge.action(run.id, { action: 'refresh' });
      const result = await waitRun(bridge, run.id);
      expect(result.status).toBe('unknown');
      expect(result.operationId).toBe('unresolved-apply');
      for (const action of ['next', 'submit', 'validate', 'apply', 'cancel'])
        expect(result.actions.find(a => a.action === action)?.enabled).toBe(false);
      await expect(bridge.start(w.id, 1)).rejects.toMatchObject({ code: 'RUN_OUTCOME_UNKNOWN' });
      await expect(
        bridge.action(run.id, { action: 'resume', args: { reconcile: 'continue' } }),
      ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    },
  );
  it.each([
    ['missing', null, false],
    ['pending', operationRecord({ status: 'dispatched', settledAt: null }), false],
    ['foreign ID', operationRecord({ operationId: 'foreign-operation' }), false],
    [
      'foreign workspace',
      operationRecord({ workspaceId: '00000000-0000-4000-8000-000000000002' }),
      false,
    ],
    ['wrong operation', operationRecord({ operationName: 'portal_status' }), false],
    ['malformed', { operationId: 'unresolved-apply', status: 'succeeded' }, false],
    ['unknown', operationRecord({ status: 'outcome-unknown' }), false],
    ['abandoned', operationRecord({ status: 'abandoned' }), false],
    ['confirmed applied', operationRecord({ status: 'resolved-applied' }), true],
    ['confirmed not applied', operationRecord({ status: 'resolved-not-applied' }), true],
  ] as const)(
    'requires correlated original operation proof: %s',
    async (_label, proof, resolved) => {
      const s = await store();
      const w = await s.createWorkflow(input());
      const inspected: string[] = [];
      const boundary = control({
        invoke: async call => {
          if (call.name === 'portal_plan') return { planId };
          if (call.name === 'portal_start') return serviceResult('ready-to-apply');
          if (call.name === 'portal_status') return serviceResult('ready-to-apply');
          call.emit({ status: 'accepted-locally', operationId: 'unresolved-apply' });
          throw Object.assign(new Error('lost response'), { code: 'CONTROL_AUTH_BUSY' });
        },
      });
      Object.assign(boundary, {
        inspectOriginalOperation: async (id: string) => {
          inspected.push(id);
          return proof;
        },
      });
      const bridge = new PortalBridge(s, boundary);
      const run = await bridge.start(w.id, 1);
      await waitRun(bridge, run.id);
      await bridge.action(run.id, { action: 'apply' });
      await waitRun(bridge, run.id);
      await bridge.action(run.id, { action: 'refresh' });
      const result = await waitRun(bridge, run.id);
      expect(result.status).toBe(resolved ? 'awaiting-input' : 'unknown');
      expect(result.actions.find(a => a.action === 'apply')?.enabled).toBe(resolved);
      expect(inspected).toEqual(['unresolved-apply']);
    },
  );
  it.each(['CONTROL_AUTH_BUSY', 'UNEXPECTED_SERVICE_FAILURE'])(
    'fences dispatched apply with %s until an authoritative outcome exists',
    async code => {
      const s = await store();
      const w = await s.createWorkflow(input());
      const bridge = new PortalBridge(
        s,
        control({
          invoke: async call => {
            if (call.name === 'portal_plan') return { planId };
            if (call.name === 'portal_start') return serviceResult('ready-to-apply');
            call.emit({ status: 'accepted-locally', operationId: 'unresolved-apply' });
            throw Object.assign(new Error('monitoring failed'), { code, status: 503 });
          },
        }),
      );
      const run = await bridge.start(w.id, 1);
      await waitRun(bridge, run.id);
      await bridge.action(run.id, { action: 'apply' });
      const result = await waitRun(bridge, run.id);
      expect(result.status).toBe('unknown');
      expect(result.operationId).toBe('unresolved-apply');
      expect(result.actions.find(a => a.action === 'apply')?.enabled).toBe(false);
      await expect(bridge.action(run.id, { action: 'apply' })).rejects.toMatchObject({
        code: 'ACTION_UNAVAILABLE',
      });
    },
  );
  it('records a correlated authoritative terminal failure without inventing completion', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          if (call.name === 'portal_plan') return { planId };
          if (call.name === 'portal_start') return serviceResult('ready-to-apply');
          call.emit({ status: 'accepted-locally', operationId: 'failed-apply' });
          call.emit({ status: 'failed', operationId: 'failed-apply' });
          throw Object.assign(new Error('terminal failure'), { code: 'PORTAL_TARGET_CHANGED' });
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    await bridge.action(run.id, { action: 'apply' });
    const result = await waitRun(bridge, run.id);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('PORTAL_TARGET_CHANGED');
  });
  it.each([
    ['applied-awaiting-validation', 'waiting'],
    ['validating-applied', 'active'],
  ])('keeps applied validation outstanding for service state %s', async (state, expected) => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => (call.name === 'portal_plan' ? { planId } : serviceResult(state!)),
      }),
    );
    const run = await bridge.start(w.id, 1);
    await expect.poll(() => bridge.getRun(run.id).result?.state).toBe(state);
    const result = bridge.getRun(run.id);
    expect(result.nodes.find(n => n.type === 'validation')?.status).toBe(expected);
    expect(result.nodes.find(n => n.type === 'output')?.status).toBe('waiting');
    await expect
      .poll(() => bridge.getRun(run.id).actions.some(a => a.reason.startsWith('Another operation')))
      .toBe(false);
  });
  it('preserves unknown outcome fencing when an explicit status read fails', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          if (call.name === 'portal_plan') return { planId };
          if (call.name === 'portal_start') {
            call.emit({ status: 'accepted-locally', operationId: 'unknown-start' });
            return serviceResult('outcome-unknown');
          }
          throw Object.assign(new Error('offline'), { code: 'CONTROL_NOT_READY' });
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    await new Promise(r => setTimeout(r, 20));
    await bridge.action(run.id, { action: 'refresh' });
    const result = await waitRun(bridge, run.id);
    expect(result.status).toBe('unknown');
    expect(result.operationId).toBe('unknown-start');
    await expect(
      bridge.action(run.id, { action: 'resume', args: { reconcile: 'continue' } }),
    ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
  });
  it('restores interrupted runs as unknown without replay and retains their graph revision', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call =>
          call.name === 'portal_plan' ? { planId } : serviceResult('waiting-agent'),
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    await new Promise(r => setTimeout(r, 20));
    await s.updateRun(run.id, r => {
      r.status = 'active';
      r.nodes.find(n => n.type === 'generation')!.status = 'active';
      r.nodes.find(n => n.type === 'validation')!.status = 'waiting';
    });
    await s.updateWorkflow(w.id, 1, { ...input(), graph: { ...input().graph, nodes: [] } });
    const recovered = await PortalStore.open(s.directory);
    await recovered.recoverInterrupted();
    const newBridge = new PortalBridge(recovered, control());
    expect(newBridge.getRun(run.id).status).toBe('unknown');
    expect(
      newBridge.getRun(run.id).nodes.filter(n => ['active', 'waiting'].includes(n.status)),
    ).toEqual([]);
    expect(newBridge.getRun(run.id).nodes.find(n => n.type === 'generation')?.status).toBe(
      'unknown',
    );
    expect(newBridge.getRun(run.id).graph.nodes).toHaveLength(5);
    expect(newBridge.getRun(run.id).workflowRevision).toBe(1);
  });
  it('uses the saved validation node profile and never displays cancelled nodes as active', async () => {
    const s = await store();
    const draft = input();
    draft.graph.nodes.find(n => n.type === 'validation')!.config.profileId = 'owner-reviewed';
    const w = await s.createWorkflow(draft);
    const seen: Array<{ name: string; args: unknown }> = [];
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          seen.push({ name: call.name, args: call.args });
          return call.name === 'portal_plan'
            ? { planId }
            : serviceResult(call.name === 'portal_cancel' ? 'cancelled' : 'candidate-ready');
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    await new Promise(r => setTimeout(r, 20));
    await bridge.action(run.id, { action: 'validate' });
    await waitRun(bridge, run.id);
    await new Promise(r => setTimeout(r, 20));
    expect(seen.find(v => v.name === 'portal_validate')?.args).toEqual({
      runId: planId,
      target: 'candidate',
      profileId: 'owner-reviewed',
    });
    await bridge.action(run.id, { action: 'cancel' });
    const cancelled = await waitRun(bridge, run.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.nodes.some(n => n.status === 'active')).toBe(false);
  });
  it('refuses a service response belonging to a different run', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call =>
          call.name === 'portal_plan'
            ? { planId }
            : {
                ...serviceResult('completed'),
                runId: 'sfp_portal1_22222222222222222222222222222222',
              },
      }),
    );
    const run = await bridge.start(w.id, 1);
    const result = await waitRun(bridge, run.id);
    expect(result.status).not.toBe('completed');
    expect(result.error?.code).toBe('SERVICE_RUN_MISMATCH');
  });
  it('uses captured plan and binds revision without claiming generation completion', async () => {
    const s = await store();
    const workflow = await s.createWorkflow(input());
    const calls: Array<{ name: string; targetSelector: unknown; args: unknown }> = [];
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          calls.push({ name: call.name, targetSelector: call.targetSelector, args: call.args });
          expect(call.approve).toBe(false);
          expect(call.workspaceId).toBe(workspaceId);
          if (call.name === 'portal_plan') {
            return { planId, implementationScope: 'frontend-only' };
          }
          expect(call.args).toEqual({ planId });
          return serviceResult('waiting-agent');
        },
      }),
    );
    const run = await bridge.start(workflow.id, 1);
    const done = await waitRun(bridge, run.id);
    expect(done.status).toBe('awaiting-agent');
    expect(done.workflowRevision).toBe(1);
    expect(done.nodes.find(n => n.type === 'generation')?.status).toBe('waiting');
    expect(calls.map(c => c.name)).toEqual(['portal_plan', 'portal_start']);
    expect(calls[0]?.targetSelector).toEqual({ kind: 'portal-source' });
    await expect(bridge.start(workflow.id, 9)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
  it('retains uncertain dispatched outcomes and prevents automatic replay', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    let calls = 0;
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          calls++;
          call.emit({ status: 'accepted-locally', operationId: 'operation-fixture' });
          throw Object.assign(new Error('secret credential'), { code: 'ECONNRESET' });
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    const result = await waitRun(bridge, run.id);
    expect(result.status).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('secret credential');
    await expect(bridge.action(run.id, { action: 'apply' })).rejects.toMatchObject({
      code: 'ACTION_UNAVAILABLE',
    });
    expect(calls).toBe(1);
  });
  it('keeps service approval scoped to the operation that requested it', async () => {
    const s = await store();
    const w = await s.createWorkflow(input());
    let release!: (v: unknown) => void;
    const bridge = new PortalBridge(
      s,
      control({
        invoke: async call => {
          if (call.name === 'portal_start') return serviceResult('waiting-agent');
          call.emit({ status: 'accepted-locally', operationId: 'own-operation' });
          call.emit({
            status: 'approval-required',
            prompt: {
              approvalId: 'own-approval',
              operationId: 'own-operation',
              expiresAt: Date.now() + 10000,
            },
          });
          return new Promise(r => {
            release = r;
          });
        },
      }),
    );
    const run = await bridge.start(w.id, 1);
    await waitRun(bridge, run.id);
    await expect(
      bridge.action(run.id, { action: 'approve', args: { approvalId: 'foreign-approval' } }),
    ).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' });
    release({ planId });
    await expect.poll(() => bridge.getRun(run.id).status).toBe('awaiting-agent');
    await waitRun(bridge, run.id);
  });
});

describe('local same-origin HTTP boundary', () => {
  it('blocks new effects at activity capacity but keeps unknown-outcome inspection available with a visible warning', async () => {
    const s = await store(),
      workflow = await s.createWorkflow(input());
    const original = new PortalBridge(
      s,
      control({
        invoke: async call =>
          call.name === 'portal_plan' ? { planId } : serviceResult('ready-to-apply'),
      }),
    );
    const run = await original.start(workflow.id, 1);
    await waitIdle(original, run.id);
    await s.updateRun(run.id, value => {
      value.status = 'unknown';
      value.operationId = 'original-unknown';
      value.unresolvedOperation = { id: 'original-unknown', name: 'portal_apply' };
    });
    const path = join(s.directory, 'portal.json');
    const data = JSON.parse(await readFile(path, 'utf8'));
    const at = new Date().toISOString();
    while (data.activities.length < ACTIVITY_CAPACITY)
      data.activities.push({
        id: randomUUID(),
        sequence: data.nextActivitySequence++,
        at,
        updatedAt: at,
        type: 'guide.open',
        source: 'client',
        status: 'intent',
        actor: 'local-owner',
        sessionId: s.activitySessionId,
        requestId: randomUUID(),
        metadata: {},
      });
    await writeFile(path, JSON.stringify(data));
    const full = await PortalStore.open(s.directory);
    let registrations = 0,
      inspected = 0;
    const bridge = new PortalBridge(
      full,
      control({
        registerWorkspace: async folder => {
          registrations++;
          return { workspaceId, realPath: folder };
        },
        invoke: async call => {
          if (call.name === 'portal_status') inspected++;
          return serviceResult('ready-to-apply');
        },
      }),
    );
    const server = createPortalServer({
      store: full,
      bridge,
      webRoot: join(import.meta.dirname, '../web'),
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing fixture address');
    const origin = `http://127.0.0.1:${address.port}`;
    const bootstrap = (await fetch(origin + '/api/bootstrap').then(response =>
      response.json(),
    )) as { csrfToken: string };
    const post = (routePath: string, body: unknown) =>
      fetch(origin + routePath, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, 'x-sfp-csrf': bootstrap.csrfToken },
        body: JSON.stringify(body),
      });
    expect(
      (
        await post('/api/workspaces', {
          folder: process.platform === 'win32' ? 'C:/fixture' : '/fixture',
        })
      ).status,
    ).toBe(409);
    expect(registrations).toBe(0);
    const refreshed = await post('/api/runs/' + run.id + '/actions', { action: 'refresh' });
    expect(refreshed.status).toBe(202);
    expect(refreshed.headers.get('x-sfp-activity-warning')).toBe('ACTIVITY_CAPACITY');
    await waitIdle(bridge, run.id);
    expect(inspected).toBe(1);
    expect(bridge.getRun(run.id)).toMatchObject({
      status: 'unknown',
      operationId: 'original-unknown',
    });
    expect((await fetch(origin + '/api/activities')).status).toBe(200);
  });
  it.each(['before', 'after'] as const)(
    'reports durable audit failure %s workspace effects without claiming logged success',
    async phase => {
      const s = await store();
      let registrations = 0;
      const breakStorage = async () => {
        await rename(join(s.directory, 'portal.json'), join(s.directory, 'preserved-audit.json'));
        await mkdir(join(s.directory, 'portal.json'));
      };
      const bridge = new PortalBridge(
        s,
        control({
          registerWorkspace: async folder => {
            registrations++;
            if (phase === 'after') await breakStorage();
            return { workspaceId, realPath: folder, availability: 'available' };
          },
        }),
      );
      const server = createPortalServer({
        store: s,
        bridge,
        webRoot: join(import.meta.dirname, '../web'),
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('Missing fixture address');
      const origin = `http://127.0.0.1:${address.port}`;
      const bootstrap = (await fetch(origin + '/api/bootstrap').then(response =>
        response.json(),
      )) as { csrfToken: string };
      if (phase === 'before') await breakStorage();
      const response = await fetch(origin + '/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, 'x-sfp-csrf': bootstrap.csrfToken },
        body: JSON.stringify({ folder: process.platform === 'win32' ? 'C:/fixture' : '/fixture' }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: 'ACTIVITY_WRITE_FAILED' } });
      expect(registrations).toBe(phase === 'before' ? 0 : 1);
      expect(
        s.listActivities({ type: 'workspace.register', status: 'succeeded' }).activities,
      ).toEqual([]);
      expect(s.activityHealth()).toMatchObject({
        available: false,
        complete: false,
        errorCode: 'ACTIVITY_WRITE_FAILED',
      });
    },
  );
  it('persists separate UI intent and authoritative workflow outcomes without raw headers or text', async () => {
    const s = await store();
    const server = createPortalServer({
      store: s,
      bridge: new PortalBridge(s, control()),
      webRoot: join(import.meta.dirname, '../web'),
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing fixture address');
    const origin = `http://127.0.0.1:${address.port}`;
    const bootstrap = (await fetch(origin + '/api/bootstrap').then(response =>
      response.json(),
    )) as { csrfToken: string };
    const sentinel = 'SFP_TEST_PRIVATE_TEXT';
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(origin + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          'x-sfp-csrf': bootstrap.csrfToken,
          authorization: 'Bearer ' + sentinel,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    expect((await post('/api/activities', { type: 'guide.open', metadata: {} })).status).toBe(201);
    expect(
      (
        await post('/api/activities', {
          type: 'guide.open',
          source: 'server',
          status: 'succeeded',
          metadata: { password: sentinel },
        })
      ).status,
    ).toBe(400);
    expect(
      (await post('/api/activities', { type: 'guide.open' }, { 'x-sfp-csrf': 'invalid' })).status,
    ).toBe(403);
    const created = await post('/api/workflows', { ...input(), description: sentinel });
    expect(created.status).toBe(201);
    const workflow = (await created.json()) as { id: string };
    const response = await fetch(origin + '/api/activities?limit=100');
    expect(response.status).toBe(200);
    const history = (await response.json()) as {
      activities: Array<{
        id: string;
        type: string;
        source: string;
        status: string;
        workflowId?: string;
      }>;
    };
    expect(history.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'guide.open', source: 'client', status: 'intent' }),
        expect.objectContaining({
          type: 'workflow.create',
          source: 'server',
          status: 'succeeded',
          workflowId: workflow.id,
        }),
        expect.objectContaining({ type: 'request.rejected', status: 'failed' }),
      ]),
    );
    expect(JSON.stringify(history)).not.toContain(sentinel);
    const reloaded = await PortalStore.open(s.directory);
    expect(reloaded.listWorkflows()[0]!.description).toBe(sentinel);
    expect(reloaded.listActivities({ limit: 100 }).activities.map(row => row.id)).toEqual(
      history.activities.map(row => row.id),
    );
  });
  it('registers only an explicit local workspace through the guarded closed endpoint and reports safe errors', async () => {
    const s = await store();
    const folders: string[] = [];
    const bridge = new PortalBridge(
      s,
      control({
        registerWorkspace: async folder => {
          folders.push(folder);
          if (folder.endsWith('missing'))
            throw Object.assign(Error('private-token and private daemon location'), {
              code: 'ENOENT',
            });
          return { workspaceId, realPath: folder, availability: 'available' };
        },
      }),
    );
    const server = createPortalServer({
      store: s,
      bridge,
      webRoot: join(import.meta.dirname, '../web'),
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing fixture address');
    const origin = `http://127.0.0.1:${address.port}`;
    const bootstrap = (await fetch(origin + '/api/bootstrap').then(response =>
      response.json(),
    )) as { csrfToken: string };
    const post = (
      body: unknown,
      headers: Record<string, string> = { 'x-sfp-csrf': bootstrap.csrfToken, origin },
    ) =>
      fetch(origin + '/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const folder = process.platform === 'win32' ? 'C:/fixture/workspace' : '/fixture/workspace';
    expect((await post({ folder }, {})).status).toBe(403);
    expect(
      (
        await post(
          { folder },
          { 'x-sfp-csrf': bootstrap.csrfToken, origin: 'https://foreign.example' },
        )
      ).status,
    ).toBe(403);
    const invalid = await Promise.all(
      [
        { folder: '../relative' },
        { folder: 'https://example.com/' },
        { folder: '\\\\server\\share' },
        { folder: '//server/share' },
        { folder, tool: 'run-command' },
      ].map(body => post(body)),
    );
    expect(invalid.map(response => response.status)).toEqual([400, 400, 400, 400, 400]);
    expect(folders).toEqual([]);
    const registered = await post({ folder });
    expect(registered.status).toBe(201);
    expect(await registered.json()).toEqual({
      workspace: { workspaceId, realPath: folder, availability: 'available' },
    });
    expect(folders).toEqual([folder]);
    const missing = await post({ folder: folder + '/missing' });
    const error = (await missing.json()) as { error: { code: string; message: string } };
    expect(missing.status).toBe(400);
    expect(error.error.code).toBe('ENOENT');
    expect(error.error.message).toMatch(/[가-힣]/u);
    expect(JSON.stringify(error)).not.toMatch(/private-token|daemon location/u);
  });
  it('serves bootstrap without login and fences Host, Origin, CSRF, unknown routes, and oversized bodies', async () => {
    const s = await store();
    const bridge = new PortalBridge(s, control({ health: async () => false }));
    const server = createPortalServer({
      store: s,
      bridge,
      webRoot: join(import.meta.dirname, '../web'),
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    cleanup.push(() => new Promise<void>(r => server.close(() => r())));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    const url = `http://127.0.0.1:${address.port}`;
    const bootstrap = (await fetch(`${url}/api/bootstrap`).then(r => r.json())) as {
      csrfToken: string;
      service: { available: boolean };
    };
    expect(bootstrap.service.available).toBe(false);
    expect(bootstrap.csrfToken).toBeTruthy();
    const post = (headers: Record<string, string>, body: unknown = input()) =>
      fetch(`${url}/api/workflows`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    expect((await post({})).status).toBe(403);
    expect(
      (await post({ origin: 'https://attacker.test', 'x-sfp-csrf': bootstrap.csrfToken })).status,
    ).toBe(403);
    expect((await post({ origin: url, 'x-sfp-csrf': bootstrap.csrfToken })).status).toBe(201);
    const forbidden = await new Promise<number>(resolve => {
      const req = request(`${url}/api/bootstrap`, { headers: { host: 'attacker.test' } }, res => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.end();
    });
    expect(forbidden).toBe(403);
    const traversal = await new Promise<number>(resolve => {
      const req = request(
        { hostname: '127.0.0.1', port: address.port, path: '/%2e%2e/api/bootstrap' },
        res => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.end();
    });
    expect(traversal).toBe(400);
    expect((await fetch(`${url}/api/tools/call`)).status).toBe(404);
    expect(
      (
        await post(
          { 'x-sfp-csrf': bootstrap.csrfToken },
          { content: 'x'.repeat(12 * 1024 * 1024 + 1) },
        )
      ).status,
    ).toBe(413);
  });
});
