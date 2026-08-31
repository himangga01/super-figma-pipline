import { z } from 'zod';

import { InvocationRequestV1Schema, type ActorContext, type PrefixedSha256 } from './invocation.js';

export const ToolCallControlEnvelopeV1Schema = z
  .object({
    version: z.literal(1),
    invocation: InvocationRequestV1Schema,
    captureResult: z.boolean(),
  })
  .strict();
export type ToolCallControlEnvelopeV1 = z.infer<typeof ToolCallControlEnvelopeV1Schema>;

export const InvocationCancelV1Schema = z
  .object({
    version: z.literal(1),
    requestId: z.string().regex(/^sfp_req1_[A-Za-z0-9_-]{22}$/u),
    operationId: z.string().min(1).max(384),
  })
  .strict();
export type InvocationCancelV1 = z.infer<typeof InvocationCancelV1Schema>;

export const ControlStatusV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    serverVersion: z.string().min(1).max(256),
    buildId: z.number().int().nonnegative().safe(),
    buildIdentityHash: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/u)
      .nullable(),
    leaderGeneration: z.string().min(1).max(256),
    role: z.enum(['leader', 'follower', 'unknown', 'conflicted']),
    pairedPluginCount: z.number().int().nonnegative().safe(),
    activePlugin: z
      .object({
        sessionId: z.string().min(1).max(256),
        fileName: z.string().max(1_024).nullable(),
        pageName: z.string().max(1_024).nullable(),
        fileIdentityKind: z.enum(['figma-file-key', 'document-plugin-uuid', 'unstable-readonly']),
        pluginVersion: z.string().min(1).max(256),
        pluginGenerationHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
        editorType: z.enum(['figma', 'figjam', 'dev']),
        capabilities: z.array(z.string().min(1).max(256)).max(1_024).readonly(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ControlStatusV1 = z.infer<typeof ControlStatusV1Schema>;

export type ControlRouteClass = 'tool' | 'service' | 'admin';
export interface AuthenticatedControlRoute<I, O> {
  id: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  routeClass: ControlRouteClass;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  handle(
    principal: Readonly<ActorContext>,
    input: I,
    signal: Readonly<{ aborted: boolean }>,
  ): Promise<O> | AsyncIterable<unknown>;
}

export interface AdministrativeActionAuditRecord {
  routeClass: 'admin';
  action: string;
  actorId: ActorContext['actorId'];
  authSessionId: ActorContext['authSessionId'];
  requestHash: PrefixedSha256 | null;
  egress: null | {
    configHash: PrefixedSha256;
    allowedClasses: readonly string[];
    expiresAt: string | null;
  };
  decidedAt: string;
}
