import type {
  ActorContext,
  OperationInvocationService,
  OperationRecord,
  OperationTombstone,
  ProgressReporter,
  InvocationCancelV1,
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

  rejectToolBeforeEgress(
    scope: ResolvedInvocationScope,
    toolName: ToolName,
    rawArgs: unknown,
    operationId: string,
    errorCode: string,
    options?: Readonly<ToolInvocationOptionsV1>,
  ): Promise<OperationRecord> {
    return this.executor.rejectToolBeforeEgress(
      scope,
      toolName,
      rawArgs,
      operationId,
      errorCode,
      options,
    );
  }

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

  resumeApprovedTool(
    handle: ToolApprovalHandle,
    scope: RuntimeExecutionScope,
    reporter?: ProgressReporter,
  ): Promise<unknown> {
    return this.executor.resumeApprovedTool(handle, scope, reporter);
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
    reporter?: ProgressReporter,
  ): Promise<unknown> {
    return this.executor.invokeTool(scope, toolName, rawArgs, operationId, options, reporter);
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

  cancel(principal: Readonly<ActorContext>, request: Readonly<InvocationCancelV1>): Promise<void> {
    return this.executor.cancel(principal, request);
  }

  status(
    actorId: ActorContext['actorId'],
    operationId: string,
  ): OperationRecord | OperationTombstone | undefined {
    return this.executor.status(actorId, operationId);
  }
}
