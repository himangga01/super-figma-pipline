import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createToolInvocationOptions,
  NO_CAPTURE_OPTIONS,
  OPERATION_EVIDENCE_LIMITS,
  type EgressManifestPort,
  type RuntimeExecutionScope,
} from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EgressManifestStore } from '../../src/execution/egress-manifest-store.js';
import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import { OperationEvidenceReceiptStore } from '../../src/execution/operation-evidence-receipt-store.js';
import {
  DurableOperationFinalizer,
  OperationExecutor,
  recoverDurableOperationState,
  type OperationJournalPort,
} from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { createOutputEgressManifest } from '../../src/policy/egress-policy.js';
import { ToolInvocationService } from '../../src/tool-invocation-service.js';
import {
  createBoundRuntimeRegistry,
  type PinnedPluginRuntimePort,
} from '../../src/tools/runtime-registry.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const actorId = 'actor1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const authSessionId = 'auth1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const;
const fixedNow = 1_724_803_200_000;
const daemonGenerationHash = (generation: string) =>
  `sha256:${createHash('sha256')
    .update('sfp-daemon-generation-v1', 'utf8')
    .update(Buffer.from([0]))
    .update(generation, 'utf8')
    .digest('hex')}` as const;
const scope = (consentId: string | null = null): RuntimeExecutionScope =>
  Object.freeze({
    requestId: 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA',
    leaderGeneration: 'generation-1',
    actor: Object.freeze({ actorId, authSessionId, entryPath: 'mcp-direct' as const }),
    workspace: Object.freeze({ workspaceId: null, workspaceRoot: null }),
    target: Object.freeze({
      sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
      pluginGeneration: 'plugin-g1',
      fileIdentity: Object.freeze({ kind: 'figma-file-key' as const, value: 'file-a' }),
      fileExecutionKey: 'figma:file-a' as const,
    }),
    consent: Object.freeze(
      consentId === null
        ? {
            mode: 'local-trusted' as const,
            consentId: null,
            allowedClasses: [
              'public',
              'project-code',
              'design-text',
              'design-image',
              'secret',
            ] as const,
          }
        : {
            mode: 'external-model' as const,
            consentId,
            allowedClasses: ['public', 'design-text', 'design-image'] as const,
          },
    ),
  });

const createRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfp-executor-'));
  roots.push(root);
  return root;
};

