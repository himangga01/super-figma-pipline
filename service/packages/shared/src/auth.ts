import { z } from 'zod';

/** Stable unauthenticated identity returned by the local leader's strict /ping endpoint. */
export const PRODUCT_MAGIC = 'super-figma-pipeline' as const;

/** Canonical unpadded base64url encoding of exactly 16 bytes. */
export const Base64Url128Schema = z.string().regex(/^[A-Za-z0-9_-]{21}[AQgw]$/);
export const McpSessionIdSchema = z.string().regex(/^mcp1_[A-Za-z0-9_-]{21}[AQgw]$/);
export type McpSessionId = z.infer<typeof McpSessionIdSchema>;
export const FollowerTransportRequestIdSchema = z
  .string()
  .regex(/^sfp_req1_[A-Za-z0-9_-]{21}[AQgw]$/);
export type FollowerTransportRequestId = z.infer<typeof FollowerTransportRequestIdSchema>;

export const PublicPingV1Schema = z
  .object({
    ok: z.literal(true),
    product: z.literal(PRODUCT_MAGIC),
    protocolVersion: z.string().min(1).max(128),
    serverVersion: z.string().min(1).max(128),
    buildId: z.number().int().nonnegative().safe(),
    leaderGeneration: Base64Url128Schema,
    role: z.enum(['leader', 'follower', 'unknown', 'conflicted']),
  })
  .strict();
export type PublicPingV1 = z.infer<typeof PublicPingV1Schema>;

export interface PairChallenge {
  challengeId: string;
  codeHash: string;
  expiresAt: number;
  attemptsRemaining: number;
}

export interface PairChallengeIssued {
  challengeId: string;
  code: string;
  expiresAt: number;
  attemptsRemaining: number;
}

export const PairExchangeRequestSchema = z
  .object({
    challengeId: z.string().regex(/^[A-Z2-7]{10}$/),
    code: z.string().regex(/^\d{8}$/),
  })
  .strict();
export type PairExchangeRequest = z.infer<typeof PairExchangeRequestSchema>;

export const PairExchangeResultSchema = z
  .object({
    wsTicket: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();
export type PairExchangeResult = z.infer<typeof PairExchangeResultSchema>;

export const HelloCredentialSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ticket'), value: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('resume'), value: z.string().min(1).max(256) }).strict(),
]);
export type HelloCredential = z.infer<typeof HelloCredentialSchema>;

export const FileIdentitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('figma-file-key'), value: z.string().min(1).max(512) }).strict(),
  z.object({ kind: z.literal('document-plugin-uuid'), value: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal('unstable-readonly'),
      sessionId: z.string().min(1).max(256),
      pluginGeneration: z.string().min(1).max(256),
    })
    .strict(),
]);
export type FileIdentity = z.infer<typeof FileIdentitySchema>;

export const AuthenticatedHelloSchema = z
  .object({
    credential: HelloCredentialSchema,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{22,86}$/),
    protocolVersion: z.string().min(1).max(128),
    productVersion: z.string().min(1).max(128),
    pluginVersion: z.string().min(1).max(128),
    pluginGeneration: z.string().min(1).max(256),
    editorType: z.enum(['figma', 'figjam', 'dev']),
    mode: z.string().min(1).max(128),
    fileIdentity: FileIdentitySchema,
    fileName: z.string().min(1).max(1024),
    capabilities: z.array(z.string().min(1).max(256)).max(256).readonly(),
  })
  .strict();
export type AuthenticatedHello = z.infer<typeof AuthenticatedHelloSchema>;

export const AuthenticatedHelloResultSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    rotatedResumeToken: z.string().min(1).max(256),
    resumeExpiresAt: z.number().int().nonnegative(),
  })
  .strict();
export type AuthenticatedHelloResult = z.infer<typeof AuthenticatedHelloResultSchema>;

export const PairErrorCodeSchema = z.enum([
  'PAIR_BODY_INVALID',
  'PAIR_CODE_WRONG',
  'PAIR_CODE_EXPIRED',
  'PAIR_CODE_USED',
  'PAIR_RATE_LIMITED',
  'PAIR_INTERNAL',
  'PAIR_CREDENTIAL_REQUIRED',
  'PAIR_TICKET_INVALID',
  'PAIR_TICKET_EXPIRED',
  'PAIR_TICKET_USED',
  'PAIR_RESUME_INVALID',
  'PAIR_RESUME_EXPIRED',
  'PAIR_RESUME_USED',
  'PAIR_GENERATION_MISMATCH',
  'PAIR_HELLO_PENDING',
]);
export type PairErrorCode = z.infer<typeof PairErrorCodeSchema>;
