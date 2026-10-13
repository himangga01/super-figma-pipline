import { z } from 'zod';

// Pure public contract. No file access, credential lookup, server, SDK or callback state.
const Endpoint = z.enum(['https://mcp.figma.com/mcp', 'http://127.0.0.1:3845/mcp']);
const EnvName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u)
  .nullable();
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const Generation = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const FigmaOAuthCodeSchema = z.enum([
  'FIGMA_MCP_OAUTH_REGISTRATION_REQUIRED',
  'FIGMA_MCP_OAUTH_OWN_CLIENT_REQUIRED',
  'FIGMA_MCP_OAUTH_SECRET_REQUIRED',
  'FIGMA_MCP_OAUTH_METADATA_REJECTED',
  'FIGMA_MCP_OAUTH_CALLBACK_REJECTED',
  'FIGMA_MCP_OAUTH_OWNER_MISMATCH',
  'FIGMA_MCP_OAUTH_BUSY',
  'FIGMA_MCP_OAUTH_CANCELLED',
  'FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED',
  'FIGMA_MCP_OAUTH_SUPERSEDED',
  'FIGMA_MCP_OAUTH_CALLBACK_REQUIRED',
  'FIGMA_MCP_OAUTH_CONSENT_DENIED',
  'FIGMA_MCP_OAUTH_DESTINATION_REJECTED',
  'FIGMA_MCP_OAUTH_RESPONSE_REJECTED',
  'FIGMA_MCP_OAUTH_TOKEN_REJECTED',
  'FIGMA_MCP_OAUTH_EXCHANGE_FAILED',
  'FIGMA_MCP_OAUTH_REFRESH_FAILED',
  'FIGMA_MCP_OAUTH_TOKEN_REQUIRED',
  'FIGMA_MCP_OAUTH_HANDOFF_FAILED',
  'FIGMA_MCP_OAUTH_INPUT_INVALID',
  'FIGMA_MCP_OAUTH_CONFIGURATION_INVALID',
  'FIGMA_MCP_OAUTH_BINDING_MISMATCH',
  'FIGMA_MCP_OAUTH_CONTRACT_REQUIRED',
  'FIGMA_MCP_OAUTH_CONTRACT_INVALID',
  'FIGMA_MCP_OAUTH_CONTRACT_CHANGED',
  'FIGMA_MCP_OAUTH_ENV_UNAVAILABLE',
  'FIGMA_MCP_OAUTH_ENDPOINT_REQUIRED',
  'FIGMA_MCP_OAUTH_MODE_REQUIRED',
  'FIGMA_MCP_OAUTH_PORT_UNAVAILABLE',
  'FIGMA_MCP_OAUTH_HANDOFF_UNAVAILABLE',
  'FIGMA_MCP_OAUTH_CLOSED',
  'FIGMA_MCP_OAUTH_PERSISTENCE_FAILED',
]);
export const FigmaOAuthConfigurationSchema = z
  .object({
    endpoint: Endpoint,
    mode: z.enum(['external-token', 'own-oauth']),
    oauthTokenEnv: EnvName,
    clientIdEnv: EnvName,
    clientSecretEnv: EnvName,
    contractReference: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u)
      .nullable(),
    contractDigest: Digest.nullable(),
  })
  .strict();
export const FigmaOAuthBindingSchema = z
  .object({
    providerInstanceId: z.string().uuid(),
    configurationGeneration: Generation,
    authGeneration: Generation,
  })
  .strict();
export const FigmaOAuthStatusSchema = FigmaOAuthBindingSchema.extend({
  schemaVersion: z.literal(1),
  configuration: FigmaOAuthConfigurationSchema,
  stage: z.enum([
    'blocked',
    'preparing',
    'waiting-for-callback',
    'exchanging',
    'authorized',
    'refreshing',
    'cancelled',
    'logged-out',
    'expired',
    'login-required',
    'external-token-configured',
  ]),
  code: FigmaOAuthCodeSchema.nullable(),
  expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  flowId: z.string().uuid().nullable(),
  handoffAvailable: z.boolean(),
  eligibilitySource: z.enum(['none', 'operator-contract']),
  serverAuthorizationObserved: z.boolean(),
  sessionOnly: z.literal(true),
}).strict();
export const FigmaOAuthConfigureInputSchema = FigmaOAuthBindingSchema.extend({
  configuration: FigmaOAuthConfigurationSchema,
}).strict();
export const FigmaOAuthStartInputSchema = FigmaOAuthBindingSchema.extend({
  deadlineAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export const FigmaOAuthRefreshInputSchema = FigmaOAuthStartInputSchema.clone();
export const FigmaOAuthHandoffInputSchema = FigmaOAuthBindingSchema.extend({
  flowId: z.string().uuid(),
}).strict();
export const FigmaOAuthCleanupInputSchema = FigmaOAuthBindingSchema.extend({
  flowId: z.string().uuid().nullable(),
}).strict();

export type FigmaOAuthConfiguration = z.infer<typeof FigmaOAuthConfigurationSchema>;
export type FigmaOAuthBinding = z.infer<typeof FigmaOAuthBindingSchema>;
export type FigmaOAuthStatus = z.infer<typeof FigmaOAuthStatusSchema>;
export type FigmaOAuthCode = z.infer<typeof FigmaOAuthCodeSchema>;

export function figmaOAuthError(code: FigmaOAuthCode): Error & { readonly code: FigmaOAuthCode } {
  const error = Object.assign(new Error(code), { code, name: 'Error' });
  Object.defineProperty(error, 'stack', {
    value: error.stack,
    writable: false,
    configurable: false,
  });
  return Object.freeze(error);
}
/** Never echo Zod issue paths, unknown input field names or hostile getter errors. */
export function parseFigmaOAuth<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
  } catch {
    /* Closed failure below. */
  }
  throw figmaOAuthError('FIGMA_MCP_OAUTH_INPUT_INVALID');
}
