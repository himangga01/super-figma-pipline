import { describe, expect, it, vi } from 'vitest';

import { McpInvocationAdapter } from '../../src/execution/mcp-invocation-adapter.js';

const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
const requestId = 'sfp_req1_AAAAAAAAAAAAAAAAAAAAAA' as const;

const adapter = (
  role: 'leader' | 'follower',
  resolveWorkspaceId: () => Promise<string | null> = async () => workspaceId,
) =>
  new McpInvocationAdapter({
    role,
    resolveWorkspaceId,
    createRequestId: () => requestId,
  });

describe('MCP selector and workspace synthesis', () => {
  it.each([
    ['ping', {}, 'none', null],
    ['get_selection', {}, 'active', null],
    ['analyze_project', { rootDir: '.' }, 'none', workspaceId],
  ] as const)(
    'synthesizes %s after strict args parsing for both roles',
    async (tool, args, kind, workspace) => {
      for (const role of ['leader', 'follower'] as const) {
        const request = await adapter(role).fromToolCall(tool, args, {});
        expect(request.targetSelector).toEqual({ kind });
        expect(request.workspaceId ?? null).toBe(workspace);
        expect(request.rawArgs).toEqual(args);
      }
    },
  );

  it.each([
    'actor',
    'actorId',
    'authSessionId',
    'principal',
    'consent',
    'mode',
    'allowedClasses',
    'workspaceId',
    'workspaceRoot',
    'resolvedPaths',
    'target',
    'targetSelector',
    'FileIdentity',
    'fileIdentity',
    'fileExecutionKey',
    'pluginGeneration',
    'leaderGeneration',
    'entryPath',
    'editorType',
    'capabilities',
    'runtimeScope',
  ])('rejects forged MCP meta context key %s', async forbidden => {
    for (const role of ['leader', 'follower'] as const) {
      const resolveWorkspaceId = vi.fn<() => Promise<string | null>>(async () => workspaceId);
      await expect(
        adapter(role, resolveWorkspaceId).fromToolCall(
          'analyze_project',
          { rootDir: '.' },
          { [forbidden]: 'forged' },
        ),
      ).rejects.toMatchObject({ code: 'MCP_META_CONTEXT_FORBIDDEN' });
      expect(resolveWorkspaceId).not.toHaveBeenCalled();
    }
  });

  it('rejects invalid tool arguments before workspace or selector synthesis', async () => {
    await expect(
      adapter('leader').fromToolCall('analyze_project', { rootDir: '.', unexpected: true }, {}),
    ).rejects.toMatchObject({ code: 'INVOCATION_ARGS_INVALID' });
  });
});
