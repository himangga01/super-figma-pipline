import type { ResolvedInvocationScope } from '@sfp/shared';
import { describe, expect, it } from 'vitest';

import { selectApprovalChannel } from '../../src/policy/approval-gate.js';

const baseScope = {
  requestId: 'sfp_req1_AQAAAAAAAAAAAAAAAAAAAA',
  leaderGeneration: 'generation-1',
  actor: {
    actorId: `actor1_${'A'.repeat(43)}`,
    authSessionId: `auth1_${'B'.repeat(43)}`,
    entryPath: 'mcp-direct',
  },
  workspace: { workspaceId: null, workspaceRoot: null },
  target: {
    sessionId: 'AQAAAAAAAAAAAAAAAAAAAA',
    pluginGeneration: 'plugin-1',
    fileIdentity: { kind: 'figma-file-key', value: 'file-key' },
    fileExecutionKey: 'figma:file-key',
  },
} satisfies ResolvedInvocationScope;

describe('approval routing matrix', () => {
  it('routes MCP plugin targets to the paired session and rejects MCP target-none approval', () => {
    expect(selectApprovalChannel(baseScope)).toBe('plugin-session');
    expect(
      selectApprovalChannel({
        ...baseScope,
        target: {
          sessionId: null,
          pluginGeneration: null,
          fileIdentity: null,
          fileExecutionKey: null,
        },
      }),
    ).toBeNull();
  });

  it('routes authenticated control to its origin auth session even with target none', () => {
    expect(
      selectApprovalChannel({
        ...baseScope,
        actor: { ...baseScope.actor, entryPath: 'control' },
        target: {
          sessionId: null,
          pluginGeneration: null,
          fileIdentity: null,
          fileExecutionKey: null,
        },
      }),
    ).toBe('owner-control-session');
  });
});
