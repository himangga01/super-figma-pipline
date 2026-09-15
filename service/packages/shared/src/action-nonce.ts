import { z } from 'zod';

import { EXTERNAL_MODEL_DATA_CLASSES, compareUtf8Bytes, hashCanonicalJson } from './egress.js';
import type { ActorContext } from './invocation.js';

const PrefixedSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const WorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const NonceValueSchema = z.string().regex(/^sfp_an1_[A-Za-z0-9_-]{43}$/u);

export const ACTION_NONCE_TTL_MS = 120_000 as const;
export const ACTION_NONCE_MAX_ROWS_PER_ACTOR = 1_024 as const;
export const ACTION_NONCE_MAX_BYTES_PER_ACTOR = 524_288 as const;

export const ActionNonceActionSchema = z.enum([
  'workspace.add',
  'workspace.remove',
  'workspace.set-default',
  'operation.resolve',
  'network-domain.add',
  'network-domain.remove',
  'egress.configure',
  'egress.reset',
  'portal.profile.register',
  'portal.environment.reconcile',
]);
export type ActionNonceAction = z.infer<typeof ActionNonceActionSchema>;

const WorkspaceAddNonceRequestSchema = z
  .object({
    action: z.literal('workspace.add'),
    requestHash: PrefixedSha256Schema,
    registrationPath: z.string().min(1).max(32_768),
  })
  .strict();
const OtherNonceRequestSchema = z
  .object({
    action: ActionNonceActionSchema.exclude(['workspace.add']),
    requestHash: PrefixedSha256Schema,
  })
  .strict();
export const ActionNonceIssueRequestV1Schema = z.discriminatedUnion('action', [
  WorkspaceAddNonceRequestSchema,
  OtherNonceRequestSchema,
]);
export type ActionNonceIssueRequestV1 = z.infer<typeof ActionNonceIssueRequestV1Schema>;

export interface ActionNonceClaims {
  value: `sfp_an1_${string}`;
  actorId: ActorContext['actorId'];
  leaderGeneration: string;
  action: ActionNonceAction;
  requestHash: `sha256:${string}`;
  issuedAt: number;
  expiresAt: number;
  state: 'issued' | 'consumed';
}

export interface ActionNonceStore {
  issue(
    actor: Readonly<ActorContext>,
    action: ActionNonceAction,
    requestHash: `sha256:${string}`,
  ): Promise<Readonly<ActionNonceClaims>>;
  consumeCas(
    actor: Readonly<ActorContext>,
    value: string,
    action: ActionNonceAction,
    requestHash: `sha256:${string}`,
    beforeConsume?: (() => Promise<void>) | undefined,
  ): Promise<void>;
}

export const ActionNonceClaimsSchema = z
  .object({
    value: NonceValueSchema,
    actorId: z.string().regex(/^actor1_[A-Za-z0-9_-]{43}$/u),
    leaderGeneration: z.string().min(1).max(256),
    action: ActionNonceActionSchema,
    requestHash: PrefixedSha256Schema,
    issuedAt: z.number().int().nonnegative().safe(),
    expiresAt: z.number().int().positive().safe(),
    state: z.enum(['issued', 'consumed']),
  })
  .strict()
  .refine(value => value.expiresAt === value.issuedAt + ACTION_NONCE_TTL_MS, {
    message: 'action nonce expiry is not canonical',
  });

const byteSortedUniqueStrings = (values: readonly string[]): readonly string[] => {
  if (new Set(values).size !== values.length) {
    throw Object.assign(new Error('semantic request contains duplicate values'), {
      code: 'ACTION_NONCE_REQUEST_INVALID',
    });
  }
  return Object.freeze([...values].toSorted(compareUtf8Bytes));
};

const semanticSchemas = {
  'portal.environment.reconcile': z
    .object({ attemptId: z.string().regex(/^[a-f0-9]{64}$/u), receiptHash: PrefixedSha256Schema })
    .strict(),
  'portal.profile.register': z
    .object({
      planId: z.string().regex(/^sfp_portal1_[a-f0-9]{32}$/u),
      profileHash: PrefixedSha256Schema,
    })
    .strict(),
  'workspace.add': z.object({ realPath: z.string().min(1).max(32_768) }).strict(),
  'workspace.remove': z.object({ workspaceId: WorkspaceIdSchema }).strict(),
  'workspace.set-default': z.object({ workspaceId: WorkspaceIdSchema.nullable() }).strict(),
  'operation.resolve': z
    .object({
      operationId: z.string().min(1).max(384),
      decision: z.enum(['resolved-applied', 'resolved-not-applied', 'abandoned']),
      reasonHash: PrefixedSha256Schema,
      evidenceHash: PrefixedSha256Schema,
      confirmedResultHash: PrefixedSha256Schema.nullable(),
      confirmationHash: PrefixedSha256Schema,
    })
    .strict(),
  'network-domain.add': z.object({ domain: z.string().min(1).max(253) }).strict(),
  'network-domain.remove': z.object({ domain: z.string().min(1).max(253) }).strict(),
  'egress.configure': z
    .object({
      mode: z.literal('external-model'),
      allowedClasses: z
        .array(z.enum(['public', 'project-code', 'design-text', 'design-image']))
        .min(1)
        .max(4),
      expiresInSeconds: z.number().int().min(60).max(28_800),
    })
    .strict(),
  'egress.reset': z.object({}).strict(),
} satisfies Record<ActionNonceAction, z.ZodType>;

const canonicalSemanticRequest = (action: ActionNonceAction, request: unknown): unknown => {
  const parsed = semanticSchemas[action].parse(request) as Record<string, unknown>;
  if (action !== 'egress.configure') return parsed;
  return {
    mode: 'external-model',
    allowedClasses: Object.freeze(
      EXTERNAL_MODEL_DATA_CLASSES.filter(dataClass =>
        byteSortedUniqueStrings(parsed.allowedClasses as readonly string[]).includes(dataClass),
      ),
    ),
    expiresInSeconds: parsed.expiresInSeconds,
  };
};

export const hashActionRequest = (
  action: ActionNonceAction,
  semanticRequest: unknown,
): `sha256:${string}` => {
  const parsedAction = ActionNonceActionSchema.parse(action);
  const request = canonicalSemanticRequest(parsedAction, semanticRequest);
  return hashCanonicalJson('sfp-action-request-v1', { action: parsedAction, request });
};

export { PrefixedSha256Schema as ActionNonceRequestHashSchema };
