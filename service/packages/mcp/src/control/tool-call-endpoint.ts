import {
  createToolInvocationOptions,
  NO_CAPTURE_OPTIONS,
  ToolCallControlEnvelopeV1Schema,
  type ActorContext,
  type InvocationRequestV1,
  type ToolInvocationOptionsV1,
} from '@sfp/shared';

export interface ControlToolPlane {
  invokeTool(
    principal: Readonly<ActorContext>,
    request: Readonly<InvocationRequestV1>,
    options: Readonly<ToolInvocationOptionsV1>,
  ): Promise<unknown>;
}

export const createToolCallEndpoint = (dependencies: {
  invokeTool?: ControlToolPlane['invokeTool'];
  plane?: ControlToolPlane;
  issueOperationId?(actorId: ActorContext['actorId']): string;
}) => {
  const invoke = dependencies.invokeTool ?? dependencies.plane?.invokeTool.bind(dependencies.plane);
  if (invoke === undefined) throw new Error('control tool endpoint requires an execution plane');
  return async (principal: Readonly<ActorContext>, input: unknown): Promise<unknown> => {
    const envelope = ToolCallControlEnvelopeV1Schema.parse(input);
    const operationId =
      envelope.invocation.operationId ?? dependencies.issueOperationId?.(principal.actorId);
    if (operationId === undefined) {
      throw Object.assign(new Error('control tool calls require a server-issued operation id'), {
        code: 'OPERATION_ID_REQUIRED',
      });
    }
    const invocation = Object.freeze({ ...envelope.invocation, operationId });
    const options = envelope.captureResult
      ? createToolInvocationOptions(true, operationId, invocation.workspaceId ?? null)
      : NO_CAPTURE_OPTIONS;
    return invoke(principal, invocation, options);
  };
};
