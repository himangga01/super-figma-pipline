import { describe, expect, it } from 'vitest';

import { createMcpWorkspaceBinding } from '../../src/execution/mcp-workspace-binding.js';

const workspace = (workspaceId: string) => ({
  workspaceId,
  path: `C:\\${workspaceId}`,
  realPath: `C:\\${workspaceId}`,
  rootIdentityKey: `identity:${workspaceId}`,
  addedAt: '2026-08-31T00:00:00.000Z',
});

describe('MCP workspace binding', () => {
  it('never selects the first row when multiple workspaces have no explicit default', async () => {
    const rows = [
      workspace('123e4567-e89b-42d3-a456-426614174000'),
      workspace('123e4567-e89b-42d3-a456-426614174001'),
    ];
    const binding = createMcpWorkspaceBinding({
      list: async () => rows,
      getDefault: async () => null,
    });
    await expect(
      binding.resolveRequiredForMcpSession('mcp1_AQAAAAAAAAAAAAAAAAAAAA'),
    ).rejects.toMatchObject({
      code: 'MCP_WORKSPACE_AMBIGUOUS',
    });
  });

  it('uses a configured default and rejects a stale one', async () => {
    const row = workspace('123e4567-e89b-42d3-a456-426614174000');
    const valid = createMcpWorkspaceBinding({
      list: async () => [row],
      getDefault: async () => row.workspaceId,
    });
    await expect(valid.resolveRequiredForMcpSession('mcp1_AQAAAAAAAAAAAAAAAAAAAA')).resolves.toBe(
      row.workspaceId,
    );
    const stale = createMcpWorkspaceBinding({
      list: async () => [row],
      getDefault: async () => '123e4567-e89b-42d3-a456-426614174001',
    });
    await expect(
      stale.resolveRequiredForMcpSession('mcp1_AQAAAAAAAAAAAAAAAAAAAA'),
    ).rejects.toMatchObject({ code: 'MCP_WORKSPACE_DEFAULT_INVALID' });
  });
});
