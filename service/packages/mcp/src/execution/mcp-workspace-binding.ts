import type { McpSessionId, McpWorkspaceBinding, WorkspaceConfigStore } from '@sfp/shared';

export class McpWorkspaceBindingError extends Error {
  constructor(
    readonly code:
      | 'MCP_WORKSPACE_REQUIRED'
      | 'MCP_WORKSPACE_AMBIGUOUS'
      | 'MCP_WORKSPACE_DEFAULT_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'McpWorkspaceBindingError';
  }
}

export const createMcpWorkspaceBinding = (
  store: Pick<WorkspaceConfigStore, 'list' | 'getDefault'>,
): McpWorkspaceBinding =>
  Object.freeze({
    resolveRequiredForMcpSession: async (_mcpSession: McpSessionId): Promise<string> => {
      const [workspaces, defaultWorkspaceId] = await Promise.all([
        store.list(),
        store.getDefault(),
      ]);
      if (defaultWorkspaceId !== null) {
        if (!workspaces.some(workspace => workspace.workspaceId === defaultWorkspaceId)) {
          throw new McpWorkspaceBindingError(
            'MCP_WORKSPACE_DEFAULT_INVALID',
            'configured MCP workspace default is stale',
          );
        }
        return defaultWorkspaceId;
      }
      if (workspaces.length === 0) {
        throw new McpWorkspaceBindingError(
          'MCP_WORKSPACE_REQUIRED',
          'MCP filesystem tools require an approved workspace',
        );
      }
      if (workspaces.length !== 1) {
        throw new McpWorkspaceBindingError(
          'MCP_WORKSPACE_AMBIGUOUS',
          'multiple approved workspaces require an explicit default',
        );
      }
      return workspaces[0]!.workspaceId;
    },
  });
