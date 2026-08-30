import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createToolInvocationOptions,
  NO_CAPTURE_OPTIONS,
  type RuntimeExecutionScope,
} from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileExecutionQueue } from '../../src/execution/file-queue.js';
import {
  OperationExecutor,
  type OperationJournalPort,
} from '../../src/execution/operation-executor.js';
import { operationIdIssuerFromKey } from '../../src/execution/operation-id.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
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
});
