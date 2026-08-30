import type {
  ActorContext,
  OperationInvocationService,
  OperationRecord,
  OperationTombstone,
  ResolvedInvocationScope,
  RuntimeExecutionScope,
  ServiceOperationName,
  ToolInvocationOptionsV1,
  ToolApprovalHandle,
  ToolName,
} from '@sfp/shared';

import type { OperationExecutor } from './execution/operation-executor.js';

export class ToolInvocationService implements OperationInvocationService {
  constructor(private readonly executor: OperationExecutor) {}

  beginToolApproval(
    scope: ResolvedInvocationScope,
    toolName: ToolName,
    rawArgs: unknown,
    operationId: string,
    approvalId: string,
    options?: Readonly<ToolInvocationOptionsV1>,
  ): Promise<ToolApprovalHandle> {
    return this.executor.beginToolApproval(
      scope,
      toolName,
      rawArgs,
      operationId,
      approvalId,
      options,
    );
  }

  resumeApprovedTool(handle: ToolApprovalHandle, scope: RuntimeExecutionScope): Promise<unknown> {
    return this.executor.resumeApprovedTool(handle, scope);
  }

  rejectToolApproval(handle: ToolApprovalHandle, errorCode: string): Promise<OperationRecord> {
    return this.executor.rejectToolApproval(handle, errorCode);
  }

  invokeTool(
    scope: RuntimeExecutionScope,
    toolName: ToolName,
    rawArgs: unknown,
    operationId?: string,
    options?: Readonly<ToolInvocationOptionsV1>,
  ): Promise<unknown> {
    return this.executor.invokeTool(scope, toolName, rawArgs, operationId, options);
  }

  invokeService(
    _scope: RuntimeExecutionScope,
    _operationName: ServiceOperationName,
    _rawArgs: unknown,
    _operationId?: string,
  ): Promise<unknown> {
    return Promise.reject(
      Object.assign(new Error('service operation missing'), {
        code: 'SERVICE_OPERATION_NOT_FOUND',
      }),
    );
  }

  status(
    actorId: ActorContext['actorId'],
    operationId: string,
  ): OperationRecord | OperationTombstone | undefined {
    return this.executor.status(actorId, operationId);
  }
}
