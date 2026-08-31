import type { ApprovalDecisionV1, ApprovalPromptV1, ResolvedInvocationScope } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApprovalEndpoints } from '../../src/control/approval-endpoints.js';
import { createApprovalBroker } from '../../src/policy/approval-broker.js';

const scope = Object.freeze({
  requestId: 'sfp_req1_AQAAAAAAAAAAAAAAAAAAAA',
  leaderGeneration: 'generation-1',
  actor: Object.freeze({
    actorId: `actor1_${'A'.repeat(43)}`,
    authSessionId: `auth1_${'B'.repeat(43)}`,
    entryPath: 'control',
  }),
  workspace: Object.freeze({ workspaceId: null, workspaceRoot: null }),
  target: Object.freeze({
    sessionId: null,
    pluginGeneration: null,
    fileIdentity: null,
    fileExecutionKey: null,
  }),
}) satisfies Readonly<ResolvedInvocationScope>;

describe('approval broker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes only at the durable wait point and lists only the origin control session', async () => {
    const delivered: ApprovalPromptV1[] = [];
    const broker = createApprovalBroker({
      now: () => 1_724_803_200_000,
      deliverPluginPrompt: async () => {},
      deliverControlPrompt: async prompt => {
        delivered.push(prompt);
      },
    });
    const pending = (await broker.request(scope, 'create_text', [{ type: 'figma-read' }], 'op'))!;
    const rotated = Object.freeze({
      ...scope.actor,
      authSessionId: `auth1_${'C'.repeat(43)}` as const,
    });
    const endpoints = createApprovalEndpoints({ broker, leaderGeneration: () => 'generation-1' });

    expect(broker.getPrompt(pending.approvalId)).toBeUndefined();
    await expect(endpoints.list(scope.actor)).resolves.toEqual([]);
    const waiting = pending.waitForDecision();
    await Promise.resolve();
    expect(broker.getPrompt(pending.approvalId)).toBeDefined();
    await expect(endpoints.list(scope.actor)).resolves.toHaveLength(1);
    await expect(endpoints.list(rotated)).resolves.toEqual([]);

    const prompt = delivered[0]!;
    await broker.settleControl(
      scope.actor,
      {
        version: 1,
        type: 'approval.decision',
        approvalId: prompt.approvalId,
        operationId: prompt.operationId,
        promptHash: prompt.promptHash,
        decision: 'rejected',
      },
      'generation-1',
    );
    await expect(waiting).resolves.toEqual({ decision: 'rejected' });
  });

  it('expires at the fixed deadline even when prompt delivery never settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_724_803_200_000);
    const broker = createApprovalBroker({
      deliverPluginPrompt: async () => {},
      deliverControlPrompt: () => new Promise<void>(() => {}),
    });
    const pending = (await broker.request(scope, 'create_text', [{ type: 'figma-read' }], 'op'))!;
    const waiting = pending.waitForDecision();

    await vi.advanceTimersByTimeAsync(120_000);
    const observed = await Promise.race([waiting, Promise.resolve('delivery-blocked' as const)]);

    expect(observed).toEqual({ decision: 'expired' });
    expect(broker.getBinding(pending.approvalId)?.state).toBe('expired');
  });

  it('binds a targeted owner-control approval to the exact paired session and plugin generation', async () => {
    const targetedScope = Object.freeze({
      ...scope,
      target: Object.freeze({
        sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
        pluginGeneration: 'plugin-1',
        fileIdentity: Object.freeze({ kind: 'figma-file-key' as const, value: 'file-key' }),
        fileExecutionKey: 'figma:file-key' as const,
      }),
    }) satisfies Readonly<ResolvedInvocationScope>;
    const broker = createApprovalBroker({
      now: () => 1_724_803_200_000,
      deliverPluginPrompt: async () => {},
      deliverControlPrompt: async () => {},
    });
    const pending = (await broker.request(
      targetedScope,
      'create_text',
      [{ type: 'figma-read' }],
      'op',
    ))!;
    void pending.waitForDecision();
    await Promise.resolve();

    expect(broker.getBinding(pending.approvalId)).toMatchObject({
      channel: 'owner-control-session',
      pairedSessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
      pluginGeneration: 'plugin-1',
      fileExecutionKey: 'figma:file-key',
    });
  });

  it('binds a raw-free prompt to the origin control auth session and settles once', async () => {
    const delivered: ApprovalPromptV1[] = [];
    const broker = createApprovalBroker({
      now: () => 1_724_803_200_000,
      randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index + 1),
      deliverPluginPrompt: async () => {
        throw new Error('wrong channel');
      },
      deliverControlPrompt: async prompt => {
        delivered.push(prompt);
      },
    });
    const pending = await broker.request(
      scope,
      'create_text',
      [{ type: 'figma-write', destructive: false, broad: false }],
      'operation-1',
    );
    expect(pending).not.toBeNull();
    const waiting = pending!.waitForDecision();
    await Promise.resolve();
    const prompt = delivered[0]!;
    expect(JSON.stringify(prompt)).not.toMatch(/controlToken|workspacePath|file-key/);
    const decision: ApprovalDecisionV1 = {
      version: 1,
      type: 'approval.decision',
      approvalId: prompt.approvalId,
      operationId: prompt.operationId,
      promptHash: prompt.promptHash,
      decision: 'approved',
    };
    await broker.settleControl(scope.actor, decision, 'generation-1');
    await expect(waiting).resolves.toMatchObject({ decision: 'approved' });
    await expect(broker.settleControl(scope.actor, decision, 'generation-1')).rejects.toMatchObject(
      {
        code: 'APPROVAL_ALREADY_SETTLED',
      },
    );
  });
});
