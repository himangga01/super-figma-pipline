import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NO_CAPTURE_OPTIONS,
  type ActorContext,
  type OperationInvocationService,
  type OperationRecord,
} from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDurableExecutionPlaneLifecyclePorts,
  GenerationRuntimeLifecycleRegistry,
  createLazyLeaderRuntimeBoundary,
  LeaderGenerationExecutionPlane,
  type ApprovalDecisionPort,
  type ExecutionPlaneAdmissionAuthority,
} from '../../src/execution/execution-plane.js';
import {
  OperationJournal,
  hashOperationFingerprint,
  type NewOperationRecord,
} from '../../src/execution/operation-journal.js';

const lifecycleRoots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    lifecycleRoots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  );
});

const lifecycleActorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const lifecycleAuthId = 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const lifecycleRecord = (operationId: string): NewOperationRecord => {
  const fingerprint = {
    actorId: lifecycleActorId,
    operationId,
    operationKind: 'tool' as const,
    operationName: 'create_text' as const,
    argsHash: `sha256:${'a'.repeat(64)}` as const,
    workspaceId: null,
    fileExecutionKeyHash: null,
    targetBindingHash: null,
    captureIntentHash: `sha256:${'b'.repeat(64)}` as const,
  };
  return {
    ...fingerprint,
    originAuthSessionId: lifecycleAuthId,
    origin: { kind: 'entry', entryPath: 'mcp-direct', authSessionId: lifecycleAuthId },
    issuedAt: 1_724_803_200_000,
    operationFingerprintHash: hashOperationFingerprint(fingerprint),
    resultHash: null,
    resultBytes: null,
    fileExecutionKey: null,
    pluginGeneration: null,
    policyId: 'tool:create_text:v1',
    effectSummary: ['figma-write'],
    approvalId: null,
    preExecutionConsentManifestHash: null,
    finalEgressManifestHash: null,
    operationEvidenceReceiptHash: null,
  };
};

const harness = (options: { failUnknownFsync?: boolean; drain?: boolean } = {}) => {
  const events: string[] = [];
  let now = 10_000;
  const event = (name: string) => async () => {
    events.push(name);
  };
  const plane = new LeaderGenerationExecutionPlane(
    'generation-2',
    {
      closeAdmission: event('admission-closed'),
      installGenerationFence: event('generation-fence-installed'),
      abortPending: event('pending-aborted'),
      abortQueued: event('queued-aborted'),
      markDispatchedOutcomeUnknown: async () => {
        events.push('dispatched-outcome-unknown-fsynced');
        if (options.failUnknownFsync === true) throw new Error('fsync failed');
      },
      finalizeAndFlushEgress: event('egress-finalized-and-flushed'),
      drainTransport: async deadline => {
        events.push(`transport-drain-${deadline}`);
        now = deadline;
        return options.drain ?? false;
      },
      forceCloseTransport: event('transport-force-closed'),
      destroy: event('plane-destroyed'),
      releasePort: event('port-released'),
    },
    () => now,
  );
  return { plane, events, setNow: (value: number) => (now = value) };
};