describe('idempotent journaled operation executor', () => {
  it('shares one in-flight promise, rejects mismatched args, and never replays after restart', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 7));
    const operationId = issuer.issue(actorId, fixedNow, { nonce: 'AAAAAAAAAAAAAAAAAAAAAA' });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await journal.recover();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => {
      await gate;
      return { ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' };
    });
    const runtimes = createBoundRuntimeRegistry(
      { execute: runtime },
      { execute: async () => ({}) },
    );
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes,
      now: () => fixedNow,
    });

    const first = executor.invokeTool(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      NO_CAPTURE_OPTIONS,
    );
    const duplicate = executor.invokeTool(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      NO_CAPTURE_OPTIONS,
    );
    await expect(
      executor.invokeTool(
        scope(),
        'create_text',
        { characters: 'B' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
    await vi.waitFor(() => {
      expect(executor.status(actorId, operationId)).toMatchObject({
        status: 'dispatched',
        pluginGeneration: null,
        targetBindingHash: expect.stringMatching(/^sha256:/),
        origin: { kind: 'entry' },
      });
    });
    release();
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' },
      { ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' },
    ]);
    expect(runtime).toHaveBeenCalledOnce();
    expect(executor.status(actorId, operationId)).toMatchObject({
      status: 'succeeded',
      origin: { kind: 'entry' },
    });

    const restartedJournal = new OperationJournal({
      stateRoot: root,
      actorId,
      now: () => fixedNow + 1,
    });
    await restartedJournal.recover();
    const restartedRuntime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({
      ok: true,
    }));
    const restarted = new OperationExecutor({
      issuer,
      journal: restartedJournal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry(
        { execute: restartedRuntime },
        { execute: async () => ({}) },
      ),
      now: () => fixedNow + 1,
    });
    await expect(
      restarted.invokeTool(
        scope(),
        'create_text',
        { characters: 'A' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED', resultHash: expect.any(String) });
    expect(restartedRuntime).not.toHaveBeenCalled();
  });

  it('awaits the dispatched fsync before the first pinned runtime side effect', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 8));
    const operationId = issuer.issue(actorId, fixedNow, { nonce: 'AQAAAAAAAAAAAAAAAAAAAA' });
    const durable = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await durable.recover();
    const events: string[] = [];
    const journal: OperationJournalPort = {
      appendInitial: (...args) => durable.appendInitial(...args),
      get: id => durable.get(id),
      transition: async (id, status, patch) => {
        events.push(`${status}-append`);
        const result = await durable.transition(id, status, patch);
        events.push(`${status}-fsynced`);
        return result;
      },
    };
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => {
      events.push('runtime');
      return { ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' };
    });
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow,
    });

    await executor.invokeTool(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      NO_CAPTURE_OPTIONS,
    );
    expect(events.indexOf('dispatched-fsynced')).toBeLessThan(events.indexOf('runtime'));
  });

  it('fsyncs pending approval with its ID before wait and resumes the same operation when approved', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 13));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'BgAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await journal.recover();
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({
      ok: true,
      nodeId: '1:2',
      name: 'Text',
      type: 'TEXT',
    }));
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow,
    });

    const handle = await executor.beginToolApproval(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
      NO_CAPTURE_OPTIONS,
    );
    expect(journal.get(operationId)).toMatchObject({
      status: 'pending-approval',
      approvalId: 'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
      sequence: 1,
    });
    expect(runtime).not.toHaveBeenCalled();
    await expect(
      executor.invokeTool(
        scope(),
        'create_text',
        { characters: 'A' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_IN_PROGRESS', status: 'pending-approval' });

    await expect(executor.resumeApprovedTool(handle, scope())).resolves.toMatchObject({ ok: true });
    expect(journal.get(operationId)).toMatchObject({ status: 'succeeded' });
    expect(runtime).toHaveBeenCalledOnce();
  });

  it.each(['APPROVAL_REJECTED', 'APPROVAL_EXPIRED'] as const)(
    'durably settles %s before egress with runtime zero',
    async errorCode => {
      const root = await createRoot();
      const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 14));
      const operationId = issuer.issue(actorId, fixedNow, {
        nonce:
          errorCode === 'APPROVAL_REJECTED' ? 'BwAAAAAAAAAAAAAAAAAAAA' : 'CAAAAAAAAAAAAAAAAAAAAA',
      });
      const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
      await journal.recover();
      const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({}));
      const executor = new OperationExecutor({
        issuer,
        journal,
        queue: new FileExecutionQueue(),
        runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
        now: () => fixedNow,
      });
      const handle = await executor.beginToolApproval(
        scope(),
        'create_text',
        { characters: 'A' },
        operationId,
        'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
        NO_CAPTURE_OPTIONS,
      );

      await executor.rejectToolApproval(handle, errorCode);
      expect(journal.get(operationId)).toMatchObject({
        status: 'pre-egress-rejected',
      });
      expect(runtime).not.toHaveBeenCalled();

      const restarted = new OperationJournal({
        stateRoot: root,
        actorId,
        now: () => fixedNow + 1,
      });
      await restarted.recover();
      expect(restarted.get(operationId)).toMatchObject({
        status: 'pre-egress-rejected',
      });
    },
  );

  it('settles outcome-unknown and never reruns after runtime succeeds but terminal durability fails', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 9));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'AgAAAAAAAAAAAAAAAAAAAA',
    });
    const durable = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await durable.recover();
    const journal: OperationJournalPort = {
      appendInitial: (...args) => durable.appendInitial(...args),
      get: id => durable.get(id),
      transition: async (id, status, patch) => {
        if (status === 'succeeded') {
          throw Object.assign(new Error('terminal fsync failed'), { code: 'FSYNC_FAILED' });
        }
        return durable.transition(id, status, patch);
      },
    };
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({
      ok: true,
      nodeId: '1:2',
      name: 'Text',
      type: 'TEXT',
    }));
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow,
    });

    await expect(
      executor.invokeTool(
        scope(),
        'create_text',
        { characters: 'A' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toThrow('terminal fsync failed');
    expect(executor.status(actorId, operationId)).toMatchObject({
      status: 'outcome-unknown',
      errorCode: 'OPERATION_TERMINAL_DURABILITY_FAILED',
      resultHash: null,
      resultBytes: null,
    });
    await expect(
      executor.invokeTool(
        scope(),
        'create_text',
        { characters: 'A' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED', status: 'outcome-unknown' });
    expect(runtime).toHaveBeenCalledOnce();
  });

  it('rejects a forged or cross-operation capture capability before journal and runtime', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 11));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'BAAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await journal.recover();
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({
      ok: true,
      nodeId: '1:2',
      name: 'Text',
      type: 'TEXT',
    }));
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow,
    });

    await expect(
      executor.invokeTool(scope(), 'create_text', { characters: 'A' }, operationId, {
        captureIntent: {
          captureResult: true,
          relativePath: '.sfp/operation-evidence/forged/result.v1.json',
        },
      } as never),
    ).rejects.toMatchObject({ code: 'CAPTURE_INTENT_INVALID' });
    expect(journal.get(operationId)).toBeUndefined();
    expect(runtime).not.toHaveBeenCalled();
  });

  it('rejects a capture capability reused for the same operation in another workspace', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 12));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'BQAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await journal.recover();
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({
      pageId: '1:1',
      pageName: 'Page',
      nodes: [],
    }));
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow,
    });
    const workspaceA = '123e4567-e89b-42d3-a456-426614174000';
    const workspaceB = '223e4567-e89b-42d3-a456-426614174000';
    const options = createToolInvocationOptions(true, operationId, workspaceA);
    const otherWorkspaceScope = Object.freeze({
      ...scope('consent-1'),
      workspace: Object.freeze({ workspaceId: workspaceB, workspaceRoot: root }),
    }) as RuntimeExecutionScope;

    await expect(
      executor.invokeTool(otherWorkspaceScope, 'get_selection', {}, operationId, options),
    ).rejects.toMatchObject({ code: 'CAPTURE_INTENT_INVALID' });
    expect(journal.get(operationId)).toBeUndefined();
    expect(runtime).not.toHaveBeenCalled();
  });

  it('exposes the one tool invocation service and keeps service operations closed at zero', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 10));
    const operationId = issuer.issue(actorId, fixedNow, { nonce: 'AwAAAAAAAAAAAAAAAAAAAA' });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await journal.recover();
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry(
        {
          execute: async () => ({ ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' }),
        },
        { execute: async () => ({}) },
      ),
      now: () => fixedNow,
    });
    const service = new ToolInvocationService(executor);

    await expect(
      service.invokeTool(
        scope(),
        'create_text',
        { characters: 'A' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).resolves.toMatchObject({ ok: true, nodeId: '1:2' });
    expect(service.status(actorId, operationId)).toMatchObject({ status: 'succeeded' });
    await expect(service.invokeService(scope(), 'snapshot.capture', {})).rejects.toMatchObject({
      code: 'SERVICE_OPERATION_NOT_FOUND',
    });
  });

  it('creates cancellation state before approval and durably cancels pending work without runtime', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 21));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'CQAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({ ok: true }));
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow,
    });
    await executor.beginToolApproval(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      'sfp_ap1_AAAAAAAAAAAAAAAAAAAAAA',
      NO_CAPTURE_OPTIONS,
    );

    await executor.cancel(scope().actor, {
      version: 1,
      requestId: scope().requestId,
      operationId,
    });

    expect(journal.get(operationId)).toMatchObject({
      status: 'pre-egress-rejected',
      errorCode: 'OPERATION_CANCELLED',
    });
    expect(runtime).not.toHaveBeenCalled();
  });

  it('propagates dispatched cancel to runtime but settles unknown when a late plugin result may mutate', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 22));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'CgAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    let observedSignal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(
      async (_scope, _tool, _args, signal) => {
        observedSignal = signal;
        await gate;
        return { ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' };
      },
    );
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow,
    });
    const invocation = executor.invokeTool(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      NO_CAPTURE_OPTIONS,
    );
    await vi.waitFor(() =>
      expect(journal.get(operationId)).toMatchObject({ status: 'dispatched' }),
    );
    await executor.cancel(scope().actor, {
      version: 1,
      requestId: scope().requestId,
      operationId,
    });
    expect(observedSignal?.aborted).toBe(true);
    release();

    await expect(invocation).rejects.toMatchObject({ code: 'OPERATION_OUTCOME_UNKNOWN' });
    expect(journal.get(operationId)).toMatchObject({
      status: 'outcome-unknown',
      errorCode: 'OPERATION_CANCELLED_AFTER_DISPATCH',
    });
    expect(runtime).toHaveBeenCalledOnce();
  });

  it('reserves pre/output/evidence before queued fsync and emits terminal only after receipt/finalizer/terminal fsync', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 23));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'CwAAAAAAAAAAAAAAAAAAAA',
    });
    const durable = new OperationJournal({ stateRoot: root, actorId });
    await durable.recover();
    const events: string[] = [];
    const journal: OperationJournalPort = {
      appendInitial: async (...args) => {
        const row = await durable.appendInitial(...args);
        events.push('queued-fsync');
        return row;
      },
      transition: async (id, status, patch, options) => {
        const row = await durable.transition(id, status, patch, options);
        events.push(status === 'dispatched' ? 'dispatched-fsync' : 'terminal-fsync');
        return row;
      },
      get: id => durable.get(id),
    };
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => {
      events.push('runtime');
      return { ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' };
    });
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      durability: {
        egress: {
          reservePre: async (boundActorId, requestId, boundOperationId, manifest) => {
            events.push('pre-manifest-fsync');
            return {
              actorId: boundActorId,
              requestId,
              operationId: boundOperationId,
              leaderGeneration: 'generation-1',
              preManifestHash: manifest.manifestHash,
              reservedOutputBytes: 65_536,
            };
          },
          finalize: async (_reservation, manifest) => {
            events.push('finalizer-fsync');
            return { finalManifestHash: manifest.manifestHash, finalized: true };
          },
          readVerifiedFinalizer: async () => null,
          recover: async () => undefined,
          flush: async () => undefined,
        },
        receipts: {
          reserveBeforeRuntime: async () => {
            events.push('evidence-reserve');
            return { reservationId: 'reservation-1', reservedBytes: 65_536 };
          },
          prepareAndFsync: async (_reservationId, receipt) => {
            events.push('receipt-fsync');
            return {
              ...receipt,
              previousReceiptHash: null,
              contentHash: `sha256:${'8'.repeat(64)}`,
              receiptHash: `sha256:${'9'.repeat(64)}`,
            } as never;
          },
          get: async () => null,
          recover: async () => undefined,
          releaseWithoutReceipt: async () => undefined,
          abortAfterDurableUnknown: async () => undefined,
        },
        artifacts: { createNew: vi.fn<() => never>() },
        projector: {
          project: () => ({
            contextHash: `sha256:${'7'.repeat(64)}` as never,
            kind: 'no-artifact',
            reasonCode: 'not-native-evidence',
          }),
        },
        nativeArtifacts: { createNativeManifest: vi.fn<() => never>() },
      },
      now: () => fixedNow,
    });

    await executor.invokeTool(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      NO_CAPTURE_OPTIONS,
    );

    expect(events).toEqual([
      'pre-manifest-fsync',
      'evidence-reserve',
      'queued-fsync',
      'dispatched-fsync',
      'runtime',
      'receipt-fsync',
      'finalizer-fsync',
      'terminal-fsync',
    ]);
  });

  it('recovers repeated crashes after evidence reservation fsync without leaking capacity or rerunning', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 31));
    const crash = Object.assign(new Error('crash after evidence reservation fsync'), {
      code: 'INJECTED_PROCESS_CRASH',
    });
    const limits = {
      ...OPERATION_EVIDENCE_LIMITS,
      maxRowsPerActor: 3,
      maxBytesPerActor: OPERATION_EVIDENCE_LIMITS.reservationBytesPerOperation * 3,
    };
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({
      ok: true,
      nodeId: '1:2',
      name: 'Text',
      type: 'TEXT',
    }));
    const operationIds: string[] = [];

    const restart = async (now: number, afterTombstoneFsync?: () => Promise<void>) => {
      const journal = new OperationJournal({
        stateRoot: root,
        actorId,
        now: () => now,
        ...(afterTombstoneFsync === undefined ? {} : { afterTombstoneFsync }),
      });
      const egress = new EgressManifestStore({ stateRoot: root, actorId, now: () => now });
      const receipts = new OperationEvidenceReceiptStore({
        stateRoot: root,
        actorId,
        limits,
      });
      const finalizer = new DurableOperationFinalizer({
        artifacts: { createNew: vi.fn<() => never>() },
        receipts,
        egress,
        journal,
        emitTerminal: vi.fn<() => never>(),
      });
      const recovery = {
        actorId,
        now,
        egress,
        receipts,
        journal,
        finalizer,
        preRuntimeReservationRecovery: {
          hasResultArtifactSideEffect: async () => false,
          hasNativeArtifactSideEffect: async () => false,
        },
      } satisfies Parameters<typeof recoverDurableOperationState>[0] & {
        preRuntimeReservationRecovery: {
          hasResultArtifactSideEffect(workspaceId: string, operationId: string): Promise<boolean>;
          hasNativeArtifactSideEffect(workspaceId: string, operationId: string): Promise<boolean>;
        };
      };
      await recoverDurableOperationState(recovery);
      return { journal, egress, receipts };
    };
    const assertRecoveryCrash = async () => {
      const recoveryCrash = new Error('crash after recovered tombstone fsync');
      await expect(
        restart(fixedNow + 100, async () => {
          throw recoveryCrash;
        }),
      ).rejects.toBe(recoveryCrash);
    };

    for (let crashIndex = 0; crashIndex < 4; crashIndex += 1) {
      const authorities = await restart(fixedNow + crashIndex);
      const operationId = issuer.issue(actorId, fixedNow + crashIndex);
      operationIds.push(operationId);
      const durability = {
        egress: authorities.egress,
        receipts: authorities.receipts,
        artifacts: { createNew: vi.fn<() => never>() },
        projector: { project: vi.fn<() => never>() },
        nativeArtifacts: { createNativeManifest: vi.fn<() => never>() },
        afterEvidenceReservationFsync: async () => {
          throw crash;
        },
      };
      const executor = new OperationExecutor({
        issuer,
        journal: authorities.journal,
        queue: new FileExecutionQueue(),
        runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
        durability,
        now: () => fixedNow + crashIndex,
      });

      await expect(
        executor.invokeTool(
          scope(),
          'create_text',
          { characters: 'A' },
          operationId,
          NO_CAPTURE_OPTIONS,
        ),
      ).rejects.toBe(crash);
      expect(authorities.journal.get(operationId)).toBeUndefined();
      expect(runtime).not.toHaveBeenCalled();
      if (crashIndex === 0) {
        await assertRecoveryCrash();
      }
    }

    const recovered = await restart(fixedNow + 10);
    for (const operationId of operationIds) {
      const record = recovered.journal.get(operationId);
      expect(record).toMatchObject({
        status: 'rejected',
        errorCode: 'OPERATION_PRE_RUNTIME_CRASH_RECOVERED',
        operationEvidenceReceiptHash: null,
        finalEgressManifestHash: expect.stringMatching(/^sha256:/u),
      });
      if (record === undefined || !('finalEgressManifestHash' in record)) {
        throw new Error('recovered terminal journal record expected');
      }
      const egressState = await recovered.egress.classifyOperationState(actorId, operationId);
      expect(egressState.kind).toBe('final');
      const finalizer = await recovered.egress.readVerifiedFinalizer(
        actorId,
        operationId,
        record.finalEgressManifestHash,
      );
      expect(finalizer).toMatchObject({
        finalStatus: 'no-output',
        manifestHash: record.finalEgressManifestHash,
        preExecutionManifestHash:
          egressState.kind === 'absent' ? null : egressState.preExecutionManifestHash,
        resultHash: null,
      });
    }

    const capacityProbe = await recovered.receipts.reserveBeforeRuntime(
      actorId,
      issuer.issue(actorId, fixedNow + 20),
      1,
    );
    await recovered.receipts.releaseWithoutReceipt(capacityProbe.reservationId);

    const replayRuntime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({ ok: true }));
    const replayExecutor = new OperationExecutor({
      issuer,
      journal: recovered.journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry(
        { execute: replayRuntime },
        { execute: async () => ({}) },
      ),
      now: () => fixedNow + 20,
    });
    await expect(
      replayExecutor.invokeTool(
        scope(),
        'create_text',
        { characters: 'A' },
        operationIds[0]!,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED', status: 'rejected' });
    await expect(
      replayExecutor.invokeTool(
        scope(),
        'create_text',
        { characters: 'different' },
        operationIds[0]!,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
    expect(replayRuntime).not.toHaveBeenCalled();

    const secondRestart = await restart(fixedNow + 30);
    expect(secondRestart.journal.get(operationIds[0]!)).toMatchObject({
      status: 'rejected',
      finalEgressManifestHash: recovered.journal.get(operationIds[0]!)?.finalEgressManifestHash,
    });
    expect(runtime).not.toHaveBeenCalled();
  });

  it('preserves reservation-owned queued recovery across every pre-runtime fsync boundary', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 32));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'EAAAAAAAAAAAAAAAAAAAAA',
    });
    const reservationCrash = new Error('crash after evidence reservation fsync');
    const finalizerCrash = new Error('crash after recovered no-output finalizer fsync');
    const queuedCrash = new Error('crash after recovered queued fsync');
    const rejectedCrash = new Error('crash after recovered rejected fsync');
    const releaseCrash = new Error('crash after recovered reservation release fsync');
    const limits = {
      ...OPERATION_EVIDENCE_LIMITS,
      maxRowsPerActor: 1,
      maxBytesPerActor: OPERATION_EVIDENCE_LIMITS.reservationBytesPerOperation,
    };
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({
      ok: true,
      nodeId: '1:2',
      name: 'Text',
      type: 'TEXT',
    }));

    const restart = async (
      hooks: Readonly<{
        afterPreRuntimeFinalizerFsync?: () => Promise<void>;
        afterQueuedFsync?: () => Promise<void>;
        afterRejectedFsync?: () => Promise<void>;
        afterReservationReleaseFsync?: () => Promise<void>;
      }> = {},
    ) => {
      const journalOptions = {
        stateRoot: root,
        actorId,
        now: () => fixedNow,
        ...(hooks.afterQueuedFsync === undefined
          ? {}
          : { afterQueuedFsync: hooks.afterQueuedFsync }),
        ...(hooks.afterRejectedFsync === undefined
          ? {}
          : { afterTombstoneFsync: hooks.afterRejectedFsync }),
      } satisfies ConstructorParameters<typeof OperationJournal>[0];
      const journal = new OperationJournal(journalOptions);
      const egress = new EgressManifestStore({ stateRoot: root, actorId, now: () => fixedNow });
      const receiptOptions = {
        stateRoot: root,
        actorId,
        limits,
        ...(hooks.afterReservationReleaseFsync === undefined
          ? {}
          : { afterReservationReleaseFsync: hooks.afterReservationReleaseFsync }),
      } satisfies ConstructorParameters<typeof OperationEvidenceReceiptStore>[0];
      const receipts = new OperationEvidenceReceiptStore(receiptOptions);
      const finalizer = new DurableOperationFinalizer({
        artifacts: { createNew: vi.fn<() => never>() },
        receipts,
        egress,
        journal,
        emitTerminal: vi.fn<() => never>(),
      });
      await recoverDurableOperationState({
        actorId,
        now: fixedNow,
        egress,
        receipts,
        journal,
        finalizer,
        preRuntimeReservationRecovery: {
          hasResultArtifactSideEffect: async () => false,
          hasNativeArtifactSideEffect: async () => false,
          ...(hooks.afterPreRuntimeFinalizerFsync === undefined
            ? {}
            : { afterPreRuntimeFinalizerFsync: hooks.afterPreRuntimeFinalizerFsync }),
        },
      } satisfies Parameters<typeof recoverDurableOperationState>[0]);
      return { journal, egress, receipts };
    };

    const authorities = await restart();
    const executor = new OperationExecutor({
      issuer,
      journal: authorities.journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      durability: {
        egress: authorities.egress,
        receipts: authorities.receipts,
        artifacts: { createNew: vi.fn<() => never>() },
        projector: { project: vi.fn<() => never>() },
        nativeArtifacts: { createNativeManifest: vi.fn<() => never>() },
        afterEvidenceReservationFsync: async () => {
          throw reservationCrash;
        },
      },
      now: () => fixedNow,
    });

    await expect(
      executor.invokeTool(
        scope(),
        'create_text',
        { characters: 'A' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toBe(reservationCrash);
    expect(runtime).not.toHaveBeenCalled();

    await expect(
      restart({
        afterPreRuntimeFinalizerFsync: async () => {
          throw finalizerCrash;
        },
      }),
    ).rejects.toBe(finalizerCrash);
    expect(runtime).not.toHaveBeenCalled();

    await expect(
      restart({
        afterQueuedFsync: async () => {
          throw queuedCrash;
        },
      }),
    ).rejects.toBe(queuedCrash);
    expect(runtime).not.toHaveBeenCalled();

    await expect(
      restart({
        afterRejectedFsync: async () => {
          throw rejectedCrash;
        },
      }),
    ).rejects.toBe(rejectedCrash);
    expect(runtime).not.toHaveBeenCalled();

    await expect(
      restart({
        afterReservationReleaseFsync: async () => {
          throw releaseCrash;
        },
      }),
    ).rejects.toBe(releaseCrash);
    expect(runtime).not.toHaveBeenCalled();

    const recovered = await restart();
    const record = recovered.journal.get(operationId);
    expect(record).toMatchObject({
      status: 'rejected',
      errorCode: 'OPERATION_PRE_RUNTIME_CRASH_RECOVERED',
      operationEvidenceReceiptHash: null,
      finalEgressManifestHash: expect.stringMatching(/^sha256:/u),
    });
    if (record === undefined || !('finalEgressManifestHash' in record)) {
      throw new Error('recovered terminal journal record expected');
    }
    const egressState = await recovered.egress.classifyOperationState(actorId, operationId);
    expect(egressState.kind).toBe('final');
    const finalizer = await recovered.egress.readVerifiedFinalizer(
      actorId,
      operationId,
      record.finalEgressManifestHash,
    );
    expect(finalizer).toMatchObject({
      finalStatus: 'no-output',
      reasonCode: 'admission-rejected',
      manifestHash: record.finalEgressManifestHash,
      preExecutionManifestHash:
        egressState.kind === 'absent' ? null : egressState.preExecutionManifestHash,
      resultHash: null,
    });

    const capacityProbe = await recovered.receipts.reserveBeforeRuntime(
      actorId,
      issuer.issue(actorId, fixedNow + 1),
      1,
    );
    await recovered.receipts.releaseWithoutReceipt(capacityProbe.reservationId);

    const replayExecutor = new OperationExecutor({
      issuer,
      journal: recovered.journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow + 1,
    });
    await expect(
      replayExecutor.invokeTool(
        scope(),
        'create_text',
        { characters: 'A' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_ALREADY_SETTLED', status: 'rejected' });
    await expect(
      replayExecutor.invokeTool(
        scope(),
        'create_text',
        { characters: 'different' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });

    const secondRestart = await restart();
    expect(secondRestart.journal.get(operationId)).toMatchObject({
      status: 'rejected',
      finalEgressManifestHash: record.finalEgressManifestHash,
    });
    expect(runtime).not.toHaveBeenCalled();
  });

  it('passes one operation reporter into the real runtime execution path', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 24));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'DAAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId });
    await journal.recover();
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(
      async (_scope, _tool, _args, _signal, reporter) => {
        reporter?.report({ phase: 'plugin', completed: 1, total: 1, message: 'done' });
        return { ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' };
      },
    );
    const report = vi.fn<(event: unknown) => void>();
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow,
    });

    await executor.invokeTool(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      NO_CAPTURE_OPTIONS,
      { report, throwIfCancelled: () => undefined },
    );

    expect(report).toHaveBeenCalledWith({
      phase: 'plugin',
      completed: 1,
      total: 1,
      message: 'done',
    });
  });

  it('closes a durable pre-manifest and rejects without runtime when evidence reservation fails', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 25));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'DQAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await journal.recover();
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({ ok: true }));
    const finalize = vi.fn<EgressManifestPort['finalize']>(async (_reservation, manifest) => ({
      finalManifestHash: manifest.manifestHash,
      finalized: true as const,
    }));
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      durability: {
        egress: {
          reservePre: async (boundActorId, requestId, boundOperationId, manifest) => ({
            actorId: boundActorId,
            requestId,
            operationId: boundOperationId,
            leaderGeneration: 'generation-1',
            preManifestHash: manifest.manifestHash,
            reservedOutputBytes: 65_536,
          }),
          finalize,
          readVerifiedFinalizer: async () => null,
          recover: async () => undefined,
          flush: async () => undefined,
        },
        receipts: {
          reserveBeforeRuntime: async () => {
            throw Object.assign(new Error('receipt capacity'), {
              code: 'EVIDENCE_CAPACITY_EXCEEDED',
            });
          },
          prepareAndFsync: vi.fn<() => never>(),
          get: async () => null,
          recover: async () => undefined,
          releaseWithoutReceipt: async () => undefined,
          abortAfterDurableUnknown: async () => undefined,
        },
        artifacts: { createNew: vi.fn<() => never>() },
        projector: { project: vi.fn<() => never>() },
        nativeArtifacts: { createNativeManifest: vi.fn<() => never>() },
      },
      now: () => fixedNow,
    });

    await expect(
      executor.invokeTool(
        scope(),
        'create_text',
        { characters: 'A' },
        operationId,
        NO_CAPTURE_OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'EVIDENCE_CAPACITY_EXCEEDED' });
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({ operationId }),
      expect.objectContaining({ finalStatus: 'no-output', reasonCode: 'admission-rejected' }),
    );
    expect(journal.get(operationId)).toMatchObject({
      status: 'rejected',
      errorCode: 'EVIDENCE_CAPACITY_EXCEEDED',
      finalEgressManifestHash: expect.stringMatching(/^sha256:/),
      operationEvidenceReceiptHash: null,
    });
    expect(runtime).not.toHaveBeenCalled();
  });

  it('keeps artifact preflight failure outside the journal with exact null-link pre-egress semantics', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 26));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'DgAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await journal.recover();
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(async () => ({ ok: true }));
    const reservePre = vi.fn<EgressManifestPort['reservePre']>();
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      durability: {
        egress: {
          reservePre,
          finalize: vi.fn<EgressManifestPort['finalize']>(),
          readVerifiedFinalizer: async () => null,
          recover: async () => undefined,
          flush: async () => undefined,
        },
        receipts: {
          reserveBeforeRuntime: vi.fn<() => never>(),
          prepareAndFsync: vi.fn<() => never>(),
          get: async () => null,
          recover: async () => undefined,
          releaseWithoutReceipt: async () => undefined,
          abortAfterDurableUnknown: async () => undefined,
        },
        artifacts: {
          preflight: async () => {
            throw Object.assign(new Error('capture path rejected'), {
              code: 'EVIDENCE_ARTIFACT_PATH_INVALID',
            });
          },
          createNew: vi.fn<() => never>(),
        },
        projector: { project: vi.fn<() => never>() },
        nativeArtifacts: { createNativeManifest: vi.fn<() => never>() },
      },
      now: () => fixedNow,
    });

    await expect(
      executor.invokeTool(
        {
          ...scope(),
          workspace: { workspaceId: '123e4567-e89b-42d3-a456-426614174000', workspaceRoot: root },
        },
        'create_text',
        { characters: 'A' },
        operationId,
        createToolInvocationOptions(true, operationId, '123e4567-e89b-42d3-a456-426614174000'),
      ),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ARTIFACT_PATH_INVALID' });
    expect(journal.get(operationId)).toBeUndefined();
    expect(reservePre).not.toHaveBeenCalled();
    expect(runtime).not.toHaveBeenCalled();
  });

  it('aborts a dispatched generation and waits for its unknown settlement before demotion returns', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 27));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'DwAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    await journal.recover();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(
      async (_scope, _tool, _args, signal) => {
        observedSignal = signal;
        await gate;
        return { ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' };
      },
    );
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      now: () => fixedNow,
    });
    const invocation = executor.invokeTool(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      NO_CAPTURE_OPTIONS,
    );
    await vi.waitFor(() =>
      expect(journal.get(operationId)).toMatchObject({ status: 'dispatched' }),
    );

    const capability = await journal.fenceLeaderGeneration('generation-1');
    const demotion = executor.demoteGeneration('generation-1', capability);
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    release();
    await expect(demotion).resolves.toBeUndefined();
    await expect(invocation).rejects.toMatchObject({ code: 'OPERATION_OUTCOME_UNKNOWN' });
    expect(journal.get(operationId)).toMatchObject({ status: 'outcome-unknown' });
  });

  it('links an already durable output finalizer during fencing instead of writing a conflicting unknown', async () => {
    const root = await createRoot();
    const issuer = operationIdIssuerFromKey(Buffer.alloc(32, 28));
    const operationId = issuer.issue(actorId, fixedNow, {
      nonce: 'EAAAAAAAAAAAAAAAAAAAAA',
    });
    const journal = new OperationJournal({ stateRoot: root, actorId, now: () => fixedNow });
    const egressStore = new EgressManifestStore({ stateRoot: root, actorId });
    const receiptStore = new OperationEvidenceReceiptStore({ stateRoot: root, actorId });
    await Promise.all([journal.recover(), egressStore.recover(fixedNow), receiptStore.recover()]);
    let egressReservation!: Awaited<ReturnType<EgressManifestPort['reservePre']>>;
    let evidenceReservationId = '';
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const runtime = vi.fn<PinnedPluginRuntimePort['execute']>(
      async (_scope, _tool, _args, signal) => {
        await gate;
        signal.throwIfAborted();
        return { ok: true, nodeId: '1:2', name: 'Text', type: 'TEXT' };
      },
    );
    const executor = new OperationExecutor({
      issuer,
      journal,
      queue: new FileExecutionQueue(),
      runtimes: createBoundRuntimeRegistry({ execute: runtime }, { execute: async () => ({}) }),
      durability: {
        egress: {
          reservePre: async (...args) => {
            egressReservation = await egressStore.reservePre(...args);
            return egressReservation;
          },
          finalize: (...args) => egressStore.finalize(...args),
          readVerifiedFinalizer: (...args) => egressStore.readVerifiedFinalizer(...args),
          recover: now => egressStore.recover(now),
          flush: () => egressStore.flush(),
        },
        receipts: {
          reserveBeforeRuntime: async (...args) => {
            const reservation = await receiptStore.reserveBeforeRuntime(...args);
            evidenceReservationId = reservation.reservationId;
            return reservation;
          },
          prepareAndFsync: (...args) => receiptStore.prepareAndFsync(...args),
          get: (...args) => receiptStore.get(...args),
          recover: () => receiptStore.recover(),
          releaseWithoutReceipt: id => receiptStore.releaseWithoutReceipt(id),
          abortAfterDurableUnknown: id => receiptStore.abortAfterDurableUnknown(id),
        },
        artifacts: { createNew: vi.fn<() => never>() },
        projector: {
          project: () => ({
            contextHash: `sha256:${'7'.repeat(64)}` as never,
            kind: 'no-artifact',
            reasonCode: 'not-native-evidence',
          }),
        },
        nativeArtifacts: { createNativeManifest: vi.fn<() => never>() },
      },
      now: () => fixedNow,
    });
    const invocation = executor.invokeTool(
      scope(),
      'create_text',
      { characters: 'A' },
      operationId,
      NO_CAPTURE_OPTIONS,
    );
    await vi.waitFor(() =>
      expect(journal.get(operationId)).toMatchObject({ status: 'dispatched' }),
    );
    const record = journal.get(operationId)!;
    if (!('sequence' in record)) throw new Error('active dispatched record expected');
    const resultHash = `sha256:${'e'.repeat(64)}` as const;
    const output = createOutputEgressManifest({
      preExecutionManifestHash: egressReservation.preManifestHash,
      resultClasses: ['design-text'],
      outputBytes: 2,
      outputTokens: 1,
      redactedFieldCount: 0,
      resultHash,
      resultBytes: 2,
      payloadHash: resultHash,
    });
    await receiptStore.prepareAndFsync(evidenceReservationId, {
      schemaVersion: 1,
      state: 'prepared',
      actorId,
      operationId,
      operationKind: record.operationKind,
      operationName: record.operationName,
      argsHash: record.argsHash,
      workspaceId: record.workspaceId,
      fileExecutionKeyHash: record.fileExecutionKeyHash,
      targetBindingHash: record.targetBindingHash,
      captureIntentHash: record.captureIntentHash,
      captureResult: false,
      finalizerHash: output.manifestHash,
      daemonGenerationHash: daemonGenerationHash('generation-1'),
      completedAt: new Date(fixedNow).toISOString(),
      terminalStatus: 'succeeded',
      resultHash,
      resultBytes: 2,
      resultArtifact: null,
      nativeEvidence: { kind: 'no-artifact', reasonCode: 'not-native-evidence' },
    } as never);
    await egressStore.finalize(egressReservation, output);
    const capability = await journal.fenceLeaderGeneration('generation-1');
    const demotion = executor.demoteGeneration('generation-1', capability);
    await vi.waitFor(() => expect(journal.get(operationId)).toMatchObject({ status: 'succeeded' }));
    release();

    await expect(demotion).resolves.toBeUndefined();
    await invocation.catch(() => undefined);
    expect(journal.get(operationId)).toMatchObject({
      status: 'succeeded',
      resultHash,
      finalEgressManifestHash: output.manifestHash,
      operationEvidenceReceiptHash: expect.stringMatching(/^sha256:/u),
    });
  });
});
