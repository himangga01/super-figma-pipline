import { z } from 'zod';

import type { ResultEgressPolicy } from './egress.js';
import type { RuntimeExecutionScope, TargetRequirement } from './invocation.js';
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