describe('leader-generation execution plane lifecycle', () => {
  it('aborts and closes an initializing runtime so no retention timer survives demotion', async () => {
    vi.useFakeTimers();
    const registry = new GenerationRuntimeLifecycleRegistry<{
      close(): Promise<void>;
    }>();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let initializationSignal: AbortSignal | undefined;
    const close = vi.fn<() => Promise<void>>(async () => undefined);
    const initializing = registry.initialize('generation-initializing', async signal => {
      initializationSignal = signal;
      await gate;
      const timer = setInterval(() => undefined, 86_400_000);
      return {
        close: async () => {
          clearInterval(timer);
          await close();
        },
      };
    });
    const demotion = registry.close('generation-initializing');
    expect(initializationSignal?.aborted).toBe(true);
    release();

    await expect(initializing).rejects.toMatchObject({ code: 'LEADER_GENERATION_CLOSED' });
    await expect(demotion).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses real journal durability to fence and settle every generation state before port release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-durable-demotion-'));
    lifecycleRoots.push(root);
    const journal = new OperationJournal({ stateRoot: root, actorId: lifecycleActorId });
    await journal.recover();
    await journal.appendInitial(lifecycleRecord('pending-op'), 'pending-approval', {
      leaderGeneration: 'generation-2',
    });
    await journal.appendInitial(lifecycleRecord('queued-op'), 'queued', {
      leaderGeneration: 'generation-2',
    });
    await journal.appendInitial(lifecycleRecord('dispatched-op'), 'queued', {
      leaderGeneration: 'generation-2',
    });
    await journal.transition(
      'dispatched-op',
      'dispatched',
      {},
      {
        expectedLeaderGeneration: 'generation-2',
      },
    );
    const events: string[] = [];
    const ports = createDurableExecutionPlaneLifecyclePorts({
      leaderGeneration: 'generation-2',
      journal,
      flushDurability: async () => events.push('flush'),
      drainTransport: async () => false,
      forceCloseTransport: async () => events.push('force-close'),
      destroy: async () => events.push('destroy'),
      releasePort: async () => events.push('release'),
    });
    const plane = new LeaderGenerationExecutionPlane('generation-2', ports);

    const ticket = await plane.prepareDemotion('lease-lost');
    await expect(plane.finalizeDemotion(ticket)).resolves.toBe('port-released');

    expect(journal.get('pending-op')).toMatchObject({
      status: 'pre-egress-rejected',
      errorCode: 'LEADER_GENERATION_CLOSED',
    });
    expect(journal.get('queued-op')).toMatchObject({
      status: 'failed',
      errorCode: 'LEADER_GENERATION_CLOSED',
    });
    expect(journal.get('dispatched-op')).toMatchObject({
      status: 'outcome-unknown',
      errorCode: 'LEADER_GENERATION_CLOSED',
    });
    expect(events).toEqual(['flush', 'force-close', 'destroy', 'release']);
  });
  it('defers recovery until the first authenticated boundary and shares one fail-closed flight', async () => {
    let recoveries = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const boundary = createLazyLeaderRuntimeBoundary(async () => {
      recoveries += 1;
      await gate;
      return Object.freeze({ ready: true });
    });

    expect(boundary.peek()).toBeUndefined();
    expect(recoveries).toBe(0);
    const first = boundary.get();
    const concurrent = boundary.get();
    expect(recoveries).toBe(1);
    release();
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      { ready: true },
      { ready: true },
    ]);
    expect(boundary.peek()).toEqual({ ready: true });

    let failedRecoveries = 0;
    const failure = Object.assign(new Error('recovery failed'), { code: 'RECOVERY_FAILED' });
    const failed = createLazyLeaderRuntimeBoundary(async () => {
      failedRecoveries += 1;
      throw failure;
    });
    await expect(Promise.all([failed.get(), failed.get()])).rejects.toBe(failure);
    await expect(failed.get()).rejects.toBe(failure);
    expect(failedRecoveries).toBe(1);
    expect(failed.peek()).toBeUndefined();
  });
  it('closes, fences, durably drains, destroys, and only then releases the port', async () => {
    const { plane, events } = harness();
    const ticket = await plane.prepareDemotion('lease-lost');

    expect(ticket).toEqual({
      leaderGeneration: 'generation-2',
      startedAt: 10_000,
      deadlineAt: 15_000,
      transportDrainDeadlineAt: 11_000,
    });
    await expect(plane.finalizeDemotion(ticket)).resolves.toBe('port-released');
    expect(events).toEqual([
      'admission-closed',
      'generation-fence-installed',
      'pending-aborted',
      'queued-aborted',
      'dispatched-outcome-unknown-fsynced',
      'egress-finalized-and-flushed',
      'transport-drain-11000',
      'transport-force-closed',
      'plane-destroyed',
      'port-released',
    ]);
  });

  it('retains the port when required demotion durability fails and rejects ticket reuse', async () => {
    const { plane, events } = harness({ failUnknownFsync: true });
    const ticket = await plane.prepareDemotion('shutdown');

    await expect(plane.finalizeDemotion(ticket)).resolves.toBe('port-retained-durability-failure');
    expect(events).not.toContain('port-released');
    await expect(plane.finalizeDemotion(ticket)).rejects.toMatchObject({
      code: 'DEMOTION_TICKET_INVALID',
    });
  });

  it('enforces the one-second drain and five-second absolute demotion deadlines', async () => {
    vi.useFakeTimers();
    const drainEvents: string[] = [];
    const drainPlane = new LeaderGenerationExecutionPlane(
      'generation-2',
      {
        closeAdmission: async () => {},
        installGenerationFence: async () => {},
        abortPending: async () => {},
        abortQueued: async () => {},
        markDispatchedOutcomeUnknown: async () => {},
        finalizeAndFlushEgress: async () => {},
        drainTransport: async () => new Promise<boolean>(() => {}),
        forceCloseTransport: async () => {
          drainEvents.push('forced');
        },
        destroy: async () => {
          drainEvents.push('destroyed');
        },
        releasePort: async () => {
          drainEvents.push('released');
        },
      },
      Date.now,
    );
    const drainPreparation = drainPlane.prepareDemotion('lease-lost');
    await vi.advanceTimersByTimeAsync(999);
    expect(drainEvents).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const drainTicket = await drainPreparation;
    await expect(drainPlane.finalizeDemotion(drainTicket)).resolves.toBe('port-released');
    expect(drainEvents).toEqual(['forced', 'destroyed', 'released']);

    const deadlineEvents: string[] = [];
    const deadlinePlane = new LeaderGenerationExecutionPlane(
      'generation-3',
      {
        closeAdmission: async () => new Promise<void>(() => {}),
        installGenerationFence: async () => {
          deadlineEvents.push('unexpected-fence');
        },
        abortPending: async () => {},
        abortQueued: async () => {},
        markDispatchedOutcomeUnknown: async () => {},
        finalizeAndFlushEgress: async () => {},
        drainTransport: async () => true,
        forceCloseTransport: async () => {
          deadlineEvents.push('forced');
        },
        destroy: async () => {
          deadlineEvents.push('destroyed');
        },
        releasePort: async () => {
          deadlineEvents.push('released');
        },
      },
      Date.now,
    );
    const deadlinePreparation = deadlinePlane.prepareDemotion('shutdown');
    await vi.advanceTimersByTimeAsync(5_000);
    const deadlineTicket = await deadlinePreparation;
    await expect(deadlinePlane.finalizeDemotion(deadlineTicket)).resolves.toBe(
      'port-retained-durability-failure',
    );
    expect(deadlineEvents).not.toContain('released');
  });

  it('does not invoke port release when finalization starts after the absolute deadline', async () => {
    let now = 30_000;
    const releasePort = vi.fn<(signal: AbortSignal) => Promise<void>>(async () => {});
    const plane = new LeaderGenerationExecutionPlane(
      'generation-delayed-finalize',
      {
        closeAdmission: async () => {},
        installGenerationFence: async () => {},
        abortPending: async () => {},
        abortQueued: async () => {},
        markDispatchedOutcomeUnknown: async () => {},
        finalizeAndFlushEgress: async () => {},
        drainTransport: async () => true,
        forceCloseTransport: async () => {},
        destroy: async () => {},
        releasePort,
      },
      () => now,
    );
    const ticket = await plane.prepareDemotion('shutdown');
    now = ticket.deadlineAt + 1;

    await expect(plane.finalizeDemotion(ticket)).resolves.toBe('port-retained-durability-failure');
    expect(releasePort).not.toHaveBeenCalled();
  });

  it('shares concurrent finalization and releases the leader port exactly once', async () => {
    let release!: () => void;
    const releaseGate = new Promise<void>(resolve => {
      release = resolve;
    });
    const releasePort = vi.fn<(signal: AbortSignal) => Promise<void>>(async () => {
      await releaseGate;
    });
    const { plane } = harness({ drain: true });
    // Replace the harness's release callback while preserving all other lifecycle behavior.
    const boundPlane = new LeaderGenerationExecutionPlane(plane.leaderGeneration, {
      closeAdmission: async () => {},
      installGenerationFence: async () => {},
      abortPending: async () => {},
      abortQueued: async () => {},
      markDispatchedOutcomeUnknown: async () => {},
      finalizeAndFlushEgress: async () => {},
      drainTransport: async () => true,
      forceCloseTransport: async () => {},
      destroy: async () => {},
      releasePort,
    });
    const ticket = await boundPlane.prepareDemotion('abdicated');
    const first = boundPlane.finalizeDemotion(ticket);
    const concurrent = boundPlane.finalizeDemotion(ticket);
    expect(concurrent).toBe(first);
    await Promise.resolve();
    expect(releasePort).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      'port-released',
      'port-released',
    ]);
    await expect(boundPlane.finalizeDemotion(ticket)).rejects.toMatchObject({
      code: 'DEMOTION_TICKET_INVALID',
    });
    expect(releasePort).toHaveBeenCalledOnce();
  });

  it('bounds a never-resolving port release by the same absolute demotion deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    let lateMutation = false;
    let observedSignal: AbortSignal | undefined;
    const releasePort = vi.fn<(signal: AbortSignal) => Promise<void>>(async signal => {
      observedSignal = signal;
      await new Promise<void>(resolve => {
        setTimeout(() => {
          if (!signal.aborted) lateMutation = true;
          resolve();
        }, 6_000);
      });
    });
    const plane = new LeaderGenerationExecutionPlane(
      'generation-release-timeout',
      {
        closeAdmission: async () => {},
        installGenerationFence: async () => {},
        abortPending: async () => {},
        abortQueued: async () => {},
        markDispatchedOutcomeUnknown: async () => {},
        finalizeAndFlushEgress: async () => {},
        drainTransport: async () => true,
        forceCloseTransport: async () => {},
        destroy: async () => {},
        releasePort,
      },
      Date.now,
    );
    const ticket = await plane.prepareDemotion('shutdown');
    const finalization = plane.finalizeDemotion(ticket);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(releasePort).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(finalization).resolves.toBe('port-retained-durability-failure');
    expect(observedSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lateMutation).toBe(false);
  });

  it('is single-flight and rejects new admission once preparation begins', async () => {
    const { plane } = harness({ drain: true });
    const first = plane.prepareDemotion('abdicated');
    const second = plane.prepareDemotion('abdicated');
    expect(second).toBe(first);
    const ticket = await first;
    expect(plane.admissionOpen).toBe(false);
    await plane.finalizeDemotion(ticket);
  });

  it('owns tool invocation for one generation and closes admission before demotion work', async () => {
    const invokeTool = vi.fn<OperationInvocationService['invokeTool']>(async runtimeScope => {
      if (runtimeScope.actor.entryPath === 'control') {
        throw Object.assign(
          new Error(
            'C:\\Users\\owner\\secret.fig https://token.example/?key=abc data:image/png;base64,AAAA',
          ),
          { code: 'PLUGIN_RESULT_INVALID' },
        );
      }
      return { ok: true };
    });
    const { plane } = harness({ drain: true });
    const events: string[] = [];
    const principal: ActorContext = Object.freeze({
      actorId: 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      authSessionId: 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      entryPath: 'mcp-direct',
    });
    plane.bindAdmissionAuthority({
      resolveWorkspaceContext: async workspaceId => {
        events.push('workspace');
        expect(workspaceId).toBeNull();
        return { workspaceId: null, workspaceRoot: null };
      },
      workspacePolicy: {
        resolveRead: async () => {
          throw new Error('unexpected path read');
        },
        resolveWrite: async () => {
          throw new Error('unexpected path write');
        },
        assertWithinRoot: async () => {},
      },
      targetResolver: {
        resolve: (selector, requirement) => {
          events.push('target');
          expect(selector).toEqual({ kind: 'active' });
          expect(requirement).toBe('required');
          return {
            sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
            pluginGeneration: 'plugin-g1',
            fileIdentity: { kind: 'figma-file-key', value: 'file-a' },
            fileExecutionKey: 'figma:file-a',
          };
        },
      },
      approval: {
        request: async (resolvedScope, operationName, effects, operationId) => {
          events.push('approval-request');
          expect(operationName).toBe('create_text');
          expect(effects).toContainEqual(expect.objectContaining({ type: 'figma-write' }));
          expect(operationId).toBe('supplied-operation');
          expect(resolvedScope).not.toHaveProperty('consent');
          expect(Object.isFrozen(resolvedScope)).toBe(true);
          return {
            approvalId: 'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
            waitForDecision: async () => {
              events.push('approval-decision');
              return {
                decision: 'approved' as const,
                actorId: principal.actorId,
                operationId,
                decidedAt: '2024-08-28T00:00:00.000Z',
              };
            },
          };
        },
      },
      authorizeEgress: async () => {
        events.push('egress');
        return {
          mode: 'local-trusted',
          consentId: null,
          allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
        };
      },
      issueOperationId: () => 'issued-operation',
      verifyOperationId: (_actorId, operationId) => {
        expect(operationId).toBe('supplied-operation');
      },
    });
    plane.bindInvocationService({
      beginToolApproval: async () => {
        events.push('pending-fsynced');
        return {} as never;
      },
      resumeApprovedTool: async (_handle, runtimeScope) => {
        events.push('runtime-service');
        return invokeTool(runtimeScope, 'create_text', { characters: 'A' });
      },
      rejectToolApproval: async () => {
        throw new Error('unexpected approval rejection');
      },
      invokeTool: async (...args) => {
        events.push('runtime-service');
        return invokeTool(...args);
      },
      invokeService: async () => ({}),
      status: () => undefined,
    });
    const request = {
      version: 1,
      requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
      toolName: 'create_text',
      rawArgs: { characters: 'A' },
      operationId: 'supplied-operation',
      workspaceId: null,
      targetSelector: { kind: 'active' },
    } as const;

    await expect(plane.invokeTool(principal, request, NO_CAPTURE_OPTIONS)).resolves.toEqual({
      ok: true,
    });
    expect(invokeTool).toHaveBeenCalledOnce();
    const admittedScope = invokeTool.mock.calls[0]![0];
    expect(events).toEqual([
      'workspace',
      'target',
      'approval-request',
      'pending-fsynced',
      'approval-decision',
      'egress',
      'runtime-service',
    ]);
    expect(admittedScope).toMatchObject({
      leaderGeneration: 'generation-2',
      actor: principal,
      target: {
        sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
        pluginGeneration: 'plugin-g1',
        fileExecutionKey: 'figma:file-a',
      },
      consent: { mode: 'local-trusted' },
    });
    expect(Object.isFrozen(admittedScope)).toBe(true);
    expect(Object.isFrozen(admittedScope.actor)).toBe(true);
    expect(Object.isFrozen(admittedScope.target)).toBe(true);
    expect(Object.isFrozen(admittedScope.target.fileIdentity)).toBe(true);
    expect(Object.isFrozen(admittedScope.consent)).toBe(true);
    expect(Object.isFrozen(admittedScope.consent.allowedClasses)).toBe(true);
    const controlError = await plane
      .invokeTool({ ...principal, entryPath: 'control' }, request, NO_CAPTURE_OPTIONS)
      .then(
        () => null,
        error => error,
      );
    expect(controlError).toMatchObject({
      code: 'PLUGIN_RESULT_INVALID',
      message: 'plugin returned an invalid result',
    });
    expect(JSON.stringify(controlError)).not.toMatch(/secret\.fig|token\.example|base64/iu);
    await plane.prepareDemotion('shutdown');
    await expect(plane.invokeTool(principal, request, NO_CAPTURE_OPTIONS)).rejects.toMatchObject({
      code: 'LEADER_GENERATION_CLOSED',
    });
  });

  it('fails closed before admission when the principal or approval decision is invalid', async () => {
    const { plane } = harness({ drain: true });
    const invocation = vi.fn<OperationInvocationService['invokeTool']>(async () => ({}));
    const approval = vi.fn<ApprovalDecisionPort['request']>(async () => ({
      approvalId: 'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
      waitForDecision: async () => ({ decision: 'rejected' as const }),
    }));
    const beginApproval = vi.fn<OperationInvocationService['beginToolApproval']>(
      async () => ({}) as never,
    );
    const rejectApproval = vi.fn<OperationInvocationService['rejectToolApproval']>(
      async () =>
        ({
          status: 'pre-egress-rejected',
        }) as never,
    );
    plane.bindAdmissionAuthority({
      resolveWorkspaceContext: async () => ({ workspaceId: null, workspaceRoot: null }),
      workspacePolicy: {
        resolveRead: async () => '',
        resolveWrite: async () => ({ path: '', overwrites: false }),
        assertWithinRoot: async () => {},
      },
      targetResolver: {
        resolve: () => ({
          sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
          pluginGeneration: 'plugin-g1',
          fileIdentity: { kind: 'figma-file-key', value: 'file-a' },
          fileExecutionKey: 'figma:file-a',
        }),
      },
      approval: { request: approval },
      authorizeEgress: async () => {
        throw new Error('egress must remain unreachable');
      },
      issueOperationId: () => 'issued-operation',
      verifyOperationId: () => {},
    });
    plane.bindInvocationService({
      beginToolApproval: beginApproval,
      resumeApprovedTool: async () => ({}),
      rejectToolApproval: rejectApproval,
      invokeTool: invocation,
      invokeService: async () => ({}),
      status: () => undefined,
    });
    const request = {
      version: 1,
      requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
      toolName: 'create_text',
      rawArgs: { characters: 'A' },
      targetSelector: { kind: 'active' },
    };

    await expect(
      plane.invokeTool(
        {
          actorId: 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          authSessionId: 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          entryPath: 'forged',
        } as never,
        request,
      ),
    ).rejects.toMatchObject({ code: 'INVOCATION_PRINCIPAL_INVALID' });
    await expect(
      plane.invokeTool(
        {
          actorId: 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          authSessionId: 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          entryPath: 'mcp-direct',
        },
        request,
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_REJECTED' });
    expect(beginApproval).toHaveBeenCalledOnce();
    expect(rejectApproval).toHaveBeenCalledWith(expect.anything(), 'APPROVAL_REJECTED');
    expect(invocation).not.toHaveBeenCalled();
  });

  it.each(['mcp-direct', 'control'] as const)(
    'rejects unknown %s raw argument keys before any admission authority runs',
    async entryPath => {
      const { plane } = harness({ drain: true });
      const workspace = vi.fn<ExecutionPlaneAdmissionAuthority['resolveWorkspaceContext']>(
        async () => ({ workspaceId: null, workspaceRoot: null }),
      );
      const approval = vi.fn<ApprovalDecisionPort['request']>(async () => ({
        approvalId: 'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
        waitForDecision: async () => ({ decision: 'approved' as const }),
      }));
      const egress = vi.fn<ExecutionPlaneAdmissionAuthority['authorizeEgress']>(async () => ({
        mode: 'local-trusted' as const,
        consentId: null,
        allowedClasses: [
          'public',
          'project-code',
          'design-text',
          'design-image',
          'secret',
        ] as const,
      }));
      const invocation = vi.fn<OperationInvocationService['invokeTool']>(async () => ({}));
      plane.bindAdmissionAuthority({
        resolveWorkspaceContext: workspace,
        workspacePolicy: {
          resolveRead: async () => '',
          resolveWrite: async () => ({ path: '', overwrites: false }),
          assertWithinRoot: async () => {},
        },
        targetResolver: {
          resolve: () => ({
            sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
            pluginGeneration: 'plugin-g1',
            fileIdentity: { kind: 'figma-file-key', value: 'file-a' },
            fileExecutionKey: 'figma:file-a',
          }),
        },
        approval: { request: approval },
        authorizeEgress: egress,
        issueOperationId: () => 'issued-operation',
        verifyOperationId: () => {},
      });
      plane.bindInvocationService({
        beginToolApproval: async () => ({}) as never,
        resumeApprovedTool: async () => ({}),
        rejectToolApproval: async () => ({}) as never,
        invokeTool: invocation,
        invokeService: async () => ({}),
        status: () => undefined,
      });

      await expect(
        plane.invokeTool(
          {
            actorId: 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            authSessionId: 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            entryPath,
          },
          {
            version: 1,
            requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
            toolName: 'create_text',
            rawArgs: { characters: 'A', actorId: 'forged' },
            targetSelector: { kind: 'active' },
          },
        ),
      ).rejects.toMatchObject({ code: 'INVOCATION_ARGS_INVALID' });
      expect(workspace).not.toHaveBeenCalled();
      expect(approval).not.toHaveBeenCalled();
      expect(egress).not.toHaveBeenCalled();
      expect(invocation).not.toHaveBeenCalled();
    },
  );

  it('does not emit a terminal frame while journal verification still reports dispatched', async () => {
    const { plane } = harness({ drain: true });
    const principal = Object.freeze({
      actorId: lifecycleActorId,
      authSessionId: lifecycleAuthId,
      entryPath: 'mcp-direct' as const,
    });
    const operationId = 'operation-terminal-unverified';
    plane.bindAdmissionAuthority({
      resolveWorkspaceContext: async () => ({ workspaceId: null, workspaceRoot: null }),
      workspacePolicy: {
        resolveRead: async () => '',
        resolveWrite: async () => ({ path: '', overwrites: false }),
        assertWithinRoot: async () => undefined,
      },
      targetResolver: {
        resolve: () => ({
          sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
          pluginGeneration: 'plugin-g1',
          fileIdentity: { kind: 'figma-file-key', value: 'file-a' },
          fileExecutionKey: 'figma:file-a',
        }),
      },
      approval: { request: async () => null },
      authorizeEgress: async () => ({
        mode: 'local-trusted',
        consentId: null,
        allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
      }),
      issueOperationId: () => operationId,
      verifyOperationId: () => undefined,
    });
    const dispatched = {
      ...lifecycleRecord(operationId),
      leaderGeneration: 'generation-2',
      sequence: 2,
      previousStatus: 'queued',
      status: 'dispatched',
      createdAt: '2024-08-28T00:00:00.000Z',
      settledAt: null,
      errorCode: null,
    } as never;
    plane.bindInvocationService({
      beginToolApproval: async () => ({}) as never,
      resumeApprovedTool: async () => ({}),
      rejectToolApproval: async () => ({}) as never,
      invokeTool: async () => {
        throw Object.assign(
          new Error(
            'C:\\Users\\owner\\secret.fig https://token.example data:image/png;base64,AAAA',
          ),
          {
            code: 'OPERATION_TERMINAL_DURABILITY_FAILED',
          },
        );
      },
      invokeService: async () => ({}),
      status: () => dispatched,
    });
    const observed: string[] = [];
    const consume = async () => {
      for await (const frame of plane.invokeToolFrames(principal, {
        version: 1,
        requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
        operationId,
        toolName: 'get_selection',
        rawArgs: {},
        targetSelector: { kind: 'active' },
      })) {
        observed.push(frame.type);
      }
    };

    const terminalError = await consume().then(
      () => null,
      error => error,
    );
    expect(terminalError).toMatchObject({
      code: 'OPERATION_TERMINAL_DURABILITY_FAILED',
      message: 'operation terminal durability failed',
    });
    expect(JSON.stringify(terminalError)).not.toMatch(/secret\.fig|token\.example|base64/iu);
    expect(observed).toEqual(['accepted']);
  });

  it('fails a waiting frame channel on subscriber abort without cancelling the producer', async () => {
    const { plane } = harness({ drain: true });
    const principal = Object.freeze({
      actorId: lifecycleActorId,
      authSessionId: lifecycleAuthId,
      entryPath: 'mcp-follower' as const,
    });
    const operationId = 'operation-disconnected-subscriber';
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let status: OperationRecord = {
      ...lifecycleRecord(operationId),
      sequence: 1,
      previousStatus: null,
      status: 'queued',
      createdAt: '2024-08-28T00:00:00.000Z',
      settledAt: null,
      errorCode: null,
      leaderGeneration: 'generation-2',
    } as OperationRecord;
    const cancel = vi.fn<NonNullable<OperationInvocationService['cancel']>>();
    plane.bindAdmissionAuthority({
      resolveWorkspaceContext: async () => ({ workspaceId: null, workspaceRoot: null }),
      workspacePolicy: {
        resolveRead: async () => '',
        resolveWrite: async () => ({ path: '', overwrites: false }),
        assertWithinRoot: async () => undefined,
      },
      targetResolver: {
        resolve: () => ({
          sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
          pluginGeneration: 'plugin-g1',
          fileIdentity: { kind: 'figma-file-key', value: 'file-a' },
          fileExecutionKey: 'figma:file-a',
        }),
      },
      approval: { request: async () => null },
      authorizeEgress: async () => ({
        mode: 'local-trusted',
        consentId: null,
        allowedClasses: ['public', 'project-code', 'design-text', 'design-image', 'secret'],
      }),
      issueOperationId: () => operationId,
      verifyOperationId: () => undefined,
    });
    plane.bindInvocationService({
      beginToolApproval: async () => ({}) as never,
      resumeApprovedTool: async () => ({}),
      rejectToolApproval: async () => ({}) as never,
      invokeTool: async () => {
        await gate;
        status = { ...status, status: 'succeeded', settledAt: '2024-08-28T00:00:01.000Z' };
        return { ok: true };
      },
      invokeService: async () => ({}),
      status: () => status,
      cancel,
    });
    const subscriber = new AbortController();
    const frames = plane.invokeToolFrames(
      principal,
      {
        version: 1,
        requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
        operationId,
        toolName: 'get_selection',
        rawArgs: {},
        targetSelector: { kind: 'active' },
      },
      NO_CAPTURE_OPTIONS,
      subscriber.signal,
    );
    const iterator = frames[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'accepted', operationId },
    });
    const waiting = iterator.next();
    subscriber.abort(Object.assign(new Error('follower disconnected'), { code: 'DISCONNECTED' }));
    await expect(waiting).rejects.toMatchObject({ code: 'DISCONNECTED' });
    expect(cancel).not.toHaveBeenCalled();
    await expect(plane.drainInvocationStreams(Date.now())).resolves.toBe(true);
    release();
    await vi.waitFor(() => expect(status).toMatchObject({ status: 'succeeded' }));
  });
});
