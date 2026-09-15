import { z } from 'zod';

import { FileIdentitySchema, PairExchangeResultSchema } from './auth.js';

export const DocumentBindingRequestSchema = z
  .object({
    readOnly: z.boolean().default(false),
    fileKey: z.string().regex(/^[A-Za-z0-9]{10,128}$/u),
    expectedFileName: z.string().min(1).max(1024),
  })
  .strict();
export const IdentityReadResultSchema = z
  .object({
    fileName: z.string().max(1024),
    fileKey: z.string().nullable(),
    documentUuid: z.string().uuid().nullable(),
    rawHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    pluginGeneration: z.string().min(1).max(256),
  })
  .strict();
export const IdentityBootstrapArgsSchema = z
  .object({
    readOnly: z.boolean().default(false),
    expectedRawHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    pluginGeneration: z.string().min(1).max(256),
    documentUuid: z.string().uuid(),
    publishNonce: z.string().regex(/^[A-Za-z0-9_-]{21}[AQgw]$/u),
  })
  .strict();
export const IdentityBootstrapResultSchema = z
  .object({
    fileIdentity: FileIdentitySchema,
    mutated: z.boolean(),
  })
  .strict();
export const DocumentBindingResultSchema = z
  .object({
    operationId: z.string().min(1).max(384),
    fileIdentity: FileIdentitySchema,
    fileKeyHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    readOnly: z.boolean(),
    ticket: PairExchangeResultSchema.nullable(),
    publishNonce: z
      .string()
      .regex(/^[A-Za-z0-9_-]{21}[AQgw]$/u)
      .nullable(),
  })
  .strict();
export const IdentityPublishSchema = z
  .object({
    tag: z.literal('@sfp/identity-publish'),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{21}[AQgw]$/u),
  })
  .strict();
export const IdentityReadySchema = z
  .object({
    tag: z.literal('@sfp/identity-authenticated'),
    nonce: IdentityPublishSchema.shape.nonce,
  })
  .strict();
export type DocumentBindingRequest = z.infer<typeof DocumentBindingRequestSchema>;
export type DocumentBindingResult = z.infer<typeof DocumentBindingResultSchema>;
export type IdentityPublish = z.infer<typeof IdentityPublishSchema>;
export type IdentityReady = z.infer<typeof IdentityReadySchema>;
