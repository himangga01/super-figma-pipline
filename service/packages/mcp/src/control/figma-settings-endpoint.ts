import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  OFFICIAL_FIGMA_REMOTE,
  OFFICIAL_FIGMA_DESKTOP,
  OFFICIAL_FIGMA_READ_TOOLS,
  officialFigmaConnectionFromEnvironment,
  probeOfficialFigmaMcp,
  readOfficialFigmaMcp,
  type OfficialFigmaConnectionOptions,
} from '../official-figma-mcp.js';
import type { FigmaOAuthProvider } from './figma-oauth-provider.js';

export const FigmaMcpEndpointSchema = z.enum([OFFICIAL_FIGMA_REMOTE, OFFICIAL_FIGMA_DESKTOP]);
export const FigmaMcpProbeInputSchema = z.object({ endpoint: FigmaMcpEndpointSchema }).strict();
const readTarget = z
  .object({
    fileKey: z.string().regex(/^[A-Za-z0-9_-]{10,128}$/u),
    nodeId: z
      .string()
      .max(128)
      .regex(/^\d+:\d+$/u),
  })
  .strict();
export const FigmaMcpReadInputSchema = z
  .object({
    endpoint: FigmaMcpEndpointSchema,
    target: readTarget,
    tool: z.enum(OFFICIAL_FIGMA_READ_TOOLS),
  })
  .strict();
export const FigmaMcpDaemonStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('daemon-generation-provider'),
    providerInstanceId: z.string().uuid(),
    configurationRecognized: z.boolean(),
    oauthTokenEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
      .nullable(),
    credentialAvailable: z.boolean(),
    oauthLoginImplemented: z.boolean(),
    clientRegistration: z.literal('unverified'),
  })
  .strict();
export const FigmaMcpProbeResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    endpoint: FigmaMcpEndpointSchema,
    checkedAt: z.string().datetime(),
    status: z.enum(['connected', 'auth-required', 'unavailable', 'cancelled']),
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,127}$/u)
      .nullable(),
    authentication: FigmaMcpDaemonStatusSchema,
    tools: z.array(z.enum(OFFICIAL_FIGMA_READ_TOOLS)).max(5),
    programCaptureSupported: z.boolean(),
    fullCapture: z.literal(false),
  })
  .strict();
export type FigmaMcpDaemonStatus = z.infer<typeof FigmaMcpDaemonStatusSchema>;
export type FigmaMcpProbeResult = z.infer<typeof FigmaMcpProbeResultSchema>;
export const FigmaMcpReadResultSchema = z
  .object({
    source: z.literal('official-figma-mcp'),
    endpoint: FigmaMcpEndpointSchema,
    requestedTarget: readTarget,
    tool: z.enum(OFFICIAL_FIGMA_READ_TOOLS),
    identityBinding: z.enum(['request-only', 'desktop-active-file-unverified']),
    result: z.unknown(),
    fullCapture: z.literal(false),
    authentication: FigmaMcpDaemonStatusSchema,
    checkedAt: z.string().datetime(),
  })
  .strict();

