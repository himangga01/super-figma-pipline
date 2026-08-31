import {
  ActionNonceClaimsSchema,
  ActionNonceIssueRequestV1Schema,
  ApprovalDecisionV1Schema,
  ApprovalPromptV1Schema,
  ControlStatusV1Schema,
  EgressConfigStatusV1Schema,
  EgressConfigureRequestV1Schema,
  InvocationCancelV1Schema,
  OperationRecordSchema,
  OperationTombstoneSchema,
  ToolCallControlEnvelopeV1Schema,
} from '@sfp/shared';
import { z } from 'zod';

import type { createActionNonceEndpoint } from './action-nonce-endpoints.js';
import type { createAdminAuditEndpoint } from './admin-audit-endpoints.js';
import type { createApprovalEndpoints } from './approval-endpoints.js';
import type { createEgressControl } from './egress-endpoints.js';
import type { createOperationEndpoints } from './operation-endpoints.js';
import { OperationListRequestSchema } from './operation-endpoints.js';
import type { AuthenticatedControlRouter } from './router.js';
import type { createToolCallEndpoint } from './tool-call-endpoint.js';
import type { createWorkspaceEndpoints } from './workspace-endpoints.js';

export type ReturnTypeOfActionNonceEndpoint = ReturnType<typeof createActionNonceEndpoint>;

export interface Task7ControlRoutes {
  status: () => Promise<unknown>;
  actionNonce: ReturnType<typeof createActionNonceEndpoint>;
  approvals: ReturnType<typeof createApprovalEndpoints>;
  toolCall: ReturnType<typeof createToolCallEndpoint>;
  workspaces: ReturnType<typeof createWorkspaceEndpoints>;
  operations: ReturnType<typeof createOperationEndpoints>;
  egress: ReturnType<typeof createEgressControl>;
  adminAudit: ReturnType<typeof createAdminAuditEndpoint>;
}

