import type {
  OperationPolicy,
  ProgressReporter,
  ResultEgressPolicy,
  RuntimeExecutionScope,
  TargetRequirement,
  PluginTarget,
  WorkspaceInvocationContext,
  WorkspacePolicy,
  ResolvedWorkspacePath,
  ServerEvidenceWriteEffectV1,
} from '@sfp/shared';
import type { z } from 'zod';

/** Server-owned extensions share the executor; they never expand the advertised MCP tool registry. */
export interface ExecutableOperation {
  name: import('@sfp/shared').ServiceOperationName | import('@sfp/shared').SystemOperationName;
  operationKind: 'service' | 'system';
  inputSchema: z.ZodObject;
  resultSchema: z.ZodType;
  policy: OperationPolicy;
  egress: ResultEgressPolicy;
  targetRequirementFor(args: Readonly<Record<string, unknown>>): TargetRequirement;
  resolveScope?(input: {
    workspace: WorkspaceInvocationContext;
    target: PluginTarget;
    operationId: string;
    args: Readonly<Record<string, unknown>>;
    workspacePolicy: WorkspacePolicy;
  }): Promise<{
    resolvedPaths: Readonly<Record<string, ResolvedWorkspacePath>>;
    evidenceWrites: readonly ServerEvidenceWriteEffectV1[];
  }>;
  execute(
    scope: RuntimeExecutionScope,
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    reporter?: ProgressReporter,
    action?: { operationId: string; actionNonce: string },
  ): Promise<unknown>;
}
export type ExecutableOperations = Readonly<Record<string, ExecutableOperation>>;
