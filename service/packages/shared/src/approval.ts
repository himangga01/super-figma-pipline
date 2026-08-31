import { z } from 'zod';

import { Base64Url128Schema } from './auth.js';
import type { ActorContext, FileExecutionKey } from './invocation.js';
import type { Effect, OperationName } from './operations.js';

const PrefixedSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const ApprovalIdSchema = z.string().regex(/^sfp_ap1_[A-Za-z0-9_-]{22}$/u);

export const ApprovalPromptV1Schema = z
  .object({
    version: z.literal(1),
    type: z.literal('approval.prompt'),
    approvalId: ApprovalIdSchema,
    operationId: z.string().min(1).max(384),
    operationKind: z.enum(['tool', 'service', 'system']),
    operationName: z.string().min(1).max(128),
    channel: z.enum(['plugin-session', 'owner-control-session']),
    promptHash: PrefixedSha256Schema,
    effectSummary: z.array(z.string().min(1).max(128)).max(64).readonly(),
    target: z
      .object({
        fileIdentityHash: PrefixedSha256Schema.nullable(),
        label: z.string().min(1).max(256),
        targetCount: z.number().int().nonnegative().safe().nullable(),
      })
      .strict(),
    issuedAt: z.number().int().nonnegative().safe(),
    expiresAt: z.number().int().positive().safe(),
  })
  .strict();
export type ApprovalPromptV1 = z.infer<typeof ApprovalPromptV1Schema>;

export const ApprovalDecisionV1Schema = z
  .object({
    version: z.literal(1),
    type: z.literal('approval.decision'),
    approvalId: ApprovalIdSchema,
    operationId: z.string().min(1).max(384),
    promptHash: PrefixedSha256Schema,
    decision: z.enum(['approved', 'rejected']),
  })
  .strict();
export type ApprovalDecisionV1 = z.infer<typeof ApprovalDecisionV1Schema>;

export interface ApprovalRecord {
  approvalId: `sfp_ap1_${string}`;
  actorId: ActorContext['actorId'];
  operationId: string;
  decision: 'approved' | 'rejected' | 'expired';
  decidedAt: string;
}

interface ApprovalBindingCommonV1 {
  approvalId: `sfp_ap1_${string}`;
  operationId: string;
  promptHash: `sha256:${string}`;
  actorId: ActorContext['actorId'];
  issuedAt: number;
  expiresAt: number;
  state: 'pending' | 'approved' | 'rejected' | 'expired';
}

export type ApprovalBindingV1 = ApprovalBindingCommonV1 &
  (
    | {
        channel: 'plugin-session';
        pairedSessionId: z.infer<typeof Base64Url128Schema>;
        leaderGeneration: string;
        pluginGeneration: string;
        fileExecutionKey: FileExecutionKey;
        decisionTransport: 'paired-ws';
      }
    | {
        channel: 'owner-control-session';
        originControlAuthSessionId: ActorContext['authSessionId'];
        leaderGeneration: string;
        pairedSessionId: null;
        pluginGeneration: null;
        fileExecutionKey: null;
        decisionTransport: 'authenticated-control';
      }
    | {
        channel: 'owner-control-session';
        originControlAuthSessionId: ActorContext['authSessionId'];
        leaderGeneration: string;
        pairedSessionId: z.infer<typeof Base64Url128Schema>;
        pluginGeneration: string;
        fileExecutionKey: FileExecutionKey;
        decisionTransport: 'authenticated-control';
      }
  );

export interface ApprovalDecisionPort {
  decide(
    scope: import('./invocation.js').ResolvedInvocationScope,
    operationName: OperationName,
    effects: readonly Effect[],
    operationId: string,
  ): Promise<ApprovalRecord | null>;
}