const EmptySchema = z.object({}).strict();
const WorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const NonceSchema = z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u);
const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);
const WorkspaceRootSchema = z
  .object({
    workspaceId: WorkspaceIdSchema,
    path: z.string().min(1).max(32_768),
    realPath: z.string().min(1).max(32_768),
    rootIdentityKey: z.string().min(1).max(1024).optional(),
    addedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const OperationProjectionSchema = z.union([OperationRecordSchema, OperationTombstoneSchema]);
const OperationListOutputSchema = z
  .object({
    rows: z.array(OperationProjectionSchema).max(1000).readonly(),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();
const AdminAuditQueryOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    chainVerified: z.literal(true),
    checkpointContentHash: HashSchema,
    anchorContentHash: HashSchema,
    rows: z.array(JsonValueSchema).max(1000).readonly(),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();

export const registerTask7ControlRoutes = (
  router: AuthenticatedControlRouter,
  endpoints: Task7ControlRoutes,
): void => {
  router.register({
    id: 'control.status',
    method: 'GET',
    path: '/control/status',
    routeClass: 'admin',
    inputSchema: EmptySchema,
    outputSchema: ControlStatusV1Schema,
    handle: async () => endpoints.status(),
  });
  router.register({
    id: 'action-nonce.issue',
    method: 'POST',
    path: '/control/action-nonces',
    routeClass: 'admin',
    inputSchema: ActionNonceIssueRequestV1Schema,
    outputSchema: ActionNonceClaimsSchema,
    handle: async (principal, input) => endpoints.actionNonce(principal, input),
  });
  router.register({
    id: 'approval.list',
    method: 'GET',
    path: '/control/approvals',
    routeClass: 'admin',
    inputSchema: EmptySchema,
    outputSchema: z.array(ApprovalPromptV1Schema).readonly(),
    handle: async principal => endpoints.approvals.list(principal),
  });
  router.register({
    id: 'approval.settle',
    method: 'POST',
    path: '/control/approvals/:approvalId',
    routeClass: 'admin',
    inputSchema: ApprovalDecisionV1Schema.extend({
      approvalId: ApprovalDecisionV1Schema.shape.approvalId,
    }).strict(),
    outputSchema: z.object({ ok: z.literal(true) }).strict(),
    handle: async (principal, input) => endpoints.approvals.settle(principal, input),
  });
  router.register({
    id: 'tool.call',
    method: 'POST',
    path: '/control/tools/call',
    routeClass: 'tool',
    inputSchema: ToolCallControlEnvelopeV1Schema,
    outputSchema: JsonValueSchema,
    handle: async (principal, input) => endpoints.toolCall(principal, input),
  });
  router.register({
    id: 'workspace.list',
    method: 'GET',
    path: '/control/workspaces',
    routeClass: 'admin',
    inputSchema: EmptySchema,
    outputSchema: z.array(WorkspaceRootSchema).readonly(),
    handle: async () => endpoints.workspaces.list(),
  });
  router.register({
    id: 'workspace.add',
    method: 'POST',
    path: '/control/workspaces',
    routeClass: 'admin',
    inputSchema: z.object({ path: z.string().min(1), actionNonce: NonceSchema }).strict(),
    outputSchema: WorkspaceRootSchema.required({ rootIdentityKey: true }),
    handle: async (principal, input) => endpoints.workspaces.add(principal, input),
  });
  router.register({
    id: 'workspace.remove',
    method: 'DELETE',
    path: '/control/workspaces/:workspaceId',
    routeClass: 'admin',
    inputSchema: z.object({ workspaceId: WorkspaceIdSchema, actionNonce: NonceSchema }).strict(),
    outputSchema: z.undefined(),
    handle: async (principal, input) => endpoints.workspaces.remove(principal, input),
  });
  router.register({
    id: 'workspace.set-default',
    method: 'POST',
    path: '/control/workspaces/default',
    routeClass: 'admin',
    inputSchema: z.object({ workspaceId: WorkspaceIdSchema, actionNonce: NonceSchema }).strict(),
    outputSchema: z.undefined(),
    handle: async (principal, input) => endpoints.workspaces.setDefault(principal, input),
  });
  router.register({
    id: 'workspace.clear-default',
    method: 'DELETE',
    path: '/control/workspaces/default',
    routeClass: 'admin',
    inputSchema: z.object({ actionNonce: NonceSchema }).strict(),
    outputSchema: z.undefined(),
    handle: async (principal, input) =>
      endpoints.workspaces.setDefault(principal, { ...input, workspaceId: null }),
  });
  router.register({
    id: 'operation.issue',
    method: 'POST',
    path: '/control/operations',
    routeClass: 'admin',
    inputSchema: EmptySchema,
    outputSchema: z.object({ operationId: z.string() }).strict(),
    handle: async principal => endpoints.operations.issue(principal),
  });
  router.register({
    id: 'operation.list',
    method: 'GET',
    path: '/control/operations',
    routeClass: 'admin',
    inputSchema: OperationListRequestSchema,
    outputSchema: OperationListOutputSchema,
    handle: async (principal, input) => endpoints.operations.list(principal, input),
  });
  router.register({
    id: 'operation.status',
    method: 'GET',
    path: '/control/operations/:operationId',
    routeClass: 'admin',
    inputSchema: z.object({ operationId: z.string().min(1).max(384) }).strict(),
    outputSchema: OperationProjectionSchema,
    handle: async (principal, input) => endpoints.operations.status(principal, input.operationId),
  });
  router.register({
    id: 'operation.resolve',
    method: 'POST',
    path: '/control/operations/:operationId/resolve',
    routeClass: 'admin',
    inputSchema: z
      .object({
        operationId: z.string().min(1).max(384),
        decision: z.enum(['resolved-applied', 'resolved-not-applied', 'abandoned']),
        reasonHash: HashSchema,
        evidenceHash: HashSchema,
        confirmedResultHash: HashSchema.nullable().optional(),
        confirmationHash: HashSchema.optional(),
        confirm: z.string(),
        actionNonce: NonceSchema,
      })
      .strict(),
    outputSchema: OperationProjectionSchema,
    handle: async (principal, input) =>
      endpoints.operations.resolve(principal, input.operationId, input),
  });
  router.register({
    id: 'operation.cancel',
    method: 'POST',
    path: '/control/operations/:operationId/cancel',
    routeClass: 'admin',
    inputSchema: InvocationCancelV1Schema,
    outputSchema: z.undefined(),
    handle: async (principal, input) => endpoints.operations.cancel(principal, input),
  });
  router.register({
    id: 'egress.status',
    method: 'GET',
    path: '/control/egress',
    routeClass: 'admin',
    inputSchema: EmptySchema,
    outputSchema: EgressConfigStatusV1Schema,
    handle: async () => endpoints.egress.status(),
  });
  router.register({
    id: 'egress.configure',
    method: 'POST',
    path: '/control/egress',
    routeClass: 'admin',
    inputSchema: EgressConfigureRequestV1Schema,
    outputSchema: EgressConfigStatusV1Schema,
    handle: async (principal, input) => endpoints.egress.configure(principal, input),
  });
  router.register({
    id: 'egress.reset',
    method: 'DELETE',
    path: '/control/egress',
    routeClass: 'admin',
    inputSchema: z.object({ actionNonce: NonceSchema }).strict(),
    outputSchema: EgressConfigStatusV1Schema,
    handle: async (principal, input) => endpoints.egress.reset(principal, input),
  });
  router.register({
    id: 'admin-audit.egress',
    method: 'GET',
    path: '/control/admin-audit',
    routeClass: 'admin',
    inputSchema: z
      .object({
        kind: z.literal('egress').optional(),
        since: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.union([z.string(), z.number()]).optional(),
      })
      .strict(),
    outputSchema: AdminAuditQueryOutputSchema,
    handle: async (principal, input) => endpoints.adminAudit(principal, input),
  });
};