/** One provider instance supplies both real generation and explicit, bounded metadata probes. */
export function createFigmaMcpSettingsEndpoint(
  options: {
    environment?: Readonly<Record<string, string | undefined>>;
    probe?: typeof probeOfficialFigmaMcp;
    read?: typeof readOfficialFigmaMcp;
    now?: () => number;
    oauth?: FigmaOAuthProvider;
  } = {},
) {
  const environment = options.environment ?? process.env;
  const oauthTokenEnv = environment.SFP_FIGMA_MCP_OAUTH_TOKEN_ENV ?? null;
  const configurationRecognized =
    oauthTokenEnv === null || /^[A-Za-z_][A-Za-z0-9_]*$/u.test(oauthTokenEnv);
  let connection: OfficialFigmaConnectionOptions;
  try {
    connection = options.oauth
      ? {
          oauthToken: () => options.oauth!.token(),
          acquireCredentialLease: () => options.oauth!.acquireCredentialLease(),
          assertPublicResult: value => options.oauth!.assertPublicResult(value),
        }
      : officialFigmaConnectionFromEnvironment(environment);
  } catch {
    // A malformed optional MCP reference must not prevent Chrome or other service functions starting.
    connection = {
      oauthToken: async () => {
        throw Object.assign(new Error('Configure an authorized OAuth environment reference.'), {
          code: 'FIGMA_MCP_OAUTH_ENV_REQUIRED',
        });
      },
    };
  }
  const now = options.now ?? Date.now;
  const providerInstanceId = options.oauth?.providerInstanceId ?? randomUUID();
  let busy = false;
  const generation = () => {
    const auth = options.oauth?.status();
    return auth ? `${auth.configurationGeneration}:${auth.authGeneration}` : null;
  };
  const assertGeneration = (original: string | null) => {
    if (original !== generation())
      throw Object.assign(new Error('The official credential generation was retired.'), {
        code: 'FIGMA_MCP_OAUTH_SUPERSEDED',
      });
  };
  const status = (): FigmaMcpDaemonStatus => {
    const auth = options.oauth?.status();
    return FigmaMcpDaemonStatusSchema.parse({
      schemaVersion: 1,
      provider: 'daemon-generation-provider',
      providerInstanceId,
      configurationRecognized: auth
        ? auth.code !== 'FIGMA_MCP_OAUTH_CONFIGURATION_INVALID'
        : configurationRecognized,
      oauthTokenEnv: auth
        ? auth.configuration.oauthTokenEnv
        : configurationRecognized
          ? oauthTokenEnv
          : null,
      credentialAvailable: auth
        ? ['authorized', 'external-token-configured'].includes(auth.stage)
        : configurationRecognized && oauthTokenEnv !== null && Boolean(environment[oauthTokenEnv]),
      oauthLoginImplemented: Boolean(options.oauth),
      clientRegistration: 'unverified',
    });
  };
  return {
    connection,
    status,
    oauth: options.oauth,
    async read(raw: unknown, signal: Readonly<{ aborted: boolean }>) {
      const input = FigmaMcpReadInputSchema.parse(raw);
      if (!(signal instanceof AbortSignal))
        throw Object.assign(new Error('A bounded control request signal is required.'), {
          code: 'FIGMA_MCP_SIGNAL_REQUIRED',
        });
      signal.throwIfAborted();
      if (busy)
        throw Object.assign(new Error('An official Figma request is already active.'), {
          code: 'FIGMA_MCP_PROBE_BUSY',
        });
      busy = true;
      const original = input.endpoint === OFFICIAL_FIGMA_REMOTE ? generation() : null;
      const bounds = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
      try {
        const result = await (options.read ?? readOfficialFigmaMcp)(input, {
          ...(input.endpoint === OFFICIAL_FIGMA_REMOTE ? connection : {}),
          signal: bounds,
          deadlineAt: now() + 20000,
        });
        if (input.endpoint === OFFICIAL_FIGMA_REMOTE) assertGeneration(original);
        bounds.throwIfAborted();
        const parsed = FigmaMcpReadResultSchema.parse({
          ...result,
          authentication: status(),
          checkedAt: new Date(now()).toISOString(),
        });
        if (
          parsed.endpoint !== input.endpoint ||
          parsed.tool !== input.tool ||
          parsed.requestedTarget.fileKey !== input.target.fileKey ||
          parsed.requestedTarget.nodeId !== input.target.nodeId
        )
          throw Object.assign(new Error('Official read response binding failed.'), {
            code: 'FIGMA_MCP_READ_MISMATCH',
          });
        const bytes = JSON.stringify(parsed);
        options.oauth?.assertPublicResult(parsed);
        if (Buffer.byteLength(bytes) > 2 * 1024 * 1024)
          throw Object.assign(new Error('Official read response exceeds the bounded preview.'), {
            code: 'FIGMA_MCP_READ_TOO_LARGE',
          });
        const credential =
          input.endpoint === OFFICIAL_FIGMA_REMOTE && oauthTokenEnv !== null
            ? environment[oauthTokenEnv]
            : undefined;
        if (credential && bytes.includes(credential))
          throw Object.assign(
            new Error('Official read response contained private authentication data.'),
            { code: 'FIGMA_MCP_READ_PRIVATE_DATA' },
          );
        return parsed;
      } catch (error) {
        const reported = (error as { code?: unknown } | null)?.code;
        const allowed = new Set([
          'FIGMA_MCP_AUTH_REQUIRED',
          'FIGMA_MCP_OAUTH_ENV_REQUIRED',
          'FIGMA_MCP_DEADLINE_EXCEEDED',
          'FIGMA_MCP_REDIRECT_REJECTED',
          'FIGMA_MCP_DESTINATION_REJECTED',
          'FIGMA_MCP_TOOL_UNAVAILABLE',
          'FIGMA_MCP_TARGET_UNSUPPORTED',
          'FIGMA_MCP_INPUT_UNSUPPORTED',
          'FIGMA_MCP_TOOL_FAILED',
          'FIGMA_MCP_READ_MISMATCH',
          'FIGMA_MCP_READ_TOO_LARGE',
          'FIGMA_MCP_READ_PRIVATE_DATA',
          'FIGMA_MCP_OAUTH_SUPERSEDED',
        ]);
        const code = bounds.aborted
          ? 'FIGMA_MCP_READ_CANCELLED'
          : typeof reported === 'string' && allowed.has(reported)
            ? reported
            : 'FIGMA_MCP_READ_UNAVAILABLE';
        throw Object.assign(
          new Error(
            'The bounded official Figma read did not complete. Check the safe error code and connection settings.',
          ),
          { code },
        );
      } finally {
        busy = false;
      }
    },
    async probe(
      raw: unknown,
      signal: Readonly<{ aborted: boolean }>,
    ): Promise<FigmaMcpProbeResult> {
      const { endpoint } = FigmaMcpProbeInputSchema.parse(raw);
      if (!(signal instanceof AbortSignal))
        throw Object.assign(new Error('A bounded control request signal is required.'), {
          code: 'FIGMA_MCP_SIGNAL_REQUIRED',
        });
      signal.throwIfAborted();
      if (busy)
        throw Object.assign(new Error('An official Figma probe is already active.'), {
          code: 'FIGMA_MCP_PROBE_BUSY',
        });
      busy = true;
      const original = endpoint === OFFICIAL_FIGMA_REMOTE ? generation() : null;
      const bounds = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
      try {
        const result = await (options.probe ?? probeOfficialFigmaMcp)(endpoint, {
          ...(endpoint === OFFICIAL_FIGMA_REMOTE ? connection : {}),
          signal: bounds,
          deadlineAt: now() + 20000,
        });
        if (endpoint === OFFICIAL_FIGMA_REMOTE) assertGeneration(original);
        bounds.throwIfAborted();
        return FigmaMcpProbeResultSchema.parse({
          schemaVersion: 1,
          endpoint,
          checkedAt: new Date(now()).toISOString(),
          status: 'connected',
          code: null,
          authentication: status(),
          tools: [
            ...new Set(
              result.tools
                .map(tool => tool.name)
                .filter((name): name is (typeof OFFICIAL_FIGMA_READ_TOOLS)[number] =>
                  (OFFICIAL_FIGMA_READ_TOOLS as readonly string[]).includes(name),
                ),
            ),
          ],
          programCaptureSupported: result.captureCapability.supported === true,
          fullCapture: false,
        });
      } catch (error) {
        const reported = (error as { code?: unknown } | null)?.code;
        const allowed = new Set([
          'FIGMA_MCP_AUTH_REQUIRED',
          'FIGMA_MCP_OAUTH_ENV_REQUIRED',
          'FIGMA_MCP_DEADLINE_EXCEEDED',
          'FIGMA_MCP_REDIRECT_REJECTED',
          'FIGMA_MCP_DESTINATION_REJECTED',
          'FIGMA_MCP_TOOL_LIST_INCOMPLETE',
          'FIGMA_MCP_OAUTH_SUPERSEDED',
        ]);
        const code = bounds.aborted
          ? 'FIGMA_MCP_PROBE_CANCELLED'
          : typeof reported === 'string' && allowed.has(reported)
            ? reported
            : 'FIGMA_MCP_UNAVAILABLE';
        return FigmaMcpProbeResultSchema.parse({
          schemaVersion: 1,
          endpoint,
          checkedAt: new Date(now()).toISOString(),
          status: bounds.aborted
            ? 'cancelled'
            : ['FIGMA_MCP_AUTH_REQUIRED', 'FIGMA_MCP_OAUTH_ENV_REQUIRED'].includes(code)
              ? 'auth-required'
              : 'unavailable',
          code,
          authentication: status(),
          tools: [],
          programCaptureSupported: false,
          fullCapture: false,
        });
      } finally {
        busy = false;
      }
    },
  };
}
