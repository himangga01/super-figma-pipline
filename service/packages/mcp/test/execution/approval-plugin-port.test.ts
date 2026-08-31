import type { ApprovalDecisionV1, ResolvedInvocationScope } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import { createApprovalBroker } from '../../src/policy/approval-broker.js';

const scope = Object.freeze({
  requestId: 'sfp_req1_AQAAAAAAAAAAAAAAAAAAAA',
  leaderGeneration: 'generation-1',
  actor: Object.freeze({
    actorId: `actor1_${'A'.repeat(43)}`,
    authSessionId: `auth1_${'B'.repeat(43)}`,
    entryPath: 'mcp-direct',
  }),
  workspace: Object.freeze({ workspaceId: null, workspaceRoot: null }),
  target: Object.freeze({
    sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
    pluginGeneration: 'plugin-1',
    fileIdentity: Object.freeze({ kind: 'figma-file-key', value: 'file-key' }),
    fileExecutionKey: 'figma:file-key',
  }),
}) satisfies Readonly<ResolvedInvocationScope>;

describe('paired approval delivery', () => {
  it('rejects a decision from the wrong paired session before resolving the waiter', async () => {
    let deliveredApprovalId = '';
    const broker = createApprovalBroker({
      now: () => 1_724_803_200_000,
      deliverControlPrompt: async () => {
        throw new Error('wrong channel');
      },
      deliverPluginPrompt: async prompt => {
        deliveredApprovalId = prompt.approvalId;
      },
    });
    const pending = (await broker.request(scope, 'create_text', [{ type: 'figma-read' }], 'op'))!;
    void pending.waitForDecision();
    await Promise.resolve();
    const prompt = broker.getPrompt(deliveredApprovalId)!;
    const decision: ApprovalDecisionV1 = {
      version: 1,
      type: 'approval.decision',
      approvalId: prompt.approvalId,
      operationId: prompt.operationId,
      promptHash: prompt.promptHash,
      decision: 'approved',
    };
    await expect(
      broker.settlePlugin(
        {
          pairedSessionId: '-____________________w',
          leaderGeneration: 'generation-1',
          pluginGeneration: 'plugin-1',
          fileExecutionKey: 'figma:file-key',
        },
        decision,
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_SESSION_MISMATCH' });
    expect(broker.getBinding(prompt.approvalId)?.state).toBe('pending');
  });
});
