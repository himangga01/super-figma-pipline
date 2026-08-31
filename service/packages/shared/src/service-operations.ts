import { z } from 'zod';

import type { ResultEgressPolicy } from './egress.js';
import {
  InvocationTargetSelectorSchema,
  type RuntimeExecutionScope,
  type TargetRequirement,
} from './invocation.js';
import type {
  ApprovalRequirement,
  ConcurrencyRequirement,
  Effect,
  IdempotencyRequirement,
  PolicyInvocationContext,
} from './operations.js';

export const ServiceOperationNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/)
  .pipe(z.enum(['snapshot.capture', 'grounding.refresh']));

export type ServiceOperationName = z.infer<typeof ServiceOperationNameSchema>;
export const SystemOperationNameSchema = z.literal('identity.bootstrap');
export type SystemOperationName = z.infer<typeof SystemOperationNameSchema>;
export type OperationKind = 'tool' | 'service' | 'system';

const ServiceRequestIdSchema = z.string().regex(/^sfp_req1_[A-Za-z0-9_-]{21}[AQgw]$/u);
const ServiceWorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
export const ServiceOperationRequestV1Schema = z
  .object({
    version: z.literal(1),
    requestId: ServiceRequestIdSchema,
    serviceOperationName: ServiceOperationNameSchema,
    rawArgs: z.unknown().optional(),
    operationId: z.string().min(1).max(384).optional(),
    workspaceId: ServiceWorkspaceIdSchema.nullable().optional(),
    targetSelector: InvocationTargetSelectorSchema,
  })
  .strict();
export type ServiceOperationRequestV1 = z.infer<typeof ServiceOperationRequestV1Schema>;

export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  throwIfAborted(): void;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface ServiceOperationSpec<I, O> {
  name: ServiceOperationName;
  inputSchema: z.ZodType<I>;
  resultSchema: z.ZodType<O>;
  policyId: string;
  possibleEffects: readonly Effect[];
  effectsFor(args: Readonly<I>, context: PolicyInvocationContext): readonly Effect[];
  idempotencyFor(args: Readonly<I>): IdempotencyRequirement;
  approvalFor(effects: readonly Effect[], context: PolicyInvocationContext): ApprovalRequirement;
  concurrency: ConcurrencyRequirement;
  egressPolicy: ResultEgressPolicy<I, O>;
  targetRequirementFor(args: Readonly<I>): TargetRequirement;
  execute(scope: RuntimeExecutionScope, args: I, signal: AbortSignalLike): Promise<O>;
}
