import { parseInvocationRequest, type InvocationRequestV1, type ToolName } from '@sfp/shared';

import { operationPolicyFor } from '../policy/operation-policy.js';
import { ALL_TOOL_SPECS } from '../tools/registry.js';

export class McpInvocationAdapterError extends Error {
  constructor(
    readonly code: 'MCP_META_CONTEXT_FORBIDDEN' | 'INVOCATION_ARGS_INVALID' | 'TOOL_NOT_FOUND',
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'McpInvocationAdapterError';
  }
}

const forbiddenMetaKeys = new Set([
  'actor',
  'targetSelector',
  'workspaceId',
  'workspaceRoot',
  'resolvedPaths',
  'actorId',
  'authSessionId',
  'principal',
  'mode',
  'allowedClasses',
  'target',
  'FileIdentity',
  'fileIdentity',
  'fileExecutionKey',
  'pluginGeneration',
  'leaderGeneration',
  'entryPath',
  'editorType',
  'capabilities',
  'runtimeScope',
  'consent',
]);

export class McpInvocationAdapter {
  constructor(
    private readonly options: {
      role: 'leader' | 'follower';
      resolveWorkspaceId(): Promise<string | null>;
      createRequestId(): `sfp_req1_${string}`;
    },
  ) {}

  async fromToolCall(
    toolName: string,
    rawArgs: unknown,
    meta: unknown,
  ): Promise<InvocationRequestV1> {
    if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
      const forged = Object.keys(meta).find(key => forbiddenMetaKeys.has(key));
      if (forged !== undefined) {
        throw new McpInvocationAdapterError(
          'MCP_META_CONTEXT_FORBIDDEN',
          `MCP metadata cannot supply ${forged}`,
        );
      }
    }
    const spec = ALL_TOOL_SPECS.find(candidate => candidate.name === toolName);
    if (spec === undefined) {
      throw new McpInvocationAdapterError('TOOL_NOT_FOUND', `unknown tool: ${toolName}`);
    }
    if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
      const declared = new Set(Object.keys(spec.inputSchema.shape));
      const unknown = Object.keys(rawArgs).find(key => !declared.has(key));
      if (unknown !== undefined) {
        throw new McpInvocationAdapterError(
          'INVOCATION_ARGS_INVALID',
          `${toolName} arguments contain unknown key ${unknown}`,
        );
      }
    }
    const parsed = spec.inputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw new McpInvocationAdapterError(
        'INVOCATION_ARGS_INVALID',
        `${toolName} arguments do not match the closed schema`,
        { cause: parsed.error },
      );
    }
    const requirement = spec.targetRequirementFor(parsed.data);
    const targetSelector = {
      kind:
        toolName === 'portal_plan' || toolName === 'portal_validate'
          ? 'portal-source'
          : requirement === 'required'
            ? 'active'
            : 'none',
    } as const;
    const policy = operationPolicyFor(toolName);
    const needsWorkspace = policy.possibleEffects.some(
      effect => effect.type === 'filesystem-read' || effect.type === 'filesystem-write',
    );
    const workspaceId = needsWorkspace ? await this.options.resolveWorkspaceId() : null;
    return parseInvocationRequest({
      version: 1,
      requestId: this.options.createRequestId(),
      toolName: toolName as ToolName,
      rawArgs: parsed.data,
      workspaceId,
      targetSelector,
    });
  }
}
